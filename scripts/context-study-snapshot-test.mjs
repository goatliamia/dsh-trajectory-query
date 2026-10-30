import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { inspectStudySnapshot, requireStudySnapshot } from './context-study-snapshot.mjs';

const rows = [1, 2, 3].map(turn => ({ turn, step: 1, seq: turn * 10, total: turn * 100 }));
const payload = {
  mainSession: 'fixture', sessions: [{ id: 'fixture', turns: rows.map(row => ({ number: row.turn,
    steps: [{ number: 1, assistantSeq: row.seq }, { number: 2 }] })) }],
  context: { historyRequests: rows.slice(0, 2), requests: rows.slice(2) },
  officialStats: { session: 'fixture', context: { pressure: { projectedTokens: 0, contextWindow: 1000 } } },
};
assert.deepEqual(requireStudySnapshot(payload), { session: 'fixture', turns: 3, requests: 3,
  expected: 3, missing: 0, firstMissingTurn: undefined, hasSummary: true, complete: true });
const partial = structuredClone(payload); delete partial.context.historyRequests;
assert.equal(inspectStudySnapshot(partial).firstMissingTurn, 1);
assert.throws(() => requireStudySnapshot(partial), /2 response compositions missing/);
assert.equal(requireStudySnapshot(partial, { allowIncomplete: true }).complete, false);
const noSummary = structuredClone(payload); delete noSummary.officialStats;
assert.throws(() => requireStudySnapshot(noSummary), /occupancy\/capacity missing/);
const wrongSession = structuredClone(payload); wrongSession.officialStats.session = 'another';
assert.throws(() => requireStudySnapshot(wrongSession), /another session/);
const wrongResponse = structuredClone(payload); wrongResponse.context.historyRequests[0].turn = 2;
assert.throws(() => requireStudySnapshot(wrongResponse), /does not match/);
const conflict = structuredClone(payload); conflict.context.requests.push({ ...rows[0], total: 999 });
assert.throws(() => requireStudySnapshot(conflict), /Conflicting/);

// Exercise the actual CLI: failed input must not overwrite an existing preview.
const dir = mkdtempSync(join(tmpdir(), 'context-study-'));
try {
  const source = join(dir, 'fixture.html'), output = join(dir, 'index.html');
  writeFileSync(source, '<script id="trace-data" type="application/json">' + JSON.stringify(partial) + '</script>');
  writeFileSync(output, 'last complete preview');
  const build = args => spawnSync(process.execPath, ['scripts/build-context-trend-study.mjs', '--source', source, ...args], { encoding: 'utf8' });
  let result = build(['--out', dir]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /2 response compositions missing/);
  assert.equal(readFileSync(output, 'utf8'), 'last complete preview');
  result = build(['--allow-incomplete']);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /main preview must stay complete/);
  result = build(['--out', dir, '--allow-incomplete']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /fixture/);
} finally {
  const withinTemp = relative(resolve(tmpdir()), resolve(dir));
  assert.ok(withinTemp.startsWith('context-study-') && !withinTemp.includes('..'));
  rmSync(dir, { recursive: true, force: true });
}
console.log('Context study snapshot coverage and overwrite guards passed');
