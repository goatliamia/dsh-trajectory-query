import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import piExtension from './pi.mjs';

const temp = await mkdtemp(join(tmpdir(), 'trajectory-transports-'));
assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('trajectory-transports-'));
const root = dirname(fileURLToPath(import.meta.url)), input = createPiSample({ version: '1.4.0' });
let client;
try {
  const file = join(temp, 'native.jsonl'), capture = join(temp, 'capture.jsonl');
  await writeFile(file, [input.header, ...input.entries].map(JSON.stringify).join('\n') + '\n');
  await writeFile(capture, input.capture.map(JSON.stringify).join('\n') + '\n');
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'mcp.mjs'), '--host', 'pi', '--file', file, '--capture', capture, '--synthetic'], stderr: 'pipe' });
  client = new Client({ name: 'trajectory-integration-test', version: '1.0.0' }); await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 4); assert.ok(tools.tools.every(t => t.annotations.readOnlyHint));
  const report = JSON.parse((await client.callTool({ name: 'trajectory_inspect', arguments: { view: 'overview' } })).content[0].text);
  assert.equal(report.summary.calls, 12); assert.equal(report.synthetic, true);
  const failure = await client.callTool({ name: 'trajectory_inspect', arguments: { view: 'bad' } }); assert.equal(failure.isError, true);
  const io = JSON.parse((await client.callTool({ name: 'trajectory_inspect', arguments: { snapshot: report.snapshot, view: 'io' } })).content[0].text); assert.ok(io.rows.length);
  await client.close(); client = null;

  const cli = args => JSON.parse(execFileSync(process.execPath, [resolve(root, '../../scripts/trajectory-query.mjs'), '--host', 'pi', '--file', file, '--synthetic', ...args], { encoding: 'utf8', windowsHide: true }));
  const first = cli(['--args', '{"limit":2}']), second = cli(['--args', JSON.stringify({ cursor: first.cursor, snapshot: first.snapshot })]);
  assert.equal(second.rows[0].turn, 3, 'CLI rebuilds only an identical frozen cut');
  const { tool: readTool, linked, ...readArgs } = first.rows[0].read;
  const nativeRead = cli(['--tool', readTool, '--args', JSON.stringify(readArgs)]); assert.ok(nativeRead.native.entryId, 'native session ID in a pointer works across CLI processes');

  const hooks = new Map(), registered = new Map();
  const pi = { on: (event, handler) => hooks.set(event, handler), registerTool: tool => registered.set(tool.name, tool), getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read', description: 'Read files', parameters: { type: 'object' }, exposure: 'inline' }, { name: 'rare_but_needed', description: 'Recover a missing resource', parameters: { type: 'object' }, exposure: 'deferred' }] };
  piExtension(pi); assert.equal(registered.size, 4);
  const ctx = { cwd: input.header.cwd, model: { id: 'pi-demo-model', provider: 'synthetic-provider', contextWindow: 200000 }, getSystemPrompt: () => 'Current assembled system prompt', sessionManager: { getSessionId: () => input.header.id, getSessionFile: () => file, getEntries: () => input.entries, getLeafId: () => input.entries.at(-1).id } };
  for (const row of input.capture) if (hooks.has(row.event.type)) hooks.get(row.event.type)(row.event, ctx);
  const result = await registered.get('trajectory_inspect').execute('analysis', { view: 'cost', groupBy: 'definition' }, undefined, undefined, ctx), native = JSON.parse(result.content[0].text);
  assert.equal(native.rows.length, 2); assert.equal(native.rows.find(r => r.tool === 'rare_but_needed').active, false); assert.equal(native.scope.configuredTools, 2);
  assert.equal(native.scope.activeTools, 1); assert.equal(native.latestRecordedInput.contextWindow, 200000);
  const abort = new AbortController(); abort.abort(); await assert.rejects(registered.get('trajectory_inspect').execute('cancel', {}, abort.signal, undefined, ctx));
  hooks.get('session_shutdown')();
} finally { if (client) await client.close(); await rm(temp, { recursive: true, force: true }); }
console.log('Transport tests passed: real MCP stdio handshake and four tools, native Pi registration/context/timing callbacks, CLI snapshot continuation, cancellation; no model/provider calls.');
