import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('.dsh/skill-review/graph-data.json', 'utf8'));
assert.equal(data.synthetic, true);
assert.equal(data.skillStudy.synthetic, true);
const session = data.sessions[0], boundary = data.context.boundaries.find(e => e.kind === 'compaction');
const [report, csv] = data.skillStudy.skills;
assert.equal(report.reads.length, 2);
assert.equal(csv.reads.length, 1);
assert.equal(report.intervals[0].to, boundary.time, 'the first retention interval ends at the recorded synthetic compaction');
assert.ok(report.intervals[1].from > boundary.time, 'retention resumes only after the explicit second read');
assert.equal(csv.intervals.length, 1, 'CSV must not inherit the other skill reread');
assert.equal(csv.intervals[0].to, boundary.time);
for (const skill of data.skillStudy.skills) for (const relation of skill.relations) {
  const step = session.turns.find(t => t.number === relation.turn).steps.find(s => s.number === relation.step);
  assert.equal(relation.quote, step.reply.text);
  assert.ok(relation.quote.includes(skill.name));
  assert.ok(relation.seqs.length && relation.seqs.every(seq => step.calls.some(c => c.seq === seq)));
}
const reportSeqs = new Set(report.relations.flatMap(r => r.seqs));
const csvSeqs = new Set(csv.relations.flatMap(r => r.seqs));
assert.ok([...reportSeqs].every(seq => !csvSeqs.has(seq)), 'distinct skill selections have distinct reference evidence');
console.log('PASS explicitly synthetic Skill study, read/compaction intervals, exact quote evidence, distinct selection associations');
