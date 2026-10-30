import assert from 'node:assert/strict';
import { compactTrendPolyline } from './context-trend-model.mjs';

// A dense straight run is identical SVG geometry after compaction.
const flat = Array.from({ length: 10000 }, (_, x) => [x / 10, 42]);
assert.deepEqual(compactTrendPolyline(flat), ['0,42', '999.9,42']);
assert.deepEqual(compactTrendPolyline([[0, 0], [1, 1], [2, 2]]), ['0,0', '2,2']);
assert.deepEqual(compactTrendPolyline([[0, 0], [1, 1], [2, 0]]), ['0,0', '1,1', '2,0']);
// Same-time compaction drops and subsequent growth must stay visible.
const cut = [[0, 0], [1, 10], [1, 2], [2, 3], [3, 4]];
assert.deepEqual(compactTrendPolyline(cut), ['0,0', '1,10', '1,2', '3,4']);
assert.deepEqual(compactTrendPolyline([[1, 2], [1, 2], [1, 3], [1, 2]]), ['1,2', '1,3', '1,2']);
assert.deepEqual(compactTrendPolyline([]), []);
assert.deepEqual(compactTrendPolyline([[1.335, 2.675]]), ['1.33,2.67']);
// Verify the entire geometry, not just selected examples: every removed point
// lies on an output segment in traversal order at the original SVG precision.
for (let seed = 1; seed <= 20; seed++) {
  const input = Array.from({ length: 2000 }, (_, i) => [i / 10, Math.floor(i / (seed + 1)) % 17]);
  const output = compactTrendPolyline(input).map(value => value.split(',').map(Number));
  let segment = 1;
  for (const [x, y] of input) {
    while (segment < output.length - 1 && output[segment][0] < x) segment++;
    const a = output[segment - 1], b = output[segment];
    const expected = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    assert.ok(Math.abs(y - expected) < 1e-8);
  }
}
console.log('Trend geometry: dense plateaus compacted; exact segments, peaks, compaction drops and reversals preserved.');
