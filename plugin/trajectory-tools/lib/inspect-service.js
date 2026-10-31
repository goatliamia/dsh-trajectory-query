import { randomUUID, createHash } from 'node:crypto';
import { buildInspection, readOfficialProjections, inspectionPage, evidencePointers, INSPECT_VIEWS } from './inspect.js';
import { linkedPlan, linkedRecord } from './linked-read.js';
import { inspectionReportData, reportPage } from './report-data.js';

const GROUPS = { overview: ['turn', 'tool', 'file'], latency: ['turn'], cost: ['turn'], io: ['tool', 'file'], repeats: [], context: [] };
const SORTS = { overview: ['time', 'wall', 'input', 'output', 'returned', 'count'], latency: ['time', 'wall', 'input', 'output'], cost: ['time', 'wall', 'input', 'output'], io: ['time', 'returned', 'count'], repeats: ['time', 'count'], context: ['time', 'change'] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
function selection(args, previous = {}) {
  const q = {};
  for (const key of ['view', 'turns', 'focus', 'groupBy', 'sort', 'format']) q[key] = args[key] === undefined ? previous[key] ?? null : args[key];
  q.view ||= 'overview';
  q.format ||= 'summary';
  if (!['summary', 'data'].includes(q.format)) throw Error('format must be summary or data');
  if (!INSPECT_VIEWS.includes(q.view)) throw Error('Unknown inspection view');
  if (q.turns && (typeof q.turns !== 'object' || Array.isArray(q.turns) || Object.keys(q.turns).some(k => !['from', 'to'].includes(k)) || !Number.isSafeInteger(q.turns.from) || !Number.isSafeInteger(q.turns.to) || q.turns.from < 1 || q.turns.to < q.turns.from)) throw Error('turns requires an inclusive {from,to} range');
  if (q.turns) q.turns = { from: q.turns.from, to: q.turns.to };
  if (q.focus && (typeof q.focus !== 'object' || Array.isArray(q.focus) || Object.keys(q.focus).length !== 1 || !['tool', 'file'].includes(Object.keys(q.focus)[0]) || typeof Object.values(q.focus)[0] !== 'string' || !Object.values(q.focus)[0] || Object.values(q.focus)[0].length > 1000)) throw Error('focus requires {tool: exactName} or {file: exactPath}');
  if (q.groupBy && !GROUPS[q.view].includes(q.groupBy)) throw Error('groupBy for ' + q.view + ': ' + GROUPS[q.view].join(', '));
  if (q.sort && !SORTS[q.view].includes(q.sort)) throw Error('sort for ' + q.view + ': ' + SORTS[q.view].join(', '));
  if (q.view === 'overview' && (q.groupBy === 'tool' || q.groupBy === 'file') && q.sort && !['time', 'returned', 'count'].includes(q.sort)) throw Error('Tool/file groups sort by time, returned, or count');
  if (q.view === 'overview' && !['tool', 'file'].includes(q.groupBy) && ['returned', 'count'].includes(q.sort)) throw Error('Window/turn groups sort by time, wall, input, or output');
  return q;
}

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
  expire() { for (const [id, e] of this.entries) if (this.now() - e.at >= this.idleMs) this.entries.delete(id); }
  async prepare(id, session, signal) {
    if (this.closed) throw Error('Inspection service disposed');
    signal?.throwIfAborted(); this.expire();
    if (id) {
      const entry = this.entries.get(id);
      if (!entry) throw Error('Snapshot expired; request a new inspection');
      if (session && session !== entry.session) throw Error('Snapshot belongs to another session');
      this.entries.delete(id); this.entries.set(id, entry); entry.at = this.now(); this.arm();
      return { id, entry };
    }
    if (!session) throw Error('A session is required outside a conversation');
    const job = this.serial.then(async () => {
      signal?.throwIfAborted(); if (this.closed) throw Error('Inspection service disposed');
      const loaded = await this.load(session, signal);
      signal?.throwIfAborted();
      let projections;
      try { projections = await readOfficialProjections(this.ctx, loaded, signal); }
      catch (error) { if (signal?.aborted) throw error; projections = { values: {}, source: 'unavailable', error: String(error.message) }; }
      const index = buildInspection(loaded, session, { projections });
      index.log = this.identify?.(session, loaded.events) || null;
      signal?.throwIfAborted(); if (this.closed) throw Error('Inspection service disposed');
      const bytes = JSON.stringify(index).length * 2;
      if (bytes > this.maxBytes) throw Error('Inspection exceeds retained-data budget');
      const value = { index, session, bytes, at: this.now() }, key = randomUUID();
      this.entries.set(key, value);
      while (this.entries.size > 4 || [...this.entries.values()].reduce((n, e) => n + e.bytes, 0) > this.maxBytes) this.entries.delete(this.entries.keys().next().value);
      this.arm(); return { id: key, entry: value };
    });
    this.serial = job.then(() => undefined, () => undefined);
    return job;
  }
  async query(args, current, signal) {
    let id = args.snapshot, offset = 0, prior = null;
    if (args.cursor) {
      if (typeof args.cursor !== 'string' || args.cursor.length > 8192) throw Error('Invalid cursor');
      const parts = args.cursor.split(':');
      if (parts.length !== 3 || !/^\d+$/.test(parts[2])) throw Error('Invalid cursor');
      if (id && id !== parts[0]) throw Error('Cursor does not match snapshot');
      id = parts[0]; offset = Number(parts[2]);
      if (!Number.isSafeInteger(offset)) throw Error('Invalid cursor offset');
      try { prior = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { throw Error('Invalid cursor query'); }
    }
    const q = selection(args, prior || {});
    if (prior && digest(q) !== digest(prior)) throw Error('Cursor does not match view or query');
    const limit = args.limit ?? (q.format === 'data' ? 250 : q.view === 'overview' ? 6 : 3);
    if (!Number.isInteger(limit) || limit < 1 || limit > (q.format === 'data' ? 500 : 10)) throw Error('limit exceeds this format’s page size');
    const prepared = await this.prepare(id, args.session || (id ? undefined : current), signal);
    id = prepared.id; const entry = prepared.entry;
    if (q.format === 'data') {
      if (q.sort && q.sort !== 'time') throw Error('Data format keeps source order; choose ranking in the figure');
      if (q.groupBy && !(q.view === 'io' && ['tool', 'file'].includes(q.groupBy))) throw Error('Data groupBy is available only for io tool/file; other data keeps source rows');
      const source = { host: 'dsh', session: entry.session, snapshot: id, log: entry.index.log?.id ?? entry.index.log,
        cut: entry.index.scope.toSeq, query: { view: q.view, turns: q.turns, focus: q.focus, groupBy: q.groupBy } };
      const page = reportPage(inspectionReportData(entry.index, q, source), offset, limit);
      return { ok: true, ...page, nextCursor: page.nextOffset == null ? null : id + ':' + Buffer.from(JSON.stringify(q)).toString('base64url') + ':' + page.nextOffset };
    }
    const page = inspectionPage(entry.index, q.view, offset, limit, q);
    page.log = entry.index.log;
    const primary = page.items.map(row => row.callSeq ?? row.evidence?.calls?.[0]?.seq ?? row.seq).filter(Number.isSafeInteger);
    const pointers = [...new Set([...primary, ...evidencePointers(page).map(ref => ref.seq)])].slice(0, 6);
    page.reads = pointers.map(seq => ({ tool: 'trajectory_read',
      args: { session: entry.session, seq, format: 'linked', snapshot: id } }));
    if (q.view === 'overview' && !q.groupBy) for (const row of page.items) row.expand = { tool: 'trajectory_inspect',
      args: { session: entry.session, snapshot: id, view: 'overview', turns: row.turns, groupBy: 'turn', limit: 10 } };
    page.snapshot = id; page.view = q.view; page.ok = true;
    page.nextCursor = page.nextOffset == null ? null : id + ':' + Buffer.from(JSON.stringify(q)).toString('base64url') + ':' + page.nextOffset;
    return JSON.parse(JSON.stringify(page));
  }
  async readLinked(args, signal) {
    if (!Number.isSafeInteger(args.seq) || args.seq < 0) throw Error('linked requires seq');
    const offset = args.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw Error('offset must be a nonnegative integer');
    const { id, entry } = await this.prepare(args.snapshot, args.session, signal);
    const plan = linkedPlan(entry.index, args.seq), selected = plan.records.slice(offset, offset + 10);
    if (offset > plan.records.length) throw Error('offset exceeds linked records');
    const loaded = await this.load(entry.session, signal);
    signal?.throwIfAborted();
    const wanted = new Set(selected.map(r => r.seq)), events = new Map(loaded.events.filter(e => wanted.has(e.seq)).map(e => [e.seq, e]));
    for (const seq of wanted) if (!events.has(seq) || digest(events.get(seq)) !== entry.index.anchors[seq]) throw Error('Evidence changed since the inspection snapshot');
    const readArgs = { session: entry.session, snapshot: id };
    const nextOffset = offset + selected.length < plan.records.length ? offset + selected.length : null;
    return { ok: true, session: entry.session, snapshot: id, log: entry.index.log, cut: entry.index.scope.toSeq,
      format: 'linked', anchor: args.seq, turn: plan.turn, step: plan.step, relationBasis: plan.relationBasis,
      totalRecords: plan.records.length, offset, omittedBefore: offset, omittedAfter: Math.max(0, plan.records.length - offset - selected.length),
      records: selected.map(ref => linkedRecord(events.get(ref.seq), ref.relations, readArgs)),
      nextRead: nextOffset == null ? null : { tool: 'trajectory_read', args: { ...readArgs, seq: args.seq, format: 'linked', offset: nextOffset } } };
  }
  validateRead(id, session, from, to, events) {
    this.expire(); const entry = this.entries.get(id);
    if (!entry || entry.session !== session) throw Error('Snapshot expired or belongs to another session');
    const scope = entry.index.scope;
    if (from < (scope.fromSeq ?? 0) || to > (scope.toSeq ?? -1)) throw Error('Read exceeds inspection cut');
    if (events) {
      const expected = Object.keys(entry.index.anchors).filter(seq => Number(seq) >= from && Number(seq) <= to);
      if (expected.length !== events.length || events.some(e => entry.index.anchors[e.seq] !== digest(e))) throw Error('Evidence changed since the inspection snapshot');
    }
    entry.at = this.now(); this.arm();
    return scope;
  }
  dispose() { this.closed = true; clearTimeout(this.timer); this.entries.clear(); }
}
