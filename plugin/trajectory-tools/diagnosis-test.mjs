import assert from 'node:assert/strict';
import { apply, costRequests } from './lib/index.js';
import { buildInspection } from './lib/inspect.js';

let seq = 0;
const events = [], content = s => [{ type: 'text', text: s }];
const add = (type, data, surfaceOp) => { if (type === 'assistant/message') data.stream ||= []; const e = { seq: seq++, time: seq * 100, type, data, ...(surfaceOp ? { surfaceOp } : {}) }; events.push(e); return e.seq; };
const user = add('user/message', { source: { kind: 'user' }, content: content('Compare the outputs and preserve the running job.') }, 'append');
add('turn/start', { turn: 1 }); add('step/start', { turn: 1, step: 1 });
add('request/header', { header: { tools: [{ name: 'run_code', parameters: { type: 'object' } }] } });
for (let i = 0; i < 7; i++) add('request/context', {});
const outer = add('tool/call', { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"run"}' });
const args = { command: 'a'.repeat(25000) };
const start = add('tool/ptc-dispatch-start', { rootCallId: 'outer', subCallId: 'sub', name: 'pwsh', arguments: args });
for (let i = 0; i < 80; i++) add('runtime/noise', {});
const inner = add('tool/ptc-dispatch', { rootCallId: 'outer', subCallId: 'sub', name: 'pwsh', arguments: args,
  content: content('Still running; job-7'), meta: { state: 'running', jobId: 'job-7' } });
const formal = add('tool/result', { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'outer' }, content: content('{"out":""}') } }, 'append');
add('step/end', { turn: 1, step: 1 }); add('step/start', { turn: 1, step: 2 });
const following = add('assistant/message', { turn: 1, step: 2, message: { content: content('I will inspect job-7 before rerunning.') }, usage: { inputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 115 } }, 'append');
add('step/end', { turn: 1, step: 2 }); add('turn/end', { turn: 1, reason: { kind: 'completed' } });
add('user/message', { source: { kind: 'user' }, content: content('Now read the changed file.') }, 'append');
add('turn/start', { turn: 2 }); add('step/start', { turn: 2, step: 1 });
add('request/header', { header: { tools: [{ name: 'read', parameters: { type: 'object' } }] } });
const read = add('tool/call', { turn: 2, step: 1, callId: 'read-2', name: 'read', arguments: '{"file_path":"D:/a.txt"}' });
add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'read-2' }, content: content('changed file') } }, 'append');
const unicodePath = 'D:/' + '文'.repeat(850) + '.txt';
for (let i = 0; i < 2; i++) {
  add('tool/call', { turn: 2, step: 1, callId: 'unicode-' + i, name: 'read', arguments: JSON.stringify({ file_path: unicodePath }) });
  add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'unicode-' + i }, content: content('same file') } }, 'append');
}
add('assistant/message', { turn: 2, step: 1, message: { content: content('The changed file is verified.') }, usage: { inputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 3, totalTokens: 73 } }, 'append');
add('step/end', { turn: 2, step: 1 }); add('turn/end', { turn: 2, reason: { kind: 'completed' } });
// Replacement copies preserve history, but do not add usage or new attempts.
add('assistant/message', { turn: 1, step: 2, message: { content: content('summary') }, usage: { inputTokens: 999999 } }, { op: 'replace', start: following, end: following });
const copiedResult = add('tool/result', structuredClone(events[read + 1].data), { op: 'replace', startSeq: read + 1, endSeq: read + 1 });
events[copiedResult].time += 86400000;
const loaded = { header: { id: 'fixture', version: 4, cwd: 'D:/' }, events };
assert.equal(costRequests(events).length, 2, 'append-origin usage is retained, replacements excluded');
const index = buildInspection(loaded, 'fixture');
assert.equal(index.summary.toolDefinitions.metadataChanges, 7);
assert.ok(!('requestSamples' in index.summary.toolDefinitions));
assert.equal(index.turnEntries[0].promptSeqs[0], user, 'a user request before turn/start belongs to that turn');
const rawTiming = index.stepEntries.find(s => s.turn === 2);
assert.ok(rawTiming.official.toolWall > rawTiming.official.wall, 'official interval union retains the recorded late replacement');

const tools = new Map(), disposers = [];
let observations = 0;
apply({ tools: { register(t) { tools.set(t.name, t); return () => {}; } }, effect(fn) { disposers.push(fn()); },
  get(name) { if (name === 'sessionQuery') return { async observeSession() { observations++; return { ...loaded, source: 'persisted', [Symbol.dispose]() {} }; } }; },
}, { reconcile: false });
const invoke = (name, args) => tools.get(name).execute({ session: 'fixture', ...args }, { signal: new AbortController().signal });
const first = await invoke('trajectory_inspect', { view: 'overview', turns: { from: 1, to: 1 }, groupBy: 'turn' });
assert.equal(first.ok, true); assert.equal(first.items[0].samples[0].prompt.text, 'Compare the outputs and preserve the running job.');
assert.equal(first.summary.usage.input, 5); assert.ok(!('method' in first)&&!('methodRef' in first)&&!('outputRule' in first));
assert.equal(first.summary.usage.settlements, 1); assert.equal(first.summary.usage.requests, undefined, 'settlements do not claim to count attempts');
const snapshot = first.snapshot;
const second = await invoke('trajectory_inspect', { snapshot, view: 'overview', turns: { from: 2, to: 2 }, groupBy: 'turn' });
assert.equal(second.ok, true); assert.equal(second.summary.usage.input, 50);
assert.equal(second.summary.official.toolWall, null, 'out-of-step call spans do not masquerade as active wait');
assert.equal(second.coverage.timing.toolSpansOutsideStep, 1);
assert.equal(second.method, undefined); assert.equal(second.outputRule, undefined);
assert.equal(observations, 1, 'changing the query range reuses one prepared cut');
const toolsInSecond = await invoke('trajectory_inspect', { snapshot, view: 'cost', turns: { from: 2, to: 2 } });
assert.deepEqual(toolsInSecond.largestDefinitions.map(d => d.name), ['read'], 'removed declarations do not leak into later turn scope');
const group = await invoke('trajectory_inspect', { snapshot, view: 'io', groupBy: 'file', sort: 'count', focus: { file: 'd:\\a.txt' } });
assert.equal(group.items[0].calls, 1); assert.equal(group.items[0].examples[0].seq, read);
const selected = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'read' }, sort: 'time' });
assert.equal(selected.items.length, 1); assert.equal(selected.items[0].turn, 2);
assert.match(selected.scope.metricsScope, /whole steps/);
const outerCost = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'run_code' } });
assert.equal(outerCost.summary.steps, 1, 'unwrapped transport remains queryable by its real name');
const outerCalls = await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { tool: 'run_code' }, groupBy: 'tool' });
assert.equal(outerCalls.items[0].calls, 1);
assert.equal(outerCalls.items[0].returnedCharacters, null, 'unretained outer content size is unknown, not zero');
assert.equal(outerCalls.reads[0].args.seq, outer);
const unicodePage = await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { file: unicodePath }, turns: { to: 2, from: 2 }, limit: 1 });
assert.ok(unicodePage.nextCursor.length > 3000, 'a supported Unicode selector can produce a long cursor');
const unicodeNext = await invoke('trajectory_inspect', { cursor: unicodePage.nextCursor, turns: { from: 2, to: 2 }, limit: 1 });
assert.equal(unicodeNext.ok, true); assert.equal(unicodeNext.offset, 1);

const linked = await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' });
assert.equal(linked.ok, true);
for (const n of [user, start, inner, outer, formal, following]) assert.ok(linked.records.some(r => r.seq === n), 'connected record survives distant log noise: ' + n);
const returned = linked.records.find(r => r.seq === inner);
assert.match(returned['data.meta'].text, /job-7/);
assert.match(linked.records.find(r => r.seq === formal).text.text, /"out":""/);
const detailArgs = returned.more.find(r => r.args.field === 'data.arguments').args;
let piece = await invoke('trajectory_read', detailArgs), rebuilt = piece.text;
assert.equal(piece.format, 'field'); assert.ok(piece.nextRead);
while (piece.nextRead) { piece = await invoke(piece.nextRead.tool, piece.nextRead.args); assert.equal(piece.ok, true); rebuilt += piece.text; }
assert.equal(rebuilt, JSON.stringify(args), 'field paging reconstructs exact full arguments');
const badPath = await invoke('trajectory_read', { snapshot, seq: inner, field: '__proto__.constructor' });
assert.equal(badPath.ok, false, 'field reads cannot traverse prototypes');
const beforeAppend = events.length;
add('assistant/message', { turn: 2, step: 1, message: { content: content('later') } }, 'append');
const cutRead = await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' });
assert.equal(cutRead.cut, beforeAppend - 1); assert.ok(cutRead.records.every(r => r.seq < beforeAppend));
assert.equal((await invoke('trajectory_read', { snapshot, seq: beforeAppend, field: 'data' })).ok, false);
events[formal].data.message.content = content('mutated');
assert.equal((await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' })).ok, false, 'mutated evidence is rejected');
assert.equal((await invoke('trajectory_inspect', { snapshot, view: 'context', groupBy: 'file' })).ok, false);
assert.equal((await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { tool: 'read', file: 'D:/a.txt' } })).ok, false);
for (const fn of disposers) fn?.();
console.log('PASS native registered tools: changing scope, object/group queries, truthful metadata, bounded linked reads, exact full-body continuation, append/replacement semantics and frozen evidence');
