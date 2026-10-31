import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import { readPiSession } from '../../analyzers/pi-reader.mjs';
import { readCodexHistory } from '../../analyzers/codex-reader.mjs';
import { datasetFromNative } from './sources.mjs';
import { PortableService } from './service.mjs';
import { executeTool } from './tools.mjs';

const input = createPiSample({ version: '1.4.0', revision: 'fixture' });
input.scope = { source: 'pi-sdk-test', observedAt: '2026-10-30T00:00:00Z', systemPrompt: 'system', contextWindow: 200000, tools: [{ name: 'unused_capability', active: true, exposure: 'inline', description: '保持完整能力。'.repeat(5000), parameters: { type: 'object', properties: { path: { type: 'string' } } } }] };
const rawCall = input.entries.flatMap(e => e.message?.role === 'assistant' ? e.message.content : []).find(c => c.type === 'toolCall');
rawCall.arguments.longArgument = '精确参数'.repeat(10000);
rawCall.arguments.literalConfiguration = { type: 'reasoning', text: 'a literal tool parameter, not a hidden reasoning block' };
const service = new PortableService({ load: async () => datasetFromNative('pi', input) });
try {
  const first = await executeTool(service, 'trajectory_inspect', { limit: 2 });
  assert.equal(first.summary.unit, 'assistant-cycle'); assert.equal(first.summary.usage.input, 111300);
  assert.equal(first.summary.usage.cachedInput, 31800); assert.equal(first.synthetic, true);
  assert.equal(first.summary.measuredToolIntervals, 12); assert.ok(first.summary.toolCoveredMs <= first.summary.observedTurnSpanMs);
  const page = await executeTool(service, 'trajectory_inspect', { cursor: first.cursor, snapshot: first.snapshot, limit: 2 });
  assert.equal(page.rows[0].turn, 3); assert.ok(!('method' in page)&&!('methodRef' in page)&&!('reportRule' in page));
  for (const view of ['overview', 'latency', 'cost', 'repeats', 'io', 'context']) {
    for (const result of [await executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, view }), page]) {
      for (const key of ['method', 'methodRef', 'outputRule', 'reportRule']) assert.ok(!(key in result), 'Evidence results do not carry teaching fields: ' + view + '.' + key);
    }
  }
  await assert.rejects(executeTool(service, 'trajectory_inspect', { cursor: first.cursor, focus: { tool: 'read' } }), /Cursor/);
  await assert.rejects(executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, session: 'other' }), /another session/);
  await assert.rejects(executeTool(service, 'trajectory_inspect', { view: 'unknown' }), /Invalid/);
  const definitions = await executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, view: 'cost', groupBy: 'definition', focus: { tool: 'unused_capability' } });
  assert.equal(definitions.rows.length, 1); assert.equal(definitions.rows[0].directCallsInRange, 0); assert.equal(definitions.rows[0].active, true);
  const { tool: _, linked, ...defRead } = definitions.rows[0].read;
  const definition = await executeTool(service, 'trajectory_read', { ...defRead, maxChars: 24000 });
  assert.ok(definition.nextRead); assert.equal(definition.native.tool, 'unused_capability');
  const signatureOnly = await executeTool(service, 'trajectory_read', { ...defRead, field: 'parameters' }); assert.equal(JSON.parse(signatureOnly.text).type, 'object'); assert.ok(!signatureOnly.nextRead);
  const entry = service.entries.get(first.snapshot), originalCall = entry.data.payload.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).find(c => c.id === rawCall.id);
  let args = { snapshot: first.snapshot, seq: originalCall.seq, field: 'arguments', maxChars: 7000 }, joined = '';
  do { const piece = await executeTool(service, 'trajectory_read', args); joined += piece.text; if (!piece.nextRead) break; const { tool, ...rest } = piece.nextRead; args = rest; } while (true);
  assert.equal(JSON.parse(joined).longArgument, rawCall.arguments.longArgument, 'long arguments are available without adapter excerpt loss');
  assert.deepEqual(JSON.parse(joined).literalConfiguration, rawCall.arguments.literalConfiguration);
  const linkedRead = await executeTool(service, 'trajectory_read', { snapshot: first.snapshot, seq: originalCall.seq, linked: true });
  assert.ok(linkedRead.linked.some(r => r.kind === 'result')); assert.ok(linkedRead.linked.some(r => r.kind === 'call'));
  rawCall.arguments.longArgument = 'changed after snapshot';
  const old = await executeTool(service, 'trajectory_read', { snapshot: first.snapshot, seq: originalCall.seq, field: 'arguments', maxChars: 1000 });
  assert.ok(old.text.includes('精确参数')); assert.ok(!old.text.includes('changed after snapshot'));
  const changed = await executeTool(service, 'trajectory_inspect', {}); assert.notEqual(first.snapshot, changed.snapshot);
  const noCapture = new PortableService({ load: async () => datasetFromNative('pi', { ...input, capture: [], scope: null }) });
  const timing = await noCapture.call('trajectory_inspect', { view: 'latency' }); assert.equal(timing.summary.toolCoveredMs, null); assert.equal(timing.summary.measuredToolIntervals, 0); noCapture.dispose();
  assert.ok(datasetFromNative('pi', { ...input, capture: [], scope: null }).payload.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).every(c => c.end == null || c.start === c.end), 'history-only Pi results are point markers, not invented measured intervals');
  const realInput = { ...input, synthetic: false }; const real = datasetFromNative('pi', realInput);
  assert.ok(!real.payload.sessions[0].title.includes('模拟')); assert.equal(real.synthetic, false);
  assert.equal(datasetFromNative('pi', { ...input, scope: { ...input.scope, model: 'another-model', provider: 'synthetic-provider' } }).payload.officialStats.context.pressure.contextWindow, null, 'old usage is not divided by another model capacity');
} finally { service.dispose(); }

const snapshot = { capturedAt: '2026-01-01T00:00:10Z', source: 'test', thread: { id: 'codex-fixture', createdAt: 1767225600, cwd: '/project', turns: [{ id: 'turn', startedAt: 1767225600, completedAt: 1767225610, status: 'completed', items: [
  { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '检查构建' }] },
  { id: 'cmd', type: 'commandExecution', command: 'cat file.js', commandActions: [], aggregatedOutput: 'body', durationMs: 7, exitCode: 0, status: 'completed' },
  { id: 'dyn', type: 'dynamicToolCall', namespace: 'extension', tool: 'check', arguments: { path: '/project/a.js' }, status: 'completed', success: false, contentItems: [{ type: 'text', text: 'failed' }] },
  { id: 'reasoning', type: 'reasoning', content: ['PRIVATE_THINKING'] },
  { id: 'image-view', type: 'imageView', path: '/project/preview.png' },
  { id: 'output-only', type: 'functionCallOutput', namespace: 'extra', name: 'orphan', output: { text: 'output without parameters' } },
] }] } };
const rollout = [
  { timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: snapshot.thread.id } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'turn_context', payload: { turn_id: 'turn' } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'additional_tools', tools: [{ type: 'function', name: 'unmapped_historical_name', description: 'Historical only', parameters: { type: 'object' } }] } },
  { timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn', item: { id: 'cmd' }, started_at_ms: 1767225590000, completed_at_ms: 1767225620000 } },
  { timestamp: '2026-01-01T00:00:02Z', type: 'token_usage_record', payload: { turn_id: 'turn', response_id: 'response', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } } },
  { timestamp: '2026-01-01T00:00:03Z', type: 'token_usage_record', payload: { turn_id: 'turn', response_id: 'response', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 15 } } },
].map(JSON.stringify).join('\n');
const codex = new PortableService({ load: async () => datasetFromNative('codex', snapshot, { rollout }) });
try {
  const report = await codex.call('trajectory_inspect', { view: 'cost' });
  assert.equal(report.summary.calls, 3); assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.usage.records, 1); assert.equal(report.summary.usage.input, 100); assert.equal(report.summary.usage.uncachedInput, 40); assert.equal(report.summary.usage.output, 15);
  assert.equal(report.summary.toolCoveredMs, 10000); assert.equal(report.coverage.crossTurnToolIntervals, 1);
  const raw = await codex.call('trajectory_search', { snapshot: report.snapshot, query: 'output without parameters' }); assert.equal(raw.rows.length, 1);
  const hidden = await codex.call('trajectory_search', { snapshot: report.snapshot, query: 'PRIVATE_THINKING' }); assert.equal(hidden.total, 0);
  const image = await codex.call('trajectory_search', { snapshot: report.snapshot, query: '/project/preview.png' }); assert.ok(image.total > 0);
  const historyDefinitions = await codex.call('trajectory_inspect', { snapshot: report.snapshot, view: 'cost', groupBy: 'definition' }); assert.equal(historyDefinitions.rows[0].active, null); assert.equal(historyDefinitions.rows[0].directCallsInRange, null); assert.match(historyDefinitions.definitionBasis, /historical/);
  const api = new PortableService({ load: async () => datasetFromNative('codex', snapshot) });
  const partial = await api.call('trajectory_inspect', { view: 'cost' }); assert.equal(partial.summary.usage.input, null); assert.equal(partial.summary.toolCoveredMs, null); api.dispose();
} finally { codex.dispose(); }
const manyTurns = structuredClone(snapshot);
manyTurns.thread.turns = Array.from({ length: 13 }, (_, i) => ({ ...snapshot.thread.turns[0], id: 'turn-' + i, items: snapshot.thread.turns[0].items.map(item => ({ ...item, id: item.id + '-' + i })) }));
const allHistory = new PortableService({ load: async () => datasetFromNative('codex', manyTurns) });
try {
  const overview = await allHistory.call('trajectory_inspect');
  const covered = overview.rows.flatMap(r => Array.from({ length: r.turns.to - r.turns.from + 1 }, (_, i) => r.turns.from + i));
  assert.deepEqual(covered, Array.from({ length: 13 }, (_, i) => i + 1), 'the first overview covers the full process rather than the first page of turns');
} finally { allHistory.dispose(); }

const rpcCalls = [], turn = { id: 't', items: [], status: 'completed' };
const history = await readCodexHistory(async (method, params) => { rpcCalls.push(method); if (method === 'thread/read') return { thread: { id: 'x', historyMode: 'paginated' } }; if (method === 'thread/turns/list') return { data: [turn] }; return params.cursor ? { data: [{ turnId: 't', item: { type: 'agentMessage', id: 'b', text: 'two' } }] } : { data: [{ turnId: 't', item: { type: 'agentMessage', id: 'a', text: 'one' } }], nextCursor: 'page2' }; }, 'x');
assert.deepEqual(history.thread.turns[0].items.map(i => i.id), ['a', 'b']); assert.ok(rpcCalls.every(name => ['thread/read', 'thread/turns/list', 'thread/items/list'].includes(name)));
await assert.rejects(readCodexHistory(async method => method === 'thread/read' ? { thread: { id: 'x', historyMode: 'paginated' } } : { data: [], nextCursor: 'cycle' }, 'x'), /did not advance/);
const legacyItems = await readCodexHistory(async (method, args) => { if (method === 'thread/read') return { thread: { id: 'x', historyMode: 'paginated' } }; if (method === 'thread/items/list') throw Object.assign(Error('unsupported'), { code: -32601 }); return { data: [{ ...turn, items: args.itemsView === 'full' ? [{ id: 'full' }] : [] }] }; }, 'x');
assert.equal(legacyItems.thread.turns[0].items[0].id, 'full');

const temp = await mkdtemp(join(tmpdir(), 'trajectory-portable-'));
assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('trajectory-portable-'));
try {
  const file = join(temp, 'session.jsonl'), sample = createPiSample({});
  await writeFile(file, [sample.header, ...sample.entries].map(JSON.stringify).join('\n') + '\n{"type":');
  const read = await readPiSession(file, { synthetic: true }); assert.equal(read.source.incompleteTail, true); assert.equal(read.synthetic, true);
  await writeFile(file, '{}\nnot-json\n{}\n'); await assert.rejects(readPiSession(file), /line 2/);
  const tooSmall = new PortableService({ load: async () => datasetFromNative('pi', sample), maxBytes: 10 }); await assert.rejects(tooSmall.call('trajectory_inspect'), /budget/); tooSmall.dispose();
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Portable evidence tests passed: native units, usage/cache deduplication, clipped timing, immutable cuts, pagination, full-body continuation, static capabilities, branch JSONL, API-only unknowns, read-only Codex RPC.');
