import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadSession } from '../analyzers/load-session.mjs';
import { contextByTurn } from '../docs/demo/layout-review/context-model.mjs';
import { describeCall } from '../docs/demo/layout-review/step-insight.mjs';

const home = process.env.USERPROFILE;
const installed = join(home, '.dsh/profiles/web/node_modules/dsh-context');
const output = resolve('.dsh/layout-review');
const html = readFileSync(join(output, 'installed-trace.html'), 'utf8');
const trace = JSON.parse(html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const main = trace.sessions.find(s => s.id === trace.mainSession);
const file = process.argv[2] || join(home, '.dsh/sessions/--D-projects-sql~0020event--', main.id, 'session.v4.jsonl.zstd');

// Read-only fixture adapter: use the user's installed plugin's existing projection.
// No third-party source is copied, no live services or routes are started.
const plugin = await import(pathToFileURL(join(installed, 'lib/index.js')));
const definitions = new Map();
plugin.apply({
  fiber: { name: 'offline-context-review' },
  get() {}, inject() {}, on() {}, effect() {},
  sessionProjections: { register(definition) { definitions.set(definition.key, definition); return () => {}; } },
}, {});
const projection = definitions.get('contextTimeline');
if (!projection) throw new Error('Installed context projection is unavailable');
const log = loadSession(file);
if (log.id !== main.id) throw new Error('Session identity mismatch');
const events = log.events.filter(e => e.seq <= main.lastSeq);
let state = projection.init();
for (const event of events) state = projection.apply(state, event);
const value = projection.wire.view(state);
if (value.unsupported || !value.requests?.length) throw new Error('No usable context request records');
const requests = value.requests.map(r => {
  const row = { turn: r.turn, step: r.step, seq: r.seq, time: r.time };
  for (const key of ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total', 'activeMs']) {
    if (r[key] !== undefined) row[key] = r[key];
  }
  return row;
});
const eventBySeq = new Map(events.map(e => [e.seq, e]));
const callsById = new Map(events.filter(e => e.type === 'tool/call').map(e => [e.data.callId, e.data.name]));
const callEventsById = new Map(events.filter(e => e.type === 'tool/call').map(e => [e.data.callId, e]));
const callFacts = Object.fromEntries(main.turns.flatMap(t => t.steps.flatMap(s => s.calls)).map(call => {
  const nativeCall = eventBySeq.get(call.seq), nativeResult = eventBySeq.get(call.resultSeq);
  const args = nativeCall?.data?.arguments;
  const blocks = nativeResult?.data?.message?.content;
  const full = { ...call,
    args: args === undefined ? call.args : { text: typeof args === 'string' ? args : JSON.stringify(args), omitted: 0 },
    result: Array.isArray(blocks) ? { text: blocks.filter(b => b?.type === 'text').map(b => b.text || '').join('\n'), omitted: 0 } : call.result };
  return [call.seq, describeCall(full)];
}));
const fileOperations = main.turns.flatMap(t => t.steps.flatMap(s => s.calls.flatMap(call => {
  const event = eventBySeq.get(call.seq), result = eventBySeq.get(call.resultSeq);
  let args = event?.data?.arguments;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
  const kind = ['read', 'read_image'].includes(call.name) || call.name === 'str_replace_editor' && args?.command === 'view'
    ? 'read' : ['edit', 'write'].includes(call.name) || call.name === 'str_replace_editor' && ['str_replace', 'insert', 'create'].includes(args?.command) ? 'change' : null;
  const path = result?.data?.meta?.path || call.target || args?.file_path || args?.path;
  if (!kind || typeof path !== 'string' || !path) return [];
  return [{ turn: t.number, step: s.number, seq: call.seq, resultSeq: call.resultSeq,
    time: call.end ?? call.start, kind, path, tool: call.name, status: call.status,
    recordedPath: typeof result?.data?.meta?.path === 'string' }];
})));
const boundaries = value.events.filter(e => e.kind === 'compaction' || e.kind === 'prune')
  .map(e => {
    const native = eventBySeq.get(e.seq);
    const tools = [...new Set((native?.data?.shadowedSeqs || []).map(seq => {
      const source = eventBySeq.get(seq)?.data?.message?.source;
      return source?.kind === 'tool' ? callsById.get(source.callId) : null;
    }).filter(Boolean))];
    return { seq: e.seq, time: e.time, kind: e.kind, turn: e.turn, step: e.step, tokens: e.tokens,
      ...(e.kind === 'prune' ? { tools, replaced: (native?.data?.shadowedSeqs || []).map(seq => {
        const original = eventBySeq.get(seq), call = callEventsById.get(original?.data?.message?.source?.callId);
        return { seq, turn: call?.data?.turn ?? null, step: call?.data?.step ?? null, tool: call?.data?.name ?? null };
      }) } : {}) };
  });
const retryStarted = events.filter(e => e.type === 'llm/retry-started').map(e => ({ seq: e.seq, time: e.time, ...e.data }));
const retries = events.filter(e => e.type === 'llm/retry').map(e => {
  const start = retryStarted.find(r => r.retryId === e.data.retryId && r.retry === e.data.retry && r.seq > e.seq);
  const responded = Boolean(start && events.some(r => r.type === 'assistant/message' && typeof r.surfaceOp !== 'object' &&
    r.seq > start.seq && r.data?.turn === e.data.turn && r.data?.step === e.data.step));
  return { seq: e.seq, time: e.time, turn: e.data.turn, step: e.data.step, delayMs: e.data.delayMs || 0,
    failure: { code: e.data.failure?.code || 'UNKNOWN' }, started: Boolean(start), responded, startedSeq: start?.seq ?? null };
});
const payload = {
  session: main.id, cutoffSeq: main.lastSeq, eventCount: events.length,
  source: { name: 'Installed dsh-context projection', version: JSON.parse(readFileSync(join(installed, 'package.json'))).version,
    stateVersion: projection.stateVersion, sha256: createHash('sha256').update(readFileSync(join(installed, 'lib/index.js'))).digest('hex') },
  requests, boundaries, retryStarted, retries, callFacts, fileOperations,
  current: value.current,
  route: { provider: value.provider, model: value.model, reasoningEffort: value.reasoningEffort },
  supplementSources: [...events.filter(e => e.type === 'user/message' || e.type === 'developer/message')
    .reduce((counts, e) => {
      const source = e.data.source || e.data.message?.source, kind = source?.kind;
      if (kind && kind !== 'user' && kind !== 'skill-catalog' && kind !== 'skill-invocation') counts.set(kind, (counts.get(kind) || 0) + 1);
      return counts;
    }, new Map())].map(([kind, count]) => ({ kind, count })),
};
writeFileSync(join(output, 'context-data.json'), JSON.stringify(payload));
const turns = contextByTurn(requests);
writeFileSync(join(output, 'context-audit.json'), JSON.stringify({
  graphTurns: main.turns.length, contextTurns: turns.length, requests: requests.length,
  firstTurn: turns[0], lastTurn: turns.at(-1),
  largestDecrease: turns.reduce((best, t) => t.decrease > best.decrease ? t : best, turns[0]),
  boundaries: boundaries.length, retryStarted: retryStarted.length,
}, null, 2));
console.log(JSON.stringify({
  graphTurns: main.turns.length, contextTurns: turns.length, requests: requests.length,
  lastTurn: turns.at(-1).turn, lastDelta: turns.at(-1).net, boundaries: boundaries.length, retryStarted: retryStarted.length,
}));
