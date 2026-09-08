// 分析器机械自检:把"提及 ≠ 发生"和"同名 ≠ 重复"两个坑钉死成回归用例。
// Usage: node analyzers/self-test.mjs   (失败退出码 1)
import { incidents } from './incidents.mjs';
import { errors } from './errors.mjs';

let failed = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra)));
  if (!cond) failed++;
};

const ev = (type, seq, data) => ({ type, seq, data });

// 1) 真实错误事件 → 必须报 error incident
const withError = [
  ev('turn/start', 0, { turn: 1 }),
  ev('tool/call', 1, { name: 'x', arguments: '{}' }),
  ev('tool/result', 2, { error: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' } })
];
const a1 = incidents.run(withError);
check('真实 error 事件被识别', a1.errors === 1 && a1.incidentCount >= 1, a1);

// 2) 仅"提及"(助手文本里提到 UNKNOWN_TOOL,没有 error 事件)→ 必须 0
const mentionOnly = [
  ev('turn/start', 0, { turn: 1 }),
  ev('assistant/message', 1, { message: { content: [{ type: 'text', text: '我们之前见过 UNKNOWN_TOOL 这种错误' }] } })
];
const a2 = incidents.run(mentionOnly);
const e2 = errors.run(mentionOnly);
check('提及 ≠ 发生:incidents 报 0 error', a2.errors === 0 && a2.incidents.filter((x) => x.type === 'error').length === 0, a2);
check('提及 ≠ 发生:errors 报 0', e2.total === 0, e2);

// 3) 同工具 + 同参连续 → 必须报 retry-loop
const sameArgs = [
  ev('turn/start', 0, { turn: 1 }),
  ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 3, { name: 'pwsh', arguments: '{"command":"a"}' })
];
const a3 = incidents.run(sameArgs);
check('同参连续 → retry-loop', a3.incidents.some((x) => x.type === 'retry-loop'), a3);

// 4) 同工具名 + 不同参连续 → 必须 0 retry-loop(修掉过的误分类,防回归)
const diffArgs = [
  ev('turn/start', 0, { turn: 1 }),
  ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
  ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"b"}' }),
  ev('tool/call', 3, { name: 'pwsh', arguments: '{"command":"c"}' })
];
const a4 = incidents.run(diffArgs);
check('同名不同参 → 不报 retry-loop', !a4.incidents.some((x) => x.type === 'retry-loop'), a4);

// 5) 空 turn 定义:无工具 且 无助手产出 才算;有助手产出则不算
const emptyTurn = [ev('turn/start', 0, { turn: 1 }), ev('turn/start', 1, { turn: 2 }), ev('assistant/message', 2, { message: { content: [{ type: 'text', text: 'ok' }] } })];
const a5 = incidents.run(emptyTurn);
check('空 turn = 无工具且无助手产出', a5.emptyTurns === 1, a5);

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
