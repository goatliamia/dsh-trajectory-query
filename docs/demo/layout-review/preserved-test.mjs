import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { aggregateInScreen, layoutBranches } from './branch-layout.mjs';
import { episodeMeaning, stepMeaning, retryMeaning, turnMeaning } from './meaning.mjs';
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
for (const width of [320, 800, 1400]) for (const count of [0, 1, 16, 160, 1000]) {
  const items = Array.from({ length: count }, (_, i) => ({ id: 'e' + i, x: 54 + ((i * 97) % 1000) / 1000 * (width - 108) }));
  const options = { left: 20, right: width - 20, measure: text => text.length * 11.5, labelOf: ms => ms.length > 1 ? ms.length + ' 处受阻' : '06 · 先看后改好' };
  const placed = layoutBranches(items, options);
  assert.deepEqual(placed.flatMap(p => p.members.map(m => m.id)).sort(), items.map(i => i.id).sort()); checks++;
  assert.deepEqual(placed, layoutBranches([...items].reverse(), options)); checks++;
  for (const p of placed) {
    check(p.dy >= -94 && p.dy <= 122, 'branch height bounded');
    check(p.members.some(m => m.x === p.x), 'anchor belongs to original event');
    for (const q of placed) if (p !== q) {
      check(!(p.left < q.right + 10 && p.right + 10 > q.left && p.top < q.bottom + 5 && p.bottom + 5 > q.top), 'annotation boxes do not overlap');
      check(!(p.x > q.left - 4 && p.x < q.right + 4 && Math.max(0, p.dy) > q.top - 4 && Math.min(0, p.dy) < q.bottom + 4), 'stem does not cross another label');
    }
  }
}
check(episodeMeaning({ condition: 'FS_NOT_OBSERVED', complete: false, readConfirmed: true }).short !== '先看后改好', 'a read alone does not prove the write succeeded');
check(episodeMeaning({ condition: 'FS_NOT_OBSERVED', complete: true, readConfirmed: true }).short === '先看后改好', 'confirmed recovery has ordinary-language label');
check(!episodeMeaning({ condition: 'OTHER', complete: false }).outcome.includes('任务失败'), 'missing recovery is not task failure');
check(stepMeaning({ calls: [{ name: 'read', status: 'unknown' }] }).missing === 1, 'missing result stays unknown');
check(stepMeaning({ calls: [{ name: 'pwsh', status: 'returned' }] }).outcome === '1 次操作均已返回。', 'command return does not assert the task passed');
check(retryMeaning([{ failure: { code: 'TRANSPORT' }, delayMs: 500 }], false).outcome.includes('还没有'), 'retry does not imply recovery');
check(turnMeaning({ steps: [{ calls: [{ name: 'edit', status: 'error', target: '/x' }, { name: 'edit', status: 'returned', target: '/y' }, { name: 'edit', status: 'returned', target: '/y' }] }] }).files.length === 1, 'file-change summary excludes failed calls and counts unique targets');
const density = [0, 4, 9, 11, 20, 24, 40, 43].map((at, i) => ({ id: 'density-' + i, at, x: at }));
let prior = aggregateInScreen(density, 30);
for (const scale of [2, 4, 8, 16]) {
  const now = aggregateInScreen(density.map(x => ({ ...x, x: x.at * scale })), 30);
  check(now.every(group => prior.some(parent => group.every(item => parent.some(p => p.id === item.id)))), 'zoom splits the same hierarchy rather than mixing nearby records');
  check(now.length >= prior.length, 'zoom reveals more groups');
  prior = now;
}
assert.deepEqual(aggregateInScreen(density.map(x => ({ ...x, x: x.x + 1000 })), 30).map(g => g.map(x => x.id)),
  aggregateInScreen(density, 30).map(g => g.map(x => x.id))); checks++;
const real = JSON.parse(readFileSync('.dsh/layout-review/installed-trace.html', 'utf8').match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).sessions[0];
let offset = 0;
const offsets = new Map(real.turns.map(t => { const start = offset; offset += t.end - t.start; return [t.number, { start, time: t.start }]; }));
const events = real.overview.episodes.map(e => ({ id: e.id, at: offsets.get(e.turn).start + e.firstError - offsets.get(e.turn).time, e }));
const counts = [1, 4, 16, 64].map(scale => layoutBranches(events.map(e => ({ ...e, x: 54 + e.at / offset * 700 * scale })), {
  left: 20, right: 800 * scale, measure: s => s.length * 11.5,
  labelOf: group => group.length > 1 ? group.length + ' 处受阻' : episodeMeaning(group[0].e).short,
}).length);
check(counts.at(-1) > counts[0], 'the installed session expands under zoom');
console.log('Real-session branch counts at 1/4/16/64×: ' + counts.join('/'));
const page = readFileSync('.dsh/layout-review/preserved.html', 'utf8');
for (const [, source] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(source);
check(page.includes('查看本轮行动路径') && page.includes('返回执行全景') && page.includes('reviewOverviewBookmark'), 'direct navigation and return-state hooks are bundled');
check(!page.includes('A4.5 4.5 0 1 0'), 'repeated loop icons are absent from the new retry renderer');
checks++;
console.log('PASS ' + checks + ' preserved-layout and evidence-to-language checks');
