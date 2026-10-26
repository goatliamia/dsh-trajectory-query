// Host-half mechanical self-test: the host incident computation must obey the same pinned semantics.
// Usage: node analyzers/host-self-test.mjs   (failure exits 1)
import { classifyTool, computeCost, computeIncidents, computeWorkPath, deriveHarnessResponse } from '../plugin/analysis-view/lib/index.js';

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

// 6) work path: per-turn calls/errors/usage + per-tool aggregation
const work = computeWorkPath([
  ev('turn/start', 0, { turn: 1 }),
  ev('assistant/message', 1, { message: { content: [] }, usage: { inputTokens: 100, cacheReadTokens: 400, outputTokens: 50 } }),
  ev('tool/call', 2, { name: 'read', callId: 'c1', arguments: '{}' }),
  ev('tool/result', 3, { callId: 'c1', message: { content: [{ type: 'text', text: 'ok' }] } }),
  ev('turn/end', 4, { reason: { kind: 'end-turn' } }),
  ev('turn/start', 5, { turn: 2 }),
  ev('tool/call', 6, { name: 'bash', callId: 'c2', arguments: '{"command":"x"}' }),
  ev('tool/result', 7, { callId: 'c2', error: { name: 'BashError', code: 'E1' } }),
  ev('turn/end', 8, { reason: { kind: 'error' } }),
]);
check('work: 两个 turn', work.turns.length === 2, work.turns);
check('work: turn1 一次调用零失败', work.turns[0].toolCalls === 1 && work.turns[0].errors === 0, work.turns[0]);
check('work: turn2 记失败与首错 seq', work.turns[1].errors === 1 && work.turns[1].firstErrorSeq === 7, work.turns[1]);
check('work: 首错带 callId(面板跳转不靠投影)', work.turns[1].firstErrorCallId === 'c2', work.turns[1].firstErrorCallId);
check('work: 每轮带第一条调用的 callId', work.turns[0].firstCallId === 'c1' && work.turns[1].firstCallId === 'c2', work.turns.map((t) => t.firstCallId));
check('work: usage 按 turn 汇总', work.turns[0].input === 100 && work.turns[0].cacheRead === 400 && work.turns[0].output === 50, work.turns[0]);
check('work: bash 记一次失败', (work.tools.find((t) => t.name === 'bash') || {}).errors === 1, work.tools);
check('work: 工具带按轮分布', (() => {
  const tool = work.tools.find((t) => t.name === 'read') || {};
  return Array.isArray(tool.byTurn) && tool.byTurn.length === 1 && tool.byTurn[0].turn === 1 && tool.byTurn[0].calls === 1;
})(), (work.tools.find((t) => t.name === 'read') || {}).byTurn);

/* 9) 官方价目:按峰谷时段计价,非官方 API 不出价格 */
const official = (seq, time, input, cacheRead, output) => ({
  type: 'assistant/message',
  seq,
  time,
  data: {
    usage: { inputTokens: input, cacheReadTokens: cacheRead, outputTokens: output },
    message: { source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' } },
  },
});
const priced = computeCost([
  official(1, Date.UTC(2026, 0, 5, 2, 0), 1000000, 1000000, 1000000), // 北京周一 10:00 → 高峰
  official(2, Date.UTC(2026, 0, 5, 14, 0), 1000000, 0, 0), // 北京周一 22:00 → 空闲
]);
check('cost: 峰谷价目', priced.pricing !== null && priced.pricing.priced === 2 && priced.pricing.peakRequests === 1 && Math.abs(priced.pricing.total - 11.04) < 1e-9, priced.pricing);
const foreign = computeCost([{
  type: 'assistant/message', seq: 1, time: Date.UTC(2026, 0, 5, 2, 0),
  data: { usage: { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 10 }, message: { source: { kind: 'model', provider: 'openai', model: 'gpt-5' } } },
}]);
check('cost: 非官方 API 不产出价格', foreign.pricing === null, foreign.pricing);
check('work: endReason 记录', work.turns[1].endReason === 'error', work.turns[1].endReason);
const timed = computeWorkPath([
  { type: 'turn/start', seq: 0, time: 1000, data: {} },
  { type: 'tool/call', seq: 1, time: 1100, data: { name: 'read', callId: 'c' } },
  { type: 'tool/result', seq: 2, time: 1350, data: { callId: 'c' } },
  { type: 'turn/end', seq: 3, time: 1500, data: { reason: { kind: 'end-turn' } } },
]);
check('work: 时长按事件时间', timed.turns[0].durationMs === 500, timed.turns[0].durationMs);
check('work: 工具平均耗时', (timed.tools[0] || {}).avgMs === 250, timed.tools);

// 7) failure shapes: DSH 0.2.x marks a failed tool result with message.isError (data.error may be absent)
const messageIsError = [
  ev('turn/start', 0, {}),
  ev('tool/call', 1, { name: 'read', callId: 'c9' }),
  ev('tool/result', 2, { callId: 'c9', message: { isError: true, content: [] } }),
  ev('turn/end', 3, { reason: { kind: 'end-turn' } }),
];
check('incidents: message.isError 也算失败', computeIncidents(messageIsError).errors === 1, computeIncidents(messageIsError));
check('work: message.isError 记为失败', computeWorkPath(messageIsError).turns[0].errors === 1, computeWorkPath(messageIsError));
check('work: 失败归属到工具', (computeWorkPath(messageIsError).tools[0] || {}).errors === 1, computeWorkPath(messageIsError).tools);

/* 8) 工具归类:规则读声明(参数优先,名字/描述兜底),官方那批落在预期类别上 */
const declared = (name, properties, description = '') => ({
  name,
  description,
  parameters: { type: 'object', properties: Object.fromEntries(properties.map((key) => [key, { type: 'string' }])) },
});
const categoryCases = [
  ['read', ['file_path'], 'Read a UTF-8 text file.', 'file'],
  ['edit', ['file_path', 'old_string', 'new_string'], 'Edit an existing file.', 'file'],
  ['glob', ['pattern', 'path'], 'Find files.', 'file'],
  ['pwsh', ['command'], 'Run a PowerShell command.', 'run'],
  ['web_search', ['queries'], 'Search the web.', 'web'],
  ['web_fetch', ['url'], 'Fetch a URL.', 'web'],
  ['trajectory_search', ['view', 'session', 'query'], 'Query the session log.', 'context'],
  ['session_event_search', ['session_id', 'query'], 'Search session events.', 'context'],
  ['session_trace', ['session_id'], 'Read session lineage.', 'context'],
  ['skill', ['name'], 'Load the full instructions for a skill.', 'context'],
  ['subagent', ['prompt', 'description'], 'Delegate a task to a subagent.', 'coop'],
  ['todo_write', ['todos'], 'Record the task list.', 'coop'],
  ['schedule_create', ['prompt', 'title', 'after_seconds'], 'Create a reminder.', 'coop'],
  ['ask_user_question', ['questions'], 'Ask the user.', 'coop'],
  ['cordis_inspect_query', ['platform', 'provider', 'method'], 'Run a read-only Inspect query.', 'plugin'],
  ['plugin_manager', ['action', 'target'], 'Manage plugins in this profile.', 'plugin'],
  ['get_goal', [], 'Read the current session goal.', 'coop'],
  ['mystery_tool', [], '', 'other'],
];
for (const [name, properties, description, expected] of categoryCases) {
  const actual = classifyTool(declared(name, properties, description), name);
  check('classify: ' + name + ' → ' + expected, actual === expected, actual);
}
const noDefinition = classifyTool(undefined, 'some_user_tool');
check('classify: 拿不到声明时落到其他', noDefinition === 'other', noDefinition);

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
