import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectToolResults, toolResultLabel, toolTiming } from './tool-result-model.mjs';
const text = readFileSync('.dsh/layout-review/installed-trace.html', 'utf8');
const payload = JSON.parse(text.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const session = payload.sessions.find(s => s.id === payload.mainSession);
const context = JSON.parse(readFileSync('.dsh/layout-review/context-data.json'));
const stats = JSON.parse(readFileSync('.dsh/layout-review/official-stats.json'));
assert.equal(stats.session, session.id);
assert.equal(stats.snapshot.turns.length, 105);
assert.equal(stats.snapshot.stepCount, 1214);
assert.equal(stats.source.name, '@deepseek-ai/dsh-experimental-client-ui-stats');
const results = collectToolResults(session, context.callFacts, context.fileOperations);
assert.equal(results.filter(r => r.kind === 'incident').length, session.overview.episodes.length);
const incidentSeqs = new Set(results.filter(r => r.kind === 'incident').flatMap(r => r.seqs));
const otherSeqs = results.filter(r => r.kind !== 'incident').flatMap(r => r.seqs);
assert.equal(otherSeqs.length, new Set(otherSeqs).size, 'a call has one result branch');
assert.ok(otherSeqs.every(seq => !incidentSeqs.has(seq)), 'recovery evidence is not redrawn as a separate ordinary outcome');
assert.ok(results.some(r => r.turn === 9 && r.kind === 'check'));
assert.ok(results.some(r => r.turn === 9 && r.kind === 'change'));
const read = results.find(r => r.turn === 35 && r.kind === 'read' && r.calls.some(c => /返回第/.test(c.fact.outcome)));
assert.match(toolResultLabel(read), /取回 \d+ 行/);
const empty = { kind: 'query', calls: [{ fact: { outcome: '命中 0 条，本次返回 0 条。' } }] };
assert.equal(toolResultLabel(empty), '没有匹配结果');
assert.equal(toolResultLabel({ kind: 'check', calls: [{ fact: { outcome: '命令输出报告：PASS first' }, result: { text: 'PASS first\nFAIL second' } }] }), '检查报告未过', 'a PASS line cannot hide a later recorded FAIL');
const fakeSession = { overview: { episodes: [] }, turns: [{ number: 1, steps: [{ number: 1, calls: [
  { seq: 1, name: 'pwsh', status: 'returned', resultSeq: 2, start: 0, end: 5 },
  { seq: 3, name: 'pwsh', status: 'error', resultSeq: 4, start: 5, end: 10 },
  { seq: 5, name: 'read', status: 'unknown', resultSeq: null, start: 10, end: 15 },
] }] }] };
const fake = collectToolResults(fakeSession, { 1: { outcome: '命令返回了输出。' }, 3: { outcome: '命令输出报告：PASS example', tone: 'bad' } }, []);
assert.deepEqual(fake.map(r => r.kind), ['error'], 'normal command output, contradictory PASS and missing results are not success claims');
const t35 = session.turns.find(t => t.number === 35), s35 = stats.snapshot.turns.find(t => t.turn === 35).steps[0];
assert.equal(toolTiming(s35, t35.steps[0]).coverage, 35);
assert.equal(toolTiming(s35, t35.steps[0]).status, 'measured');
const concurrent = { toolWall: 900, tool: 1800, toolPending: 0, tools: [{ name: 'a', count: 2 }], calls: [
  { seq: 1, startedAt: 100, endedAt: 1000 }, { seq: 2, startedAt: 100, endedAt: 1000 },
] };
assert.equal(toolTiming(concurrent, { start: 0, end: 1000 }).coverage, 900, 'native wall coverage is not replaced by cumulative duration');
assert.equal(toolTiming({ ...concurrent, toolWall: 2000 }, { start: 0, end: 1000 }).status, 'inconsistent');
assert.equal(toolTiming(null, { start: 0, end: 1000 }).status, 'missing');
assert.equal(toolTiming({ ...concurrent, tools: [{ name: 'a', count: 20 }] }, { start: 0, end: 1000 }).partial, true);
console.log('PASS official replay coverage, shared error/results semantics, conservative checks, recovery deduplication, native time basis and inconsistent/missing time handling');
