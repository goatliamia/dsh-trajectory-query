import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(await readFile(new URL('../plugin/claude/hooks/hooks.json', import.meta.url), 'utf8'));
assert.deepEqual(Object.keys(config.hooks), ['SessionStart']);
const matcher = new RegExp('^(?:' + config.hooks.SessionStart[0].matcher + ')$');
for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
  assert.match(source, matcher);
  const event = { hook_event_name: 'SessionStart', source, session_id: 's-123', transcript_path: 'C:\\sessions\\s-123.jsonl' };
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../plugin/claude/scripts/bind-session.mjs', import.meta.url))], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'SessionStart');
  assert.ok(output.additionalContext.includes(JSON.stringify(event.session_id)));
  assert.ok(output.additionalContext.includes(JSON.stringify(event.transcript_path)));
}
console.log('Claude SessionStart hook contract passed');
