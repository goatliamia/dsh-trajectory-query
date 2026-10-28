import assert from 'node:assert/strict';
import { layoutAnnotations, routeAnnotations, roundedPath } from './layout.mjs';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const describe = members => ({ width: members.length === 1 ? 114 : 140 });
const fixtures = [
  [], [{ id: 'one', x: 32 }],
  Array.from({ length: 160 }, (_, i) => ({ id: String(i), x: 80 + i % 8 * 2 })),
  Array.from({ length: 1000 }, (_, i) => ({ id: String(i), x: 32 + ((i * 421) % 500) })),
  Array.from({ length: 60 }, (_, i) => ({ id: String(i), x: 32 + i * 8 })),
];
for (const width of [216, 320, 640, 1200]) for (const items of fixtures) {
  const options = { left: 24, right: width - 24, rows: 3, describe };
  const layout = layoutAnnotations(items, options);
  check(layout.rows <= 3, 'height must remain bounded');
  assert.deepEqual(layout.nodes.flatMap(n => n.members.map(m => m.id)).sort(), items.map(m => m.id).sort()); checks++;
  assert.deepEqual(layout, layoutAnnotations([...items].reverse(), options)); checks++;
  for (const n of layout.nodes) {
    check(n.left >= options.left && n.right <= options.right + .001, 'label must remain inside plot');
    check(n.members.every(m => items.find(i => i.id === m.id).x === m.x), 'event time anchor cannot move');
    for (const b of layout.nodes) if (n !== b && n.row === b.row) check(n.right + 13.99 <= b.left || b.right + 13.99 <= n.left, 'labels must not collide');
  }
  const routed = routeAnnotations(layout.nodes, { left: 24, right: width - 24, baseline: 100, firstY: 140, rowGap: 62 });
  for (const route of routed.routes) {
    check(!/NaN|Infinity/.test(roundedPath(route.points)), 'path coordinates must be finite');
    for (let k = 1; k < route.points.length; k++) {
      const [x1, y1] = route.points[k - 1], [x2, y2] = route.points[k];
      check(x1 === x2 || y1 === y2, 'route must be orthogonal before rounding');
      for (const box of routed.boxes) {
        const crosses = x1 === x2
          ? x1 > box.left + .01 && x1 < box.right - .01 && Math.max(y1, y2) > box.top + .01 && Math.min(y1, y2) < box.bottom - .01
          : y1 > box.top + .01 && y1 < box.bottom - .01 && Math.max(x1, x2) > box.left + .01 && Math.min(x1, x2) < box.right - .01;
        check(!crosses, 'connector cannot cut through a label');
      }
    }
  }
}
const few = Array.from({ length: 12 }, (_, i) => ({ id: String(i), x: 32 + i * 4 }));
const compact = layoutAnnotations(few, { left: 24, right: 616, rows: 3, describe });
const expanded = layoutAnnotations(few.map(e => ({ ...e, x: e.x * 40 })), { left: 24, right: 4000, rows: 3, describe });
check(expanded.nodes.length > compact.nodes.length, 'zoom must reveal previously grouped events');
const retry = layoutAnnotations(fixtures[3], { left: 24, right: 616, rows: 1, describe: m => ({ width: 35 + String(m.length).length * 7 }) });
check(retry.rows === 1 && retry.nodes.flatMap(n => n.members).length === 1000, 'retries stay in one row without loss');
console.log('PASS ' + checks + ' layout invariants across sparse, dense, coincident and narrow layouts');
