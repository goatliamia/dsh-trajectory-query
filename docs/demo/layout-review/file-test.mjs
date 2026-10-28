import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileIdentity, fileObjects, packFileObjects, fileTouchClusters, fileChangeHistory } from './file-model.mjs';

assert.equal(fileIdentity('C:\\Work\\A.ts'), fileIdentity('c:/work/a.ts'));
assert.equal(fileIdentity('\\\\SERVER\\Share\\A.ts'), '//server/share/a.ts');
assert.notEqual(fileIdentity('/work/A.ts'), fileIdentity('/work/a.ts'));
const op = (seq, path, kind = 'read', status = 'returned', turn = 1) => ({ seq, path, kind, status, turn, step: seq });
const objects = fileObjects([
  op(1, 'C:\\Work\\a.ts'), op(2, 'c:/work/a.ts', 'change'), op(3, 'C:/Work/a.ts', 'change', 'error'),
  op(4, '/only-read.ts', 'read', 'error'), op(5, '/src/a.ts'), op(6, '/test/a.ts'), op(7, '/later.ts', 'change', 'returned', 2),
], new Set([1]));
assert.equal(objects.length, 4);
assert.deepEqual(objects[0].operations.map(o => o.seq), [1, 2, 3]);
assert.equal(objects[0].changes.length, 1, 'failed edits are not successful changes');
assert.equal(objects[0].lane, 'change');
assert.equal(objects[1].lane, 'read', 'a failed read must not become a modification');
assert.deepEqual(objects.slice(2).map(f => f.label), ['src/a.ts', 'test/a.ts']);

let layouts = 0;
for (const width of [110, 320, 800, 1280]) for (const count of [0, 1, 6, 80, 250]) {
  const items = Array.from({ length: count }, (_, i) => ({ x: 10 + ((i * 97) % 997) / 997 * (width - 20), file: { id: 'f' + i } }));
  for (const obstacles of [[], [{ left: width * .3, right: width * .4 }], [{ left: 0, right: width }]]) {
    const options = { left: 10, right: width - 10, measure: text => text.length * 6, label: ms => ms.length === 1 ? 'a-long-file-name.ts' : ms.length + ' files', obstacles };
    const packed = packFileObjects(items, options);
    assert.deepEqual(packed.flatMap(p => p.members.map(m => m.file.id)).sort(), items.map(m => m.file.id).sort(), 'aggregation preserves every file');
    assert.deepEqual(packed, packFileObjects([...items].reverse(), options), 'deterministic for unordered input');
    const visible = packed.filter(p => !p.hidden).sort((a, b) => a.left - b.left);
    for (const [i, p] of visible.entries()) {
      assert.ok(p.left >= 10 && p.right <= width - 10, 'objects stay in bounds');
      if (i) assert.ok(p.left >= visible[i - 1].right + 7.999, 'objects do not overlap');
      assert.ok(obstacles.every(o => p.right <= o.left - 7.999 || p.left >= o.right + 7.999), 'objects avoid context and compression marks');
    }
    layouts++;
  }
}
const points = Array.from({ length: 200 }, (_, i) => ({ x: i * 3, operation: op(i, '/a', i % 2 ? 'change' : 'read') }));
const clusters = fileTouchClusters(points);
assert.deepEqual(clusters.flatMap(c => c.members.map(m => m.operation.seq)).sort((a, b) => a - b), points.map(p => p.operation.seq));
for (const kind of ['read', 'change']) {
  const row = clusters.filter(c => c.kind === kind);
  for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i - 1].x >= 24, 'dense touches remain distinct');
}
assert.ok(fileTouchClusters(points.map(p => ({ ...p, x: p.x * 8 }))).length > clusters.length, 'zoom reveals more touch points');
const fixture = JSON.parse(readFileSync('.dsh/layout-review/context-data.json'));
const files35 = fileObjects(fixture.fileOperations, new Set([35]));
const client = files35.find(f => f.label === 'client.js');
assert.equal(client.reads.length, 2);
assert.equal(client.changes.length, 3);
assert.equal(client.failed.length, 1);
assert.deepEqual(client.operations.map(o => o.seq), [5184, 5186, 5192, 5198, 5204, 5210]);
const files9 = fileObjects(fixture.fileOperations, new Set([9]));
assert.equal(files9.filter(f => f.lane === 'read').length, 1);
assert.equal(files9.filter(f => f.lane === 'change').length, 3);
const wholeClient = fileChangeHistory(fixture.fileOperations, client.id);
assert.equal(wholeClient.operations.length, 197, 'opening from turn 35 still returns the complete file history');
assert.equal(wholeClient.reads.length, 88);
assert.equal(wholeClient.changes.length, 104);
assert.equal(wholeClient.failed.length, 5);
assert.equal(wholeClient.rounds.find(r => r.turn === 35).operations.length, 6);
assert.ok(wholeClient.rounds.some(r => r.turn < 35) && wholeClient.rounds.some(r => r.turn > 35));
assert.deepEqual(wholeClient.rounds.flatMap(r => r.operations.map(o => o.seq)), wholeClient.operations.map(o => o.seq), 'grouping by turn loses no records');
assert.equal(fileChangeHistory(fixture.fileOperations, '/no-such-file'), null);
const onlyRead = fileChangeHistory([op(1, '/read.ts'), op(2, '/read.ts', 'read', 'error', 2)], '/read.ts');
assert.equal(onlyRead.changeRounds.length, 0);
assert.equal(onlyRead.rounds.length, 2);
assert.equal(onlyRead.failed.length, 1);
console.log('PASS file objects: path identity, actual vs failed operations, scope, ' + layouts + ' bounded layouts, touch aggregation, recorded read/change sequences');
