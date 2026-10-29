import { createHash } from 'node:crypto';
import { traceSource, observationSource, sameSource } from './trace-cache.js';
import { TraceResources, abortable, abortError } from './trace-resources.js';
import { buildTracePayload } from './trace-build.js';
import { traceContext, traceActors, readContextTimeline } from './trace-context.js';

const hash = value => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const preview = value => value && ({ text: value.text.slice(0, 96), omitted: (value.omitted || 0) + Math.max(0, value.text.length - 96) });
export function traceCore(payload) {
  return { ...payload, context: { requests: [], boundaries: [], callFacts: {}, fileOperations: [] },
    sessions: payload.sessions.map(session => ({ ...session, communications: [], turns: session.turns.map(turn => ({
      ...turn, title: turn.title.slice(0, 160), prompts: turn.prompts.map(row => ({ ...row, ...preview(row) })),
      steps: turn.steps.map(step => ({ ...step, reply: preview(step.reply), calls: step.calls.map(call => ({
        ...call, args: preview(call.args), result: preview(call.result),
      })) })),
    })) })) };
}

export class TraceStages {
  constructor(ctx, { observe, dispose, timeout, resources = new TraceResources() }) {
    Object.assign(this, { ctx, observe, dispose, timeout, resources });
    // Indices contain keys/jobs only; the resource pool owns retained cuts.
    this.latest = new Map(); this.pending = new Map(); this.serial = 0;
  }
  async source(id, signal) {
    try { return await this.timeout(stop => traceSource(this.ctx, id, stop), 1500, signal); }
    catch (error) { if (signal?.aborted) throw error; return null; }
  }
  async valid(id, source, assets) {
    const entry = this.resources.get(this.latest.get(id));
    if (!entry || !sameSource(entry.source, source) || entry.assets !== assets || Date.now() >= entry.retryAt) return;
    const valid = await Promise.all([...entry.children].map(async ([id, old]) => sameSource(old, await this.source(id))));
    if (valid.every(Boolean) && this.resources.get(entry.resourceKey) === entry) return entry;
  }
  async current(id, assets) { return this.valid(id, await this.source(id), assets); }
  cut(id, token) {
    const entry = this.resources.get('staged:' + token);
    return entry?.sessionId === id ? entry : undefined;
  }
  view(entry, viewer = 'anonymous') {
    entry.viewers.set(viewer, Date.now());
    for (const [id, at] of entry.viewers) if (Date.now() - at > 120000) entry.viewers.delete(id);
  }
  release(entry, viewer) {
    entry.viewers.delete(viewer);
    if (!entry.viewers.size && (!entry.actorData || entry.historyPending)) this.resources.remove(entry.resourceKey);
  }
  async load(sessionId, assets, signal, viewer = 'anonymous') {
    const source = await this.source(sessionId, signal);
    signal?.throwIfAborted();
    const hit = await this.valid(sessionId, source, assets);
    signal?.throwIfAborted();
    if (hit) { this.view(hit, viewer); return hit; }
    let job = this.pending.get(sessionId);
    if (!job || job.assets !== assets || !sameSource(job.source, source)) {
      job = { assets, source, controller: new AbortController(), users: 0, finished: false };
      const active = job;
      job.promise = this.resources.main.run(() => this.build(sessionId, source, assets, active.controller.signal), active.controller.signal)
        .then(entry => { if (this.pending.get(sessionId) === active) this.latest.set(sessionId, entry.resourceKey); return entry; })
        .finally(() => { active.finished = true; if (this.pending.get(sessionId) === active) this.pending.delete(sessionId); });
      this.pending.set(sessionId, job);
    }
    job.users++;
    try {
      const entry = await abortable(job.promise, signal);
      this.view(entry, viewer); return entry;
    } finally {
      job.users--;
      if (!job.users && !job.finished) job.controller.abort(abortError());
    }
  }
  async build(sessionId, source, assets, signal) {
    const started = Date.now();
    let observation = await this.timeout(stop => this.observe(sessionId, stop), 8000, signal);
    let events = observation.events || [], rawTimer, rawUsers = 0, reopening;
    const controller = new AbortController();
    const releaseRaw = (force = false) => {
      clearTimeout(rawTimer);
      if (rawUsers && !force) { rawTimer = setTimeout(releaseRaw, 1000); rawTimer.unref?.(); return; }
      if (observation) this.dispose(observation); observation = events = null;
    };
    try {
      signal.throwIfAborted();
      const loaded = Date.now(), payload = buildTracePayload(events, sessionId, { cwd: observation.header?.cwd ?? observation.session?.cwd });
      const cut = observationSource(this.ctx, observation, source), token = hash([sessionId, cut?.revision, assets, ++this.serial]);
      const entry = { sessionId, source: cut, assets, token, resourceKey: 'staged:' + token,
        children: new Map(), retryAt: Infinity, bodies: new Map(), encodedBytes: 0, viewers: new Map(), controller,
        version: hash([cut?.revision, assets, []]), payload, actorData: null,
        header: observation.header || observation.session, inherited: observation.inheritedEventCount ?? 0,
        timing: { load: loaded - started, core: Date.now() - loaded } };
      entry.core = { ...traceCore(payload), traceVersion: entry.version, traceAssets: assets,
        traceCapabilities: { history: !!entry.header && typeof this.ctx.get('sessionProjections')?.restore === 'function' } };
      const ensureEvents = async () => {
        controller.signal.throwIfAborted();
        if (!events) await (reopening ||= (async () => {
          observation = await this.timeout(stop => this.observe(sessionId, stop), 8000, controller.signal);
          const captured = observationSource(this.ctx, observation, null);
          if (cut && !sameSource(cut, captured)) { releaseRaw(true); throw new Error('trace cut expired'); }
          events = observation.events || [];
        })().finally(() => { reopening = null; }));
        return events;
      };
      entry.startDetails = () => entry.details ||= this.resources.main.run(async () => {
        const rows = await ensureEvents(), at = Date.now();
        payload.context = structuredClone(traceContext(rows, payload, readContextTimeline(this.ctx, sessionId)));
        entry.timing.details = Date.now() - at;
        this.resources.update(entry); return payload;
      }, controller.signal, 1);
      entry.startActors = () => entry.actors ||= entry.startDetails().then(() => this.resources.actors.run(async () => {
        rawUsers++;
        let incomplete = false;
        try {
          const rows = await ensureEvents(), at = Date.now(), deadline = at + 2500;
          const actors = await traceActors(rows, payload, payload.context.skillEvents, id => this.resources.children.run(async () => {
            try {
              const remaining = () => Math.max(1, Math.min(1200, deadline - Date.now()));
              if (Date.now() >= deadline) throw new Error('child read budget exhausted');
              const version = await this.timeout(stop => traceSource(this.ctx, id, stop), remaining(), controller.signal);
              entry.children.set(id, version);
              if (version?.revision === 'missing') return [];
              const child = await this.timeout(stop => this.observe(id, stop), remaining(), controller.signal);
              try { entry.children.set(id, observationSource(this.ctx, child, version)); return child.events || []; }
              finally { this.dispose(child); }
            } catch (error) { incomplete = true; throw error; }
          }, controller.signal));
          controller.signal.throwIfAborted();
          entry.version = hash([cut?.revision, assets, [...entry.children].map(([id, child]) => [id, child?.revision]).sort()]);
          if (incomplete) entry.retryAt = Date.now() + 1500;
          entry.timing.actors = Date.now() - at;
          entry.actorData = { context: actors, traceVersion: entry.version, incomplete,
            ...(incomplete ? { traceStatus: { actors: 'partial' } } : {}) };
          this.resources.update(entry); return entry.actorData;
        } finally { rawUsers--; releaseRaw(); }
      }, controller.signal));
      entry.startHistory = before => {
        if (entry.historyBefore === before && entry.historyJob) return entry.historyJob;
        entry.historyBefore = before; entry.historyPending = true;
        const job = this.resources.history.run(async () => {
          const registry = this.ctx.get('sessionProjections');
          if (!entry.header || typeof registry?.restore !== 'function') throw new Error('historical projection replay unavailable');
          rawUsers++;
          try {
            const rows = await this.resources.main.run(ensureEvents, controller.signal, 2);
            const start = rows.find(e => e.type === 'turn/start' && e.data?.turn >= before);
            const prefix = start ? rows.filter(e => e.seq < start.seq) : rows;
            let checkpoint = {}, deadline = Date.now() + 8000;
            // Pure restore returns detached checkpoints; no live Session or
            // durable DSH projection cache is changed by this history read.
            for (let i = 0; i < prefix.length; i += 1000) {
              controller.signal.throwIfAborted();
              if (Date.now() > deadline) throw new Error('historical replay budget exceeded');
              const batch = prefix.slice(i, i + 1000);
              checkpoint = await this.resources.main.run(() => registry.restore(checkpoint, batch, batch[0].seq, entry.header, entry.inherited).checkpoint, controller.signal, 2);
              await new Promise(resolve => setImmediate(resolve));
            }
            const requests = checkpoint.contextTimeline?.val?.requests;
            if (!Array.isArray(requests)) throw new Error('context history is unavailable');
            const history = { context: { historyRequests: structuredClone(requests.filter(row => row.turn < before).slice(-1500)) }, traceStatus: { history: 'ready' } };
            if (entry.historyBefore === before) { entry.historyData = history; this.resources.update(entry); }
            return history;
          } finally { rawUsers--; releaseRaw(); }
        }, controller.signal).finally(() => { if (entry.historyJob === job) entry.historyPending = false; });
        entry.historyJob = job; return job;
      };
      entry.dispose = () => {
        controller.abort(abortError()); releaseRaw(true); entry.viewers.clear();
        entry.payload = entry.core = entry.actorData = entry.historyData = entry.historyJob = entry.details = entry.actors = null; entry.bodies.clear();
        if (this.latest.get(sessionId) === entry.resourceKey) this.latest.delete(sessionId);
      };
      // An abandoned core releases its log, without starting optional work.
      rawTimer = setTimeout(releaseRaw, 10000); rawTimer.unref?.();
      this.resources.retain(entry, entry.dispose);
      return entry;
    } catch (error) { releaseRaw(); throw error; }
  }
  async stage(entry, stage, turnNumber) {
    entry.controller.signal.throwIfAborted();
    if (stage === 'core') return entry.core;
    if (stage === 'details') return entry.startDetails();
    if (stage === 'actors') return entry.startActors();
    if (stage === 'history') return entry.startHistory(turnNumber);
    if (stage === 'turn') {
      const session = entry.payload.sessions[0], turn = session.turns.find(t => t.number === turnNumber);
      return turn ? { sessions: [{ id: session.id, turns: [turn] }] } : null;
    }
    return null;
  }
  dispose() {
    for (const job of this.pending.values()) job.controller.abort(abortError());
    this.pending.clear();
  }
}
