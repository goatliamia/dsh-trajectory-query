import { inspectData, VIEWS } from './analysis.mjs';
import { hash, recordText } from './sources.mjs';
import { portableReportData } from './report-data.mjs';
import { reportPage } from '../trajectory-tools/lib/report-data.js';

const queryKeys = ['view', 'turns', 'focus', 'groupBy', 'sort', 'includeSelf', 'query', 'format'];
const pick = args => Object.fromEntries(queryKeys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
const preview = text => String(text || '').slice(0, 320);
function cursorEncode(value) { const text = JSON.stringify(value); return Buffer.from(text).toString('base64url') + '.' + hash(text).slice(0, 16); }
function cursorDecode(token) {
  if (typeof token !== 'string' || token.length > 12000) throw Error('Invalid cursor');
  const [body, digest, extra] = token.split('.'), text = Buffer.from(body, 'base64url').toString();
  if (extra || hash(text).slice(0, 16) !== digest) throw Error('Invalid cursor');
  const value = JSON.parse(text); if (!Number.isSafeInteger(value.offset) || value.offset < 0) throw Error('Invalid cursor offset');
  return value;
}
export class PortableService {
  constructor({ load, catalog = () => [], maxBytes = 128 * 1024 * 1024, idleMs = 120000, rebuildSnapshots = false }) {
    Object.assign(this, { load, catalog, maxBytes, idleMs, rebuildSnapshots }); this.entries = new Map(); this.queue = Promise.resolve();
  }
  dispose() { clearTimeout(this.timer); this.entries.clear(); this.closed = true; }
  arm() {
    clearTimeout(this.timer);
    if (!this.entries.size) return;
    this.timer = setTimeout(() => { const now = Date.now(); for (const [id, item] of this.entries) if (now - item.at >= this.idleMs) this.entries.delete(id); this.arm(); }, this.idleMs); this.timer.unref();
  }
  async prepare(id, session, signal) {
    if (this.closed) throw Error('Service disposed'); signal?.throwIfAborted();
    const now = Date.now(); for (const [key, item] of this.entries) if (now - item.at >= this.idleMs) this.entries.delete(key);
    if (id && this.entries.has(id)) {
      const item = this.entries.get(id);
      if (session && session !== item.data.session && session !== item.alias) throw Error('Snapshot belongs to another session');
      item.at = now; this.entries.delete(id); this.entries.set(id, item); this.arm(); return item;
    }
    if (id && !this.rebuildSnapshots) throw Error('Snapshot expired; start a new inspection');
    const work = this.queue.then(async () => {
      signal?.throwIfAborted();
      const loaded = await this.load(session, signal), data = structuredClone(loaded);
      signal?.throwIfAborted();
      const key = 'portable:' + data.fingerprint.slice(0, 32), bytes = Buffer.byteLength(JSON.stringify(data)) * 2;
      if (id && id !== key) throw Error('Source changed; use a new snapshot or the persistent MCP/Pi tool');
      if (bytes > this.maxBytes) throw Error('Source exceeds retained snapshot budget');
      if (this.closed) throw Error('Service disposed');
      const item = { id: key, data, alias: session, bytes, at: Date.now() };
      this.entries.delete(key); this.entries.set(key, item);
      while (this.entries.size > 2 || [...this.entries.values()].reduce((n, v) => n + v.bytes, 0) > this.maxBytes) this.entries.delete(this.entries.keys().next().value);
      this.arm(); return item;
    });
    this.queue = work.then(() => undefined, () => undefined); return work;
  }
  async call(name, args = {}, signal) {
    if (name === 'trajectory_search' && args.view === 'sessions') { signal?.throwIfAborted(); const result = await this.catalog(args, signal); return Array.isArray(result) ? { sessions: result, scope: 'Explicitly bound sources only; no background scan' } : result; }
    let previous, offset = 0;
    if (args.cursor) {
      previous = cursorDecode(args.cursor);
      if (previous.tool !== name || args.snapshot && args.snapshot !== previous.snapshot) throw Error('Cursor does not match tool/snapshot');
      offset = previous.offset;
    }
    const q = { ...(previous?.query || {}), ...pick(args) };
    if (name === 'trajectory_inspect' || name === 'trajectory_search') { q.view ||= name === 'trajectory_inspect' ? 'overview' : 'events'; q.sort ||= 'time'; q.includeSelf ??= false; }
    if (name === 'trajectory_inspect') { q.format ||= 'summary'; if (!['summary', 'data'].includes(q.format)) throw Error('format must be summary or data'); }
    if (q.turns) { if (!Number.isSafeInteger(q.turns.from) || !Number.isSafeInteger(q.turns.to) || q.turns.from < 1 || q.turns.to < q.turns.from) throw Error('turns requires an inclusive {from,to} range'); q.turns = { from: q.turns.from, to: q.turns.to }; }
    if (q.focus && (Object.keys(q.focus).length !== 1 || !Object.values(q.focus)[0])) throw Error('Select one exact tool, file, or skill in focus');
    if (previous && hash(q) !== hash(previous.query)) throw Error('Cursor does not match selection');
    const item = await this.prepare(args.snapshot || previous?.snapshot, args.session, signal), { data } = item;
    if (args.logId && args.logId !== data.logId) throw Error('Log identity does not match snapshot');
    const base = { snapshot: item.id, session: data.session, host: data.host, logId: data.logId, synthetic: data.synthetic };
    const pointer = seq => ({ tool: 'trajectory_read', snapshot: item.id, session: data.session, logId: data.logId, seq });
    const paginate = (rows, limit = args.limit ?? 6) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw Error('limit must be 1..20');
      return { rows: rows.slice(offset, offset + limit), total: rows.length, ...(offset + limit < rows.length ? { cursor: cursorEncode({ tool: name, snapshot: item.id, query: q, offset: offset + limit }) } : {}) };
    };
    if (name === 'trajectory_inspect' || name === 'trajectory_search' && q.view === 'cost') {
      const view = name === 'trajectory_search' ? 'cost' : q.view || 'overview';
      if (!VIEWS.includes(view)) throw Error('Unknown inspection view');
      if (name === 'trajectory_inspect' && q.format === 'data') {
        if (q.sort !== 'time') throw Error('Data format preserves source order; rank in the figure');
        if (q.groupBy && !(view === 'io' && ['tool', 'file'].includes(q.groupBy))) throw Error('Data groupBy is available for io tool/file only');
        const source = { host: data.host, session: data.session, snapshot: item.id, log: data.logId,
          cut: data.records.at(-1)?.seq ?? null, query: { view, turns: q.turns || null, focus: q.focus || null, groupBy: q.groupBy || null, includeSelf: q.includeSelf } };
        const page = reportPage(portableReportData(data, { ...q, view }, source), offset, args.limit ?? 250);
        return { ok: true, ...page, nextCursor: page.nextOffset == null ? null : cursorEncode({ tool: name, snapshot: item.id, query: q, offset: page.nextOffset }) };
      }
      if (q.groupBy && !(['overview', 'io'].includes(view) ? ['turn', 'tool', 'file'] : view === 'cost' ? ['turn', 'definition'] : ['turn']).includes(q.groupBy)) throw Error('Grouping is not available for this view; tool/file groups do not allocate model usage');
      const report = inspectData(data, { ...q, view }), page = paginate(report.rows, args.limit ?? 6);
      const { rows, ...summary } = report;
      // Expansion pointers are valid for this frozen cut, even after a live append.
      const bind = value => {
        if (Array.isArray(value)) return value.map(bind);
        if (!value || typeof value !== 'object') return value;
        if (typeof value.tool === 'string' && value.tool.startsWith('trajectory_')) return { ...value, snapshot: item.id };
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v)]));
      };
      return bind({ ...base, view, ...(offset ? { summary: report.summary, coverage: report.coverage } : summary), ...page });
    }
    if (name === 'trajectory_search') {
      let records = data.records.filter(r => !q.turns || r.turn >= q.turns.from && r.turn <= q.turns.to);
      if (!q.includeSelf) records = records.filter(r => !/(?:^|[/_.])trajectory_(?:inspect|search|read|graph)$/.test(r.name || ''));
      if (q.view === 'catalog') {
        const types = [...new Set(records.map(r => r.kind))].map(type => ({ type, count: records.filter(r => r.kind === type).length }));
        return { ...base, view: 'catalog', ...paginate(types) };
      }
      if (!q.query) throw Error('events search needs a literal query');
      const needle = q.query.toLocaleLowerCase(); records = records.filter(r => recordText(r).toLocaleLowerCase().includes(needle));
      return { ...base, view: 'events', ...paginate(records.map(r => { const text = recordText(r), at = text.toLocaleLowerCase().indexOf(needle); return { seq: r.seq, kind: r.kind, turn: r.turn, native: r.native, excerpt: text.slice(Math.max(0, at - 100), at + needle.length + 200), read: pointer(r.seq) }; })) };
    }
    const record = data.records.find(r => r.seq === args.seq);
    if (name === 'trajectory_read') {
      if (!record) throw Error('Unknown record seq in this snapshot');
      const maxChars = args.maxChars ?? 8000, start = args.offset ?? 0;
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isInteger(maxChars) || maxChars < 100 || maxChars > 24000) throw Error('Invalid read offset/maxChars');
      const chunk = (r, field, budget) => {
        let value = field === 'text' ? recordText(r) : field === 'arguments' ? r.body?.arguments ?? (data.host === 'claude' && r.kind === 'call' ? r.body?.input : undefined) : ['parameters', 'description'].includes(field) ? r.body?.[field] ?? r.body?.function?.[field] : r.body;
        if (field === 'result') { const returned = r.kind === 'result' ? r : data.records.find(x => x.seq === r.resultSeq); if (!returned) throw Error('No recorded result'); value = returned.body; }
        if (value === undefined) throw Error('This record has no ' + field);
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        if (start > text.length) throw Error('Read offset is beyond field');
        const end = Math.min(text.length, start + budget);
        return { seq: r.seq, kind: r.kind, native: r.native, nativeHash: r.nativeHash, source: r.source, field, length: text.length, offset: start, text: text.slice(start, end), ...(end < text.length ? { nextRead: { ...pointer(r.seq), field, offset: end, maxChars } } : {}) };
      };
      if (args.linked) {
        const previousUser = data.records.findLast(r => r.seq <= record.seq && r.turn === record.turn && /user|userMessage/.test(r.kind));
        const paired = data.records.find(r => r.seq === (record.resultSeq ?? record.callSeq));
        const next = data.records.find(r => r.seq > Math.max(record.seq, paired?.seq || 0) && r.turn === record.turn && /call|assistant|agentMessage/.test(r.kind));
        const linked = [...new Map([previousUser, record, paired, next].filter(Boolean).map(r => [r.seq, r])).values()].sort((a, b) => a.seq - b.seq);
        return { ...base, linked: linked.map(r => chunk(r, 'body', Math.max(100, Math.floor(maxChars / linked.length)))) };
      }
      return { ...base, ...chunk(record, args.field || 'body', maxChars) };
    }
    if (name === 'trajectory_graph') {
      if (args.mode === 'lineage') {
        const session = data.payload.sessions[0], children = data.records.flatMap(r => { const value = r.body?.arguments || r.body; return [...(value?.receiverThreadIds || []), ...(value?.agentThreadId ? [value.agentThreadId] : [])].map(id => ({ session: id, read: pointer(r.seq) })); });
        return { ...base, parent: session.parentSession, children: [...new Map(children.map(c => [c.session, c])).values()], scope: 'Recorded IDs only; child histories are not loaded automatically' };
      }
      if (!record) throw Error('relations graph needs a recorded seq');
      return { ...base, node: { seq: record.seq, native: record.native, source: record.source, read: pointer(record.seq) }, relations: [record.callSeq != null && { kind: 'call', read: pointer(record.callSeq) }, record.resultSeq != null && { kind: 'result', read: pointer(record.resultSeq) }, record.native?.parentId && { kind: 'native-parent', entryId: record.native.parentId }].filter(Boolean) };
    }
    throw Error('Unknown tool');
  }
}
