// Host-half mechanical self-test: the host incident computation must obey the same pinned semantics.
// Usage: node analyzers/host-self-test.mjs   (failure exits 1)
import { computeIncidents, deriveHarnessResponse } from '../plugin/analysis-view/lib/index.js';

let failed = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra)));
  if (!cond) failed++;
};
const ev = (type, seq, data) => ({ type, seq, time: 0, data });

// 1) same tool + same args consecutive -> retry-loop
const sameArgs = [
  ev('turn/start', 0, { turn: 1 }),
  ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 3, { name: 'pwsh', arguments: '{"command":"a"}' })
];
const r1 = computeIncidents(sameArgs);
check('同参连续 → retry-loop', r1.incidents.some((x) => x.type === 'retry-loop'), r1);

// 2) same tool, different args -> no retry-loop
const diffArgs = [
  ev('turn/start', 0, { turn: 1 }),
  ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"b"}' })
];
check('同名不同参 → 不报 retry-loop', !computeIncidents(diffArgs).incidents.some((x) => x.type === 'retry-loop'), computeIncidents(diffArgs));

// 3) mention != occurrence
const mention = [
  ev('turn/start', 0, { turn: 1 }),
  ev('assistant/message', 1, { message: { content: [{ type: 'text', text: '之前见过 UNKNOWN_TOOL 这种错误' }] } })
];
check('提及 ≠ 发生', computeIncidents(mention).errors === 0, computeIncidents(mention));

// 4) no-op turn: no tool AND no assistant output
const noop = [ev('turn/start', 0, { turn: 1 }), ev('turn/start', 1, { turn: 2 }), ev('assistant/message', 2, { message: { content: [{ type: 'text', text: 'ok' }] } })];
check('空 turn 定义', computeIncidents(noop).emptyTurns === 1, computeIncidents(noop));

// 5) harness response derived from error codes (evidence, not template)
check('harness: guard 拦截', deriveHarnessResponse({ 'FsError:FS_NOT_OBSERVED': 4 }) === 'guard 已拦截(FsError:FS_NOT_OBSERVED)', deriveHarnessResponse({ 'FsError:FS_NOT_OBSERVED': 4 }));
check('harness: 无 guard 需自纠', deriveHarnessResponse({ 'ToolNotFoundError:UNKNOWN_TOOL': 2 }) === '无 guard;需模型自纠', deriveHarnessResponse({ 'ToolNotFoundError:UNKNOWN_TOOL': 2 }));

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
