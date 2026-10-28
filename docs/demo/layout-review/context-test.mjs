import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextByTurn, CONTEXT_CATEGORIES, recoveredStepNumbers, contextDisplayScale, contextDisplaySide, contextBarAmounts } from './context-model.mjs';
import { durationGroups, semanticZoomTarget } from './navigation-model.mjs';
import { retryMeaning } from './meaning.mjs';

const request = (turn, seq, overrides) => ({ turn, seq, time: seq * 1000, system: 10, tools: 20, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, ...overrides });
const rows = contextByTurn([
  request(1, 1, { assistant: 20 }),
  request(1, 2, { assistant: 50, tool: 100 }),
  request(2, 3, { assistant: 150, tool: 50, output: 1000000, prompt: 3000000 }),
  request(3, 4, { assistant: 120, tool: 200 }),
  request(3, 5, { assistant: 130, tool: 220 }),
]);
assert.equal(rows[0].isBaseline, true);
assert.equal(rows[0].net, 0);
assert.equal(rows[0].parts.assistant.after, 50);
assert.equal(rows[0].steps, 2);
assert.equal(rows[1].increase, 100);
assert.equal(rows[1].decrease, 50);
assert.equal(rows[1].net, 50);
assert.equal(rows[1].parts.tool.delta, -50);
assert.equal(rows[2].seq, 5);
assert.equal(rows[2].steps, 2);
assert.equal(rows[2].net, 150);
assert.equal(rows[2].parts.assistant.delta, -20);
assert.equal(rows[2].parts.tool.delta, 170);
assert.equal(contextByTurn([request(9, 1, {})])[0].isBaseline, true);
assert.deepEqual(contextByTurn([]), []);
for (const row of rows) {
  assert.equal(row.net, row.increase - row.decrease);
  assert.equal(row.net, CONTEXT_CATEGORIES.reduce((n, c) => n + row.parts[c.key].delta, 0));
}
const turn = { number: 4, steps: [
  { number: 1, calls: [{ name: 'edit', seq: 1, status: 'error' }] },
  { number: 2, calls: [{ name: 'edit', seq: 2, status: 'returned' }] },
  { number: 3, calls: [{ name: 'edit', seq: 3, status: 'returned' }] },
  { number: 4, calls: [{ name: 'edit', seq: 4, status: 'returned' }, { name: 'read', seq: 5, status: 'error' }] },
] };
assert.deepEqual([...recoveredStepNumbers(turn, [{ turn: 4, pairs: [{ successSeq: 3 }, { successSeq: 4 }] }])], [3]);
assert.deepEqual([...recoveredStepNumbers(turn, [])], []);
assert.match(retryMeaning([{ started: false, delayMs: 500, failure: { code: 'TRANSPORT' } }], false).why, /0 次已开始/);
assert.match(retryMeaning([{ started: true, delayMs: 500, failure: { code: 'TRANSPORT' } }], true).why, /又尝试了 1 次/);

const fixture = JSON.parse(readFileSync('.dsh/layout-review/context-data.json'));
const real = contextByTurn(fixture.requests);
assert.equal(real.length, 105);
assert.equal(real.find(r => r.turn === 105).net, 7099);
assert.equal(real.find(r => r.turn === 33).net, -421548);
assert.equal(real.find(r => r.turn === 105).parts.assistant.delta, 4370);
assert.equal(real.find(r => r.turn === 105).parts.tool.delta, 2585);
assert.equal(fixture.retries.filter(r => r.started).length, 8);
for (const row of real) assert.equal(row.net, row.increase - row.decrease);
const scale = contextDisplayScale(real);
assert.equal(scale.limit, 30000, 'ordinary scale excludes a large compaction and covers 95% of additions');
assert.deepEqual(contextDisplayScale([...real].reverse()), scale, 'scale does not depend on turn order');
assert.deepEqual(contextDisplayScale([...real, { increase: 0, decrease: 900000, isBaseline: false }]), scale, 'a giant reduction cannot flatten ordinary additions');
assert.ok(contextDisplaySide(7099, scale).height > 25, 'the representative 7k turn is visible without zooming');
assert.equal(contextDisplaySide(0, scale).height, 0);
assert.equal(contextDisplaySide(30000, scale).overflow, false);
assert.equal(contextDisplaySide(30001, scale).overflow, true);
assert.equal(contextDisplaySide(421548, scale).height, scale.pixels);
assert.equal(contextDisplaySide(421548, scale).factor * 421548, scale.pixels);
assert.equal(contextDisplayScale([]).limit, 1000);
assert.ok(contextDisplayScale([{ decrease: 5000 }]).limit > 0);
assert.equal(fixture.boundaries.filter(e => e.kind === 'compaction').length, 2);
assert.equal(fixture.boundaries.filter(e => e.kind === 'prune').length, 17);
assert.deepEqual([...new Set(fixture.boundaries.filter(e => e.kind === 'prune').flatMap(e => e.tools))].sort(),
  ['cordis_inspect_query', 'plugin_manager', 'pwsh', 'read', 'trajectory_read', 'web_fetch'].sort());
assert.equal(contextBarAmounts(real[0]).increase, 97697, 'first bar shows existing composition without changing zero delta semantics');
assert.equal(real[0].net, 0);
assert.equal(contextBarAmounts(real[0]).values.system, 1448);
assert.equal(fixture.requests[0].total, 13085);
assert.equal(contextBarAmounts(real.at(-1)).increase, real.at(-1).increase);
for (const widths of [[1, 1, 1], [120, 1, 2, 300, 4], Array(105).fill(5)]) {
  let x = 0;
  const layout = widths.map((width, i) => { const row = { x, end: x + width, turn: { number: i + 1, start: 0, end: i + 1, steps: [{}] } }; x += width + 2; return row; });
  for (const minWidth of [80, 112, 300]) {
    const packed = durationGroups(layout, minWidth);
    assert.deepEqual(packed.flatMap(g => g.rows.map(r => r.turn.number)), layout.map(r => r.turn.number), 'short turns are included exactly once');
    assert.equal(packed.reduce((n, g) => n + g.duration, 0), widths.length * (widths.length + 1) / 2);
  }
}
const zoomLayout = [{ x: 0, end: 800, turn: { number: 59, steps: [{}] } }];
assert.equal(semanticZoomTarget(zoomLayout, 400, 800)?.turn.number, 59);
assert.equal(semanticZoomTarget(zoomLayout, 850, 800), null, 'between-turn gap must not select a different turn');
assert.equal(semanticZoomTarget(zoomLayout, 400, 1400), null, 'multi-turn overview must not jump to actions');
assert.ok(fixture.supplementSources.some(s => s.kind === 'runtime-context'));
assert.ok(fixture.boundaries.filter(e => e.kind === 'prune').every(e =>
  e.replaced.length > 0 && e.replaced.every(r => r.seq < e.seq && r.turn > 0 && r.tool)));
console.log('PASS context delta semantics, recorded-session parity, recovery evidence and retry-start distinction');
