import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillContents, directlyInvokedScripts } from './dsh-skill-evidence.mjs';

const content = skillContents('<skill_instructions>Use `read` for evidence. Mentioning readline is not read.\npython scripts/check.py input\nnode scripts/report.mjs\n</skill_instructions>', ['read', 'readline', 'edit']);
assert.deepEqual(content.tools.map(t => t.name), ['read']);
assert.deepEqual(content.scripts.map(s => s.path), ['scripts/check.py', 'scripts/report.mjs']);
assert.deepEqual(directlyInvokedScripts('echo "python scripts/check.py"'), [], 'quoted prose is not command execution');
assert.deepEqual(directlyInvokedScripts('rg "node scripts/report.mjs" README.md'), [], 'searching a command is not execution');
assert.deepEqual(directlyInvokedScripts('python scripts/check.py; node scripts/report.mjs'), ['scripts/check.py', 'scripts/report.mjs']);
const analysis = JSON.parse(readFileSync('.dsh/layout-review/actor-data.json', 'utf8')).skillAnalysis;
assert.equal(analysis.source, '@deepseek-ai/dsh-session/surface');
assert.equal(analysis.records.length, 3);
for (const record of analysis.records) {
  assert.equal(record.intervals.length, 1);
  assert.equal(record.intervals[0].fromSeq, record.resultSeq);
  assert.equal(record.intervals[0].toSeq, 5039, 'canonical replacement removes the body, not merely a compaction-start marker');
  assert.equal(record.intervals[0].endReason, 'surface-replaced');
  assert.ok(record.intervals[0].requests > 0);
  assert.equal(record.matches.length, 0, 'scope must not invent generic tool ownership or use');
}
assert.equal(analysis.records.find(r => r.name === 'plugin-compat').scripts.length, 2);
assert.equal(analysis.records.find(r => r.name === 'agent-experience').mentions[0].turn, 3);
console.log('PASS native retained-body boundaries, historical skill content, literal tool references and executable script positions; no temporal-to-causal attribution');
