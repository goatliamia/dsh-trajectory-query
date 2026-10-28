import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPiSample, PI_SOURCE_REVISION } from './pi-sample.mjs';
import { adaptPiSession, piSessionPath, piVisibleComposition } from './pi-adapter.mjs';
import { fileObjects } from '../docs/demo/layout-review/file-model.mjs';
import { contextByTurn } from '../docs/demo/layout-review/context-model.mjs';
import { collectToolResults } from '../docs/demo/layout-review/tool-result-model.mjs';

const input = createPiSample({ revision: PI_SOURCE_REVISION, version: '1.4.0' }), graph = adaptPiSession(input), session = graph.sessions[0];
assert.equal(input.header.version, 3);
assert.equal(graph.synthetic, true);
assert.deepEqual(session.totals, { turns: 5, steps: 14, calls: 12, errors: 2 });
assert.ok(input.entries.every(e => e.id && 'parentId' in e && !('synthetic' in e)), 'synthetic provenance stays outside native SessionEntry fields');
assert.ok(input.capture.every(row => row.synthetic && Number.isFinite(row.observedAt) && !('observedAt' in row.event)), 'timestamps belong to the capture envelope');
assert.equal(input.capture.filter(row => row.event.type === 'turn_start').length, 14, 'one native turn per assistant cycle');
assert.equal(input.capture[input.capture.findIndex(row => row.event.type === 'agent_start') + 1].event.type, 'turn_start');
assert.ok(graph.context.requests.every(r => r.synthetic && r.source === 'estimate'));
assert.ok(Object.values(graph.context.callFacts).every(f => f.synthetic));
assert.ok(session.overview.episodes.every(e => e.complete && e.pairs.length === 1));
assert.deepEqual(graph.context.skillEvents.map(e => e.kind).sort(), ['catalog', 'explicit-skill-reference', 'skill-file-read']);
assert.ok(graph.context.boundaries[0].firstKeptEntryId);
assert.equal(graph.officialStats.context.pressure.contextWindow, null, 'unknown model capacity is never invented');
assert.equal(graph.context.agentBranches.length, 0, 'no core subagent capability is fabricated');
assert.ok(Object.values(graph.context.callFacts).some(f => f.patch?.startsWith('--- a/')));
assert.ok(fileObjects(graph.context.fileOperations).some(f => f.failed.length && f.reads.length));
assert.ok(collectToolResults(session, graph.context.callFacts, graph.context.fileOperations).length >= 4);
assert.ok(contextByTurn(graph.context.requests).some(r => r.decrease > 0), 'compaction produces a source-estimate reduction');
const noCapture = adaptPiSession({ ...input, capture: [] });
assert.ok(noCapture.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).every(c => c.timingSource === 'unrecorded-start'));
const changed = structuredClone(input), later = changed.entries.filter(e => e.type === 'message' && e.message.role === 'assistant').flatMap(e => e.message.content).filter(c => c.type === 'toolCall' && c.name === 'bash');
later[1].arguments.command += ' --changed';
assert.equal(adaptPiSession(changed).sessions[0].overview.episodes.find(e => e.turn === 2).complete, false, 'different command is not exact-operation recovery');
assert.throws(() => piSessionPath([{ id: 'a', parentId: 'a' }]), /cycle/);
assert.throws(() => piSessionPath([{ id: 'a', parentId: 'missing' }]), /Missing/);
const prompt = [{ type: 'message', id: 'a', parentId: null, message: { role: 'system', content: 'base', sections: { rules: 'first' }, toolsAdded: [{ name: 'read', parameters: {} }] } }, { type: 'message', id: 'b', parentId: 'a', message: { role: 'system', content: '', sections: { rules: null }, toolsRemoved: [{ name: 'read' }] } }, { type: 'custom', id: 'c', parentId: 'b', customType: 'state', data: 'PRIVATE-STATE'.repeat(100) }];
assert.equal(piVisibleComposition(prompt).tools, 0, 'tool removal replays native transcript state');
assert.equal(piVisibleComposition(prompt).inject, 0, 'plain custom state is not LLM context');
assert.equal(piVisibleComposition(prompt).system, 1);
const nativeRepo = 'D:/projects/new loop/pi';
if (existsSync(nativeRepo)) {
  const get = path => execFileSync('git', ['-C', nativeRepo, 'show', PI_SOURCE_REVISION + ':' + path], { encoding: 'utf8', windowsHide: true });
  assert.match(get('packages/coding-agent/src/core/session-manager.ts'), /CURRENT_SESSION_VERSION = 3/);
  assert.match(get('packages/coding-agent/src/core/session-manager.ts'), /firstKeptEntryId: string/);
  assert.match(get('packages/coding-agent/src/core/tools/edit.ts'), /details: \{ diff: diffResult.diff, patch, firstChangedLine/);
  assert.match(get('packages/agent/src/types.ts'), /type: "tool_execution_end"/);
  assert.match(get('packages/ai/src/types.ts'), /toolsRemoved\?: ToolReference\[\]/);
  assert.match(get('packages/coding-agent/README.md'), /skips features like sub-agents/);
}
if (existsSync('.dsh/pi-review/current-thread.html')) {
  const html = readFileSync('.dsh/pi-review/current-thread.html', 'utf8');
  assert.match(html, /Pi · 模拟会话/); assert.match(html, /全部内容、时长、用量与结果均为模拟/);
  const payload = JSON.parse(html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.host, 'pi'); assert.equal(payload.synthetic, true);
}
console.log('Pi adapter tests passed: native source fields, synthetic provenance, shared file/context/result models, exact recovery, compaction, skill sources, unavailable timing/capacity, tree validation.');
