import assert from 'node:assert/strict';
import { buildInspection, inspectionPage, readOfficialProjections } from './lib/inspect.js';
import { InspectionService } from './lib/inspect-service.js';
import { replayOfficialStats, estimateToolsTokens } from './lib/official-stats.js';
import { apply } from './lib/index.js';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { readFileSync, existsSync } from 'node:fs';
import { SKILL_BODY } from './lib/skill.js';

let n = 0;
const event = (type, data, surfaceOp) => ({ seq: n++, time: n * 100, type, data, ...(surfaceOp ? { surfaceOp } : {}) });
const content = value => [{ type: 'text', text: value }];
const header = { tools: [
  { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
  { name: 'unused_plugin_tool', description: 'Long documented tool. '.repeat(80), parameters: { type: 'object' }, deferLoading: true },
  { name: 'run_code', description: 'Execute program', parameters: { type: 'object' } },
] };
const events = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('request/header', { turn: 1, step: 1, header }), event('request/context', { turn: 1, step: 1 }),
  event('tool/call', { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: '{"code":"invoke"}' }),
  event('tool/ptc-dispatch-start', { rootCallId: 'root', parentCallId: 'root', subCallId: 'r1', name: 'read', arguments: { file_path: 'a.txt' } }),
  event('tool/ptc-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'r1', name: 'read', arguments: { file_path: 'a.txt' }, content: content('1: hello\n2: world') }),
  event('tool/result', { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'root' }, content: content('done') } }),
  event('step/end', { turn: 1, step: 1 }), event('step/start', { turn: 1, step: 2 }),
  event('request/context', { turn: 1, step: 2 }),
  event('tool/call', { turn: 1, step: 2, callId: 'r2', name: 'read', arguments: '{"file_path":"a.txt"}' }),
  event('tool/result', { turn: 1, step: 2, message: { source: { kind: 'tool', callId: 'r2' }, content: content('1: hello\n2: world') } }),
  event('step/end', { turn: 1, step: 2 }), event('step/start', { turn: 1, step: 3 }),
  event('tool/call', { turn: 1, step: 3, callId: 'g', name: 'grep', arguments: '{"path":"src","pattern":"hello"}' }),
  event('tool/result', { turn: 1, step: 3, message: { source: { kind: 'tool', callId: 'g' }, content: content('Found 1 matches\n\nsrc/a.txt\nLine 8: hello') } }),
  event('step/end', { turn: 1, step: 3 }), event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
];
const loaded = { events, header: { id: 'fixture', cwd: 'D:/work', version: 4 } };
const projections = { source: 'test-registered-official-projection', values: { contextTimeline: { requests: [
  { seq: 3, turn: 1, step: 1, total: 30, system: 10, tools: 10, tool: 10 },
  { seq: 10, turn: 1, step: 2, total: 30, system: 10, tools: 5, tool: 15 },
] } } };
const index = buildInspection(loaded, 'fixture', { projections });
const official = replayOfficialStats(events).snapshot;
assert.equal(index.coverage.statistics.status, 'available');
assert.equal(index.summary.steps, official.stepCount);
assert.deepEqual(index.stepEntries.map(row => row.official.wall).sort(), Array.from(official.turns).flatMap(t => Array.from(t.steps, s => s.wall)).sort());
const definitions = index.summary.toolDefinitions;
assert.equal(definitions.requestSamples, 2, 'unchanged headers apply to subsequent request/context records');
assert.equal(definitions.estimatedSchemaTokenRequests, estimateToolsTokens(header) * 2, 'schema footprint calls the official estimator unchanged');
assert.equal(definitions.definitions.find(d => d.name === 'read').invocationsInScope, 2, 'native dispatch start/result is one invocation');
assert.equal(definitions.definitions.find(d => d.name === 'run_code').invocationsInScope, 1, 'Code Mode transport is not falsely unused');
assert.equal(index.definitionItems[0].name, 'unused_plugin_tool');
assert.equal(index.definitionItems[0].owner, null, 'tool names never invent historical plugin ownership');
assert.equal(index.definitionItems[0].deferredRequested, true);
assert.equal(index.views.repeats[0].sameReturnedText, true);
assert.equal(index.views.repeats[0].classification, 'repeat-candidate');
assert.equal(index.views.io.find(r => r.name === 'grep').files[0].access, 'match');
assert.equal(index.views.context[0].net, 0);
assert.equal(index.views.context[0].categoryNetChange.tool, 5, 'net-zero is not no additions');
assert.equal(inspectionPage(index, 'latency', 0, 1).items.length, 1);
assert.equal(inspectionPage(index, 'cost', 0, 1).largestDefinitions.length, 1);
assert.equal(index.views.latency.length, index.stepEntries.length, 'views retain compact references to one step evidence table');
const skillMirror = new URL('../../skill/trajectory-query.md', import.meta.url);
if (existsSync(skillMirror)) assert.equal(readFileSync(skillMirror, 'utf8').split('需要过去的信息时')[1], SKILL_BODY.split('需要过去的信息时')[1], 'repository skill mirrors the registered runtime body');

let restored = 0;
const large = { ...loaded, inherited: 20, events: Array.from({ length: 1002 }, (_, seq) => ({ seq, type: 'test/sample', data: {} })) };
const folded = await readOfficialProjections({ get: name => name === 'sessionProjections' ? {
  restore(checkpoint, batch, floor, sessionHeader, inherited) {
    assert.equal(floor, restored ? 1000 : 0); assert.equal(inherited, 20); assert.equal(sessionHeader, loaded.header);
    assert.equal(checkpoint.count || 0, restored ? 1000 : 0); restored++;
    const count = (checkpoint.count || 0) + batch.length;
    return { checkpoint: { count }, snapshot: { asOfSeq: batch.at(-1).seq, values: { tokenUsage: { officialSample: count } } } };
  },
} : undefined }, large);
assert.equal(restored, 2); assert.equal(folded.asOfSeq, 1001); assert.equal(folded.values.tokenUsage.officialSample, 1002);
const stopped = new AbortController(); stopped.abort();
await assert.rejects(readOfficialProjections({ get: () => ({ restore() { assert.fail('aborted restore must not run'); } }) }, loaded, stopped.signal), /abort/i);

let now = 0, reads = 0;
const service = new InspectionService({ load: async () => { reads++; return loaded; }, ctx: { get: () => undefined }, now: () => now });
const first = await service.query({ view: 'latency', limit: 1 }, 'fixture');
assert.ok(first.snapshot); assert.ok(first.nextCursor); assert.ok(first.reads.length);
await service.query({ view: 'latency', cursor: first.nextCursor, limit: 1 }, 'fixture');
assert.equal(reads, 1, 'pagination reuses compact prepared evidence, not another raw log');
await assert.rejects(service.query({ view: 'cost', cursor: first.nextCursor }, 'fixture'), /view/);
await assert.rejects(service.query({ snapshot: first.snapshot, session: 'other' }, 'fixture'), /another session/);
service.validateRead(first.snapshot, 'fixture', 4, 7, events.filter(e => e.seq >= 4 && e.seq <= 7));
const mutated = structuredClone(events.filter(e => e.seq >= 4 && e.seq <= 7)); mutated[0].data.arguments = 'changed';
assert.throws(() => service.validateRead(first.snapshot, 'fixture', 4, 7, mutated), /changed/);
assert.throws(() => service.validateRead(first.snapshot, 'fixture', 0, 500), /exceeds/);
now += 120001;
await assert.rejects(service.query({ snapshot: first.snapshot }, 'fixture'), /expired/);
service.dispose();
const tiny = new InspectionService({ load: async () => loaded, ctx: { get: () => undefined }, maxBytes: 1 });
await assert.rejects(tiny.query({}, 'fixture'), /budget/); assert.equal(tiny.entries.size, 0); tiny.dispose();
const many = new InspectionService({ load: async () => loaded, ctx: { get: () => undefined } });
const evicted = await many.query({}, 'fixture');
for (let i = 0; i < 4; i++) await many.query({}, 'fixture');
assert.equal(many.entries.size, 4);
await assert.rejects(many.query({ snapshot: evicted.snapshot }, 'fixture'), /expired/); many.dispose();

// Exercise the actual registered tool and its ready-to-call original-record pointers.
const registered = new Map(), disposers = [];
let observed = 0, released = 0;
apply({ tools: { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name); } },
  effect(fn) { disposers.push(fn()); },
  get(name) { return name === 'sessionQuery' ? { async observeSession(id, options) {
    assert.equal(id, 'fixture'); assert.equal(options.projectionMode, 'none'); observed++;
    return { ...loaded, source: 'prepared', [Symbol.dispose]() { released++; } };
  } } : undefined; },
}, { reconcile: false });
const exec = { sessionId: 'fixture', signal: new AbortController().signal };
const packet = await registered.get('trajectory_inspect').execute({ session: 'fixture', view: 'latency', limit: 1 }, exec);
assert.equal(packet.ok, true); assert.equal(observed, 1); assert.equal(released, 1);
assert.ok(packet.reads.length);
const original = await registered.get(packet.reads[0].tool).execute(packet.reads[0].args, exec);
assert.equal(original.ok, true, 'returned deep read succeeds through the public tool');
assert.equal(original.log.id, packet.log.id, 'diagnostics use the same log identity as historical tools');
assert.ok(JSON.stringify(original).includes('step/start'));
const next = await registered.get('trajectory_inspect').execute({ snapshot: packet.snapshot, view: 'cost' }, exec);
assert.equal(next.ok, true); assert.equal(observed, 2, 'cross-view query reuses the inspection; only deep read reopens the source');
const wrong = await registered.get('trajectory_read').execute({ ...packet.reads[0].args, snapshot: 'expired' }, exec);
assert.equal(wrong.ok, false);

const schemas = [...registered.values()].map(tool => projectToolSchema(tool, true));
const baseline = schemas.filter(s => s.name !== 'trajectory_inspect').map(s => {
  if (s.name === 'trajectory_read') { const copy = structuredClone(s); delete copy.parameters.properties.snapshot; return copy; }
  return s;
});
const before = estimateToolsTokens({ tools: baseline }), after = estimateToolsTokens({ tools: schemas });
assert.ok(after > before);
console.log(JSON.stringify({ officialDefinitionEstimate: { before, after, added: after - before }, basis: 'Official standalone native schemas; excludes Code Mode system catalogs and runtime skill discovery text.' }));
for (const dispose of disposers) dispose?.();
console.log('PASS official stats parity, official schema estimates, native transport use, bounded evidence, grep semantics, net change, snapshot identity, paging, expiry and byte budget');
