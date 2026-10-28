import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changedLines, compactDiff } from './diff-model.mjs';
import { describeCall } from './step-insight.mjs';
function roundtrip(before, after) {
  const rows = changedLines(before, after);
  assert.equal(rows.filter(r => r.kind !== 'add').map(r => r.text).join('\n'), before.replace(/\r\n/g, '\n'));
  assert.equal(rows.filter(r => r.kind !== 'remove').map(r => r.text).join('\n'), after.replace(/\r\n/g, '\n'));
  assert.deepEqual(rows.filter(r => r.before != null).map(r => r.before), Array.from({ length: before === '' ? 0 : before.split('\n').length }, (_, i) => i + 1));
  assert.deepEqual(rows.filter(r => r.after != null).map(r => r.after), Array.from({ length: after === '' ? 0 : after.split('\n').length }, (_, i) => i + 1));
  return rows;
}
roundtrip('', '');
roundtrip('', '  new\n\tline');
roundtrip('old\n', '');
roundtrip('a\r\n  old\r\nz', 'a\r\n  new\r\nz');
const before = Array.from({ length: 40 }, (_, i) => '  line ' + i).join('\n');
const after = before.replace('line 20', 'changed 20');
const rows = roundtrip(before, after);
const folded = compactDiff(rows);
assert.ok(folded.some(r => r.kind === 'fold'));
assert.equal(folded.filter(r => r.kind === 'remove').length, 1);
assert.equal(folded.filter(r => r.kind === 'add').length, 1);
assert.equal(folded.reduce((n, r) => n + (r.kind === 'fold' ? r.count : 1), 0), rows.length);
roundtrip(Array(650).fill('a').join('\n'), Array(650).fill('b').join('\n'));
const preview = describeCall({ name: 'edit', seq: 1, resultSeq: 2, status: 'returned',
  args: { text: JSON.stringify({ old_string: before, new_string: after }), omitted: 0 },
  result: { text: 'The file has been updated successfully.', omitted: 0 } }).preview;
assert.equal(preview.before, before, 'preserve indentation and unchanged context instead of a three-line excerpt');
assert.equal(preview.after, after);
assert.equal(preview.partial, false);
const fixture = JSON.parse(readFileSync('.dsh/layout-review/context-data.json'));
const examples = Object.values(fixture.callFacts).filter(f => f.preview);
for (const fact of examples) roundtrip(fact.preview.before, fact.preview.after);
console.log('PASS diff reconstruction, line numbers, folding, indentation and ' + examples.length + ' recorded edit fragments');
