import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeTranscript } from './claude-reader.mjs';
import { projectClaudeTranscript, finalizeClaudeDataset } from './claude-adapter.mjs';
import { datasetFromNative } from '../plugin/portable-tools/sources.mjs';
import { PortableService } from '../plugin/portable-tools/service.mjs';

const dir = await mkdtemp(join(tmpdir(), 'trajectory-claude-'));
try {
  const file = join(dir, 'session.jsonl');
  const base = { sessionId: 'test', timestamp: '2026-01-01T00:00:00Z', cwd: dir };
  const rows = [
    { ...base, type: 'user', message: { content: 'inspect' } },
    { ...base, uuid: 'a1', type: 'assistant', message: { id: 'm1', usage: { input_tokens: 7, cache_read_input_tokens: 8 }, content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.txt', signature: 'literal' } }] } },
    { ...base, uuid: 'u2', type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'long'.repeat(10000) }] } },
    { ...base, uuid: 'a2', type: 'assistant', message: { id: 'm1', usage: { output_tokens: 3, cache_creation_input_tokens: 2 }, content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.txt', signature: 'literal' } }, { type: 'text', text: 'done' }] } },
  ];
  await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const native = await readClaudeTranscript(file), data = finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(native)), native);
  assert.equal(data.host, 'claude'); assert.equal(data.session, 'test');
  assert.equal(data.payload.sessions[0].totals.calls, 1);
  assert.equal(data.payload.sessions[0].turns[0].steps[0].calls[0].status, 'returned');
  const call = data.records.find(r => r.kind === 'call'), result = data.records.find(r => r.kind === 'result');
  assert.equal(call.name, 'Read'); assert.deepEqual(call.arguments, { file_path: 'a.txt', signature: 'literal' });
  assert.equal(call.native.uuid, 'a1'); assert.equal(call.native.line, 2); assert.equal(result.body.content.length, 40000);
  const service = new PortableService({ load: async () => data });
  let offset = 0, reconstructed = '';
  do {
    const part = await service.call('trajectory_read', { seq: call.seq, field: 'result', offset, maxChars: 10000 });
    reconstructed += part.text; offset = part.nextRead?.offset ?? null;
  } while (offset !== null);
  assert.equal(JSON.parse(reconstructed).content, 'long'.repeat(10000)); service.dispose();
  assert.deepEqual(data.payload.context.usage.map(x => x.usage), [{ input: 7, output: 3, cacheRead: 8, cacheWrite: 2 }]);
  const firstFingerprint = data.fingerprint;
  assert.deepEqual(data.payload.context.requests, []); assert.equal(data.payload.context.current, null);
  await assert.rejects(readClaudeTranscript(), /explicit transcript/);
  await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n{"partial"');
  assert.equal((await readClaudeTranscript(file)).source.incompleteTail, true);
  const changed = await readClaudeTranscript(file);
  assert.notEqual(finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(changed)), changed).fingerprint, firstFingerprint);
  await writeFile(file, [rows[0], { ...rows[1], sessionId: 'other' }].map(JSON.stringify).join('\n'));
  await assert.rejects(readClaudeTranscript(file), /exactly one session/);
  rows[2].message.content[0].is_error = true;
  await writeFile(file, rows.map(JSON.stringify).join('\n'));
  const failed = await readClaudeTranscript(file), errorData = finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(failed)), failed);
  const episode = errorData.payload.sessions[0].overview.episodes[0];
  assert.equal(episode.condition, 'CLAUDE_TOOL_ERROR'); assert.equal(episode.source, 'claude-transcript'); assert.match(episode.id, /^claude-/);
  console.log('Claude transcript adapter checks passed');
} finally { await rm(dir, { recursive: true, force: true }); }
