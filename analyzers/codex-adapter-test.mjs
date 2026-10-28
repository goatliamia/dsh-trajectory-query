import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { adaptCodexThread, classifyCodexItem, commandReadEvidence, parseCodexRollout } from './codex-adapter.mjs';
import { fileObjects } from '../docs/demo/layout-review/file-model.mjs';
import { contextByTurn } from '../docs/demo/layout-review/context-model.mjs';
import { collectToolResults } from '../docs/demo/layout-review/tool-result-model.mjs';

const command = (id, command, exitCode = 0) => ({ type: 'commandExecution', id, command, commandActions: [{ type: 'unknown', command }], aggregatedOutput: exitCode ? 'file not found' : 'recorded output', status: 'completed', exitCode, durationMs: 3 });
assert.equal(classifyCodexItem(command('1', 'Get-Content src/main.js')).kind, 'read');
assert.equal(classifyCodexItem(command('1', 'rg --files')).kind, 'query');
assert.equal(commandReadEvidence('Get-Content -LiteralPath "a b/SKILL.md"')[0].path, 'a b/SKILL.md');
assert.equal(commandReadEvidence('Get-Content $variable').length, 0);
assert.equal(commandReadEvidence('Get-Content C:\\a\\SKILL.md', [{ type: 'read', path: 'C:\\a\\SKILL.md' }]).length, 1);
const fixture = { capturedAt: '2026-01-01T00:00:10Z', source: 'fixture', thread: { id: 'fixture', cwd: '/project', createdAt: 1767225600, turns: [{ id: 't1', startedAt: 1767225600, completedAt: 1767225610, status: 'completed', items: [{ type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'read file' }, { type: 'skill', name: 'test-skill', path: '/skill/SKILL.md' }] }, command('c1', 'Get-Content missing.js', 1), command('c2', 'Get-Content missing.js'), { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: '/project/a.js', kind: { type: 'update' }, diff: '-old\n+new' }] }] }] } };
const raw = [
  { timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'fixture' } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'turn_context', payload: { turn_id: 't1', model: 'fixture-model' } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'user text' }] } },
  { timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'item_completed', item: { id: 'c1' }, turn_id: 't1', started_at_ms: 1767225600100, completed_at_ms: 1767225601000 } },
  { timestamp: '2026-01-01T00:00:02Z', type: 'event_msg', payload: { type: 'item_completed', item: { id: 'c2' }, turn_id: 't1', started_at_ms: 1767225601100, completed_at_ms: 1767225602000 } },
  { timestamp: '2026-01-01T00:00:03Z', type: 'compacted', payload: { replacement_history: [{ type: 'message', role: 'user', content: [{ text: 'skill catalog /foo/SKILL.md' }] }] } },
  { timestamp: '2026-01-01T00:00:03Z', type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { input_tokens: 240, output_tokens: 20 } } } },
  { timestamp: '2026-01-01T00:00:11Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 999999 } } } },
].map(JSON.stringify).join('\n');
const apiOnly = adaptCodexThread(fixture);
assert.equal(apiOnly.officialStats.context.pressure.pressureTokens, null, 'missing usage is null');
assert.equal(apiOnly.context.requests.length, 0, 'API alone does not invent category quantities');
assert.ok(apiOnly.sessions[0].turns[0].steps.every(s => !s.endObserved));
const adapted = adaptCodexThread(fixture, { rollout: raw }), session = adapted.sessions[0];
assert.equal(adapted.evidence.timingMatched, 2);
assert.equal(adapted.officialStats.context.pressure.pressureTokens, 240, 'cutoff excludes future telemetry');
assert.equal(adapted.context.skillEvents.length, 1, 'catalog paths are not loaded skill content');
assert.equal(adapted.context.fileOperations.find(o => o.path.endsWith('missing.js')).status, 'error');
assert.equal(session.overview.episodes[0].complete, true, 'identical later operation succeeds');
assert.ok(Object.values(adapted.context.callFacts).some(f => f.diffChanges?.[0]?.diff.text === '-old\n+new'));
assert.ok(collectToolResults(session, adapted.context.callFacts, adapted.context.fileOperations).length);
assert.ok(fileObjects(adapted.context.fileOperations).length);
assert.ok(contextByTurn(adapted.context.requests).length);
assert.throws(() => parseCodexRollout(raw, { threadId: 'different' }), /differs/);
const textMaterial = 'Skill instruction example. '.repeat(10);
const mixed = [{ timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'custom_tool_call_output', output: [{ type: 'input_text', text: JSON.stringify({ status: 'fulfilled', value: { output: textMaterial + '\nordinary file content' } }) }, { type: 'input_image', image_url: 'data:image/png;base64,' + 'x'.repeat(50000) }] } }].map(JSON.stringify).join('\n');
const mixedParsed = parseCodexRollout(mixed, { skillMaterials: [{ path: '/skill/SKILL.md', text: textMaterial }] });
assert.ok(mixedParsed.current.skill > 0 && mixedParsed.current.tool < 100, 'only exact skill bytes are classified, media payloads excluded');
const stableFixture = structuredClone(fixture); stableFixture.thread.turns[0].items.push(command('unmeasured-after', 'echo after'));
const stable = adaptCodexThread(stableFixture, { rollout: raw });
assert.deepEqual(stable.sessions[0].turns[0].steps.flatMap(s => s.calls.map(c => c.id)), ['c1', 'c2', 'f1', 'unmeasured-after'], 'missing timestamps never reorder native items to the turn start');
if (existsSync('.dsh/codex-review/current-thread.json')) {
  const snapshot = JSON.parse(readFileSync('.dsh/codex-review/current-thread.json', 'utf8'));
  const real = adaptCodexThread(snapshot, { rollout: readFileSync(snapshot.thread.path, 'utf8') });
  assert.equal(real.sessions[0].totals.turns, snapshot.thread.turns.length);
  assert.ok(real.evidence.timingMatched > 700);
  assert.ok(real.context.fileOperations.some(op => op.kind === 'read' && op.source === 'estimate'));
  assert.ok(real.context.fileOperations.some(op => op.kind === 'change' && op.diff?.text));
  assert.ok(real.context.boundaries.length >= 3);
  assert.ok(real.context.usage.length > 300);
  assert.ok(real.context.requests.every(r => r.source === 'estimate' && r.semanticUnit === 'visible-retained-text-after-action'));
  console.log('Real snapshot:', real.sessions[0].totals, 'measured timings:', real.evidence.timingMatched, 'skill evidence:', real.context.skillEvents.length, 'collaboration:', real.context.collaborationEvents.length);
}
console.log('Codex adapter tests passed: independent classification, failures, recovery, cutoff, timings, estimates, common file/context/result models.');
