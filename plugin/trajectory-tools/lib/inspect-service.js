import { randomUUID, createHash } from 'node:crypto';
import { buildInspection, readOfficialProjections, inspectionPage, evidencePointers, INSPECT_VIEWS } from './inspect.js';

export class InspectionService {
  constructor({ load, ctx, identify, now = Date.now, maxBytes = 16 * 1024 * 1024, idleMs = 120000 }) {
    Object.assign(this, { load, ctx, identify, now, maxBytes, idleMs });
    this.entries = new Map(); this.serial = Promise.resolve(); this.closed = false; this.timer = null;
  }
  arm() {
    clearTimeout(this.timer);
    if (!this.entries.size) return;
    const due = Math.min(...[...this.entries.values()].map(e => e.at + this.idleMs));
    this.timer = setTimeout(() => { this.expire(); this.arm(); }, Math.max(1, due - this.now())); this.timer.unref?.();
  }
  expire() { for (const [id, entry] of this.entries) if (this.now() - entry.at >= this.idleMs) this.entries.delete(id); }
  async query(args, current, signal) {
    if (this.closed) throw Error('Inspection service disposed');
    signal?.throwIfAborted(); this.expire();
    const view = args.view || 'overview', limit = args.limit ?? 3;
    if (!INSPECT_VIEWS.includes(view)) throw Error('Unknown inspection view');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw Error('limit must be an integer from 1 to 10');
    const turns = args.turns == null ? null : args.turns;
    if (turns && (typeof turns !== 'object' || Array.isArray(turns) || Object.keys(turns).some(k => !['from', 'to'].includes(k)) || !Number.isSafeInteger(turns.from) || !Number.isSafeInteger(turns.to) || turns.from < 1 || turns.to < turns.from)) throw Error('turns requires an inclusive {from,to} range');
    let id = args.snapshot, offset = 0;
    if (args.cursor) {
      const parts = String(args.cursor).split(':');
      if (parts.length !== 3 || parts[1] !== view || !/^\d+$/.test(parts[2])) throw Error('Cursor does not match the view');
      if (id && id !== parts[0]) throw Error('Cursor does not match the snapshot');
      id = parts[0]; offset = Number(parts[2]);
      if (!Number.isSafeInteger(offset)) throw Error('Invalid cursor offset');
    }
    let entry = id && this.entries.get(id);
    if (id && !entry) throw Error('Snapshot expired; request a new inspection');
    if (entry) {
      if (args.session && args.session !== entry.session) throw Error('Snapshot belongs to another session');
      if (turns && (turns.from !== entry.turns?.from || turns.to !== entry.turns?.to)) throw Error('Snapshot has another turn range');
      this.entries.delete(id); this.entries.set(id, entry); entry.at = this.now();
    } else {
      const session = args.session || current;
      if (!session) throw Error('A session is required outside a conversation');
      const job = this.serial.then(async () => {
        signal?.throwIfAborted(); if (this.closed) throw Error('Inspection service disposed');
        const loaded = await this.load(session, signal);
        signal?.throwIfAborted();
        let projections;
        try { projections = await readOfficialProjections(this.ctx, loaded, signal); }
        catch (error) { if (signal?.aborted) throw error; projections = { values: {}, source: 'unavailable', error: String(error.message) }; }
        const index = buildInspection(loaded, session, { turns, projections });
        index.log = this.identify?.(session, loaded.events) || null;
        signal?.throwIfAborted(); if (this.closed) throw Error('Inspection service disposed');
        const bytes = JSON.stringify(index).length * 2;
        if (bytes > this.maxBytes) throw Error('Inspection exceeds retained-data budget; narrow turns');
        const value = { index, session, turns, bytes, at: this.now() }, key = randomUUID();
        this.entries.set(key, value);
        while (this.entries.size > 4 || [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0) > this.maxBytes) this.entries.delete(this.entries.keys().next().value);
        return { id: key, entry: value };
      });
      this.serial = job.then(() => undefined, () => undefined);
      ({ id, entry } = await job);
    }
    this.arm();
    const page = inspectionPage(entry.index, view, offset, limit);
    page.log = entry.index.log;
    page.reads = evidencePointers(page).slice(0, 12).map(ref => ({ tool: 'trajectory_read', args: { session: ref.session, from: Math.max(entry.index.scope.fromSeq || 0, ref.seq - 2), to: Math.min(entry.index.scope.toSeq, ref.seq + 2), format: 'json', snapshot: id } }));
    page.snapshot = id; page.view = view; page.ok = true;
    page.nextCursor = page.nextOffset == null ? null : id + ':' + view + ':' + page.nextOffset;
    return JSON.parse(JSON.stringify(page));
  }
  validateRead(id, session, from, to, events) {
    this.expire(); const entry = this.entries.get(id);
    if (!entry || entry.session !== session) throw Error('Snapshot expired or belongs to another session');
    const scope = entry.index.scope;
    if (from < (scope.fromSeq ?? 0) || to > (scope.toSeq ?? -1)) throw Error('Read exceeds inspection cut');
    if (events) {
      const expected = Object.keys(entry.index.anchors).filter(seq => Number(seq) >= from && Number(seq) <= to);
      if (expected.length !== events.length || events.some(event => entry.index.anchors[event.seq] !== createHash('sha256').update(JSON.stringify(event)).digest('base64url'))) throw Error('Evidence changed since the inspection snapshot');
    }
    return scope;
  }
  dispose() { this.closed = true; clearTimeout(this.timer); this.entries.clear(); }
}
