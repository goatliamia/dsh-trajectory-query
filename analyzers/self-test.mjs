// 分析器机械自检:把"提及 ≠ 发生"和"同名 ≠ 重复"两个坑钉死成回归用例。
// Usage: node analyzers/self-test.mjs   (失败退出码 1)
import { incidents } from './incidents.mjs';
import { errors } from './errors.mjs';
import { turns } from './turns.mjs';
import { tools } from './tools.mjs';
import { retry } from './retry.mjs';
import { cost } from './cost.mjs';

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

// 6) 表格契约(issue #4):每个 analyzer 必须自带 summary,runner 不再逐个 if;
//    摘要对空日志也非空,否则 digest 表会出现空单元格。
const ANALYZERS = [turns, tools, errors, retry, incidents, cost];
for (const a of ANALYZERS) {
  check(`${a.id} 暴露 summary()`, typeof a.summary === 'function', a.id);
  const empty = typeof a.summary === 'function' ? a.summary(a.run([])) : '';
  check(`${a.id} summary 对空日志非空`, typeof empty === 'string' && empty.trim() !== '', empty);
  const filled = typeof a.summary === 'function' ? a.summary(a.run(withError)) : '';
  check(`${a.id} summary 对真实日志非空`, typeof filled === 'string' && filled.trim() !== '', filled);
}
const incidentsSummary = incidents.summary(a1);
check('incidents summary 报条数与类型', incidentsSummary.includes(String(a1.incidentCount)) && incidentsSummary.includes('error×'), incidentsSummary);
check('incidents summary 空结果也不留空', incidents.summary(incidents.run(mentionOnly)) === '0 incidents', incidents.summary(incidents.run(mentionOnly)));

// 7) cost(issue #5):usage 缺失 = unknown,不按 0 计;派生量确定性
const costEvents = [
  ev('assistant/message', 0, { turn: 1, step: 1, message: { source: { provider: 'deepseek-official', model: 'm' } }, usage: { inputTokens: 604, outputTokens: 63, totalTokens: 7835, cacheReadTokens: 7168, cacheWriteTokens: 0, reasoningTokens: 0 } }),
  ev('assistant/message', 1, { turn: 1, step: 2, message: { source: { provider: 'deepseek-official', model: 'm' } }, usage: { inputTokens: 215, outputTokens: 316, totalTokens: 8211, cacheReadTokens: 7680, reasoningTokens: 150 } }),
  ev('assistant/message', 2, { turn: 2, step: 1, message: { source: { provider: 'deepseek-official', model: 'm' } } })
];
const c7 = cost.run(costEvents);
check('cost: 每请求一行', c7.requestCount === 3 && c7.requests.length === 3, c7.requestCount);
check('cost: 未上报 usage 记 unknown(不按 0)', c7.unknownRequests === 1 && c7.requests[2].input === null && c7.requests[2].unknown === true, c7.requests[2]);
check('cost: totals 只加已上报的值', c7.totals.input === 819 && c7.totals.cacheRead === 14848 && c7.totals.output === 379 && c7.totals.total === 16046, c7.totals);
check('cost: 单字段缺失记 null 并反映在 coverage', c7.requests[1].cacheWrite === null && c7.coverage.cacheWrite === 1 && c7.totals.cacheWrite === 0, c7.coverage);
check('cost: cache 效率 = cacheRead/(cacheRead+input)', Math.abs(c7.totals.cacheEfficiency - 14848 / 15667) < 1e-12, c7.totals.cacheEfficiency);
check('cost: 已上报请求的效率取自本请求', Math.abs(c7.requests[0].cacheEfficiency - 7168 / 7772) < 1e-12, c7.requests[0].cacheEfficiency);
check('cost: 按 turn 汇总', c7.byTurn.length === 2 && c7.byTurn[0].requests === 2 && c7.byTurn[1].requests === 1, c7.byTurn);
check('cost: summary 非空且带 cache 效率', typeof cost.summary(c7) === 'string' && cost.summary(c7).includes('cache'), cost.summary(c7));

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
