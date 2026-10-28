// All contents, timings and usage below are synthetic. Native entry/event fields
// follow Pi 1.4.0 source; capture timestamps belong to this demo's outer envelope.
export const PI_SOURCE_REVISION = 'ad702637fdf6fbd3f965c5dba0b14bae100b74eb';
export function createPiSample(source = {}, { skillStudy = false } = {}) {
  const base = Date.parse('2026-10-28T08:00:00Z'), entries = [], capture = [];
  let cursor = base, parentId = null, next = 0, runMessages = [], firstCycle = true;
  const iso = ms => new Date(ms).toISOString();
  const observe = (event, observedAt = cursor) => capture.push({ observedAt, synthetic: true, event });
  const append = (type, body, time = cursor) => { const entry = { type, id: 'sim-' + String(++next).padStart(4, '0'), parentId, timestamp: iso(time), ...body }; entries.push(entry); parentId = entry.id; observe({ type: 'entry_appended', entry }, time); return entry; };
  const text = value => [{ type: 'text', text: value }];
  const usage = input => ({ input, output: 220, cacheRead: Math.floor(input * .4), cacheWrite: 0, totalTokens: input + Math.floor(input * .4) + 220, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const tools = [
    { name: 'read', description: 'Read file contents', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } },
    { name: 'edit', description: 'Replace exact non-overlapping text blocks', parameters: { type: 'object', properties: { path: { type: 'string' }, edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } } }, required: ['path', 'edits'] } },
    { name: 'write', description: 'Create or overwrite a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    { name: 'bash', description: 'Execute a shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  ];
  const skillPath = '/demo/.pi/skills/report-check/SKILL.md';
  const skill = '# Report checks\n\nVerify totals, preserve decimal precision, and run the focused test before finishing.\n';
  const csvSkillPath = '/demo/.pi/skills/csv-export/SKILL.md';
  const csvSkill = '# CSV export\n\nPreserve the amount header, format amounts to two decimals, and read back the saved file.\n';
  const system = { role: 'system', content: '', sections: { preamble: 'You are an expert coding assistant operating inside pi.', rules: '<rules>Read before editing. Verify the focused behavior.</rules>', project_context: '<project_context>演示项目：账单导出工具。所有文件和操作均为模拟。</project_context>', skills: '<available_skills>\n<skill><name>report-check</name><description>检查报表计算与导出。</description><location>' + skillPath + '</location></skill>\n</available_skills>', cwd: '<cwd>/demo/report-project</cwd>' }, toolsAdded: tools, timestamp: cursor };
  if (skillStudy) system.sections.skills = system.sections.skills.replace('</available_skills>', '<skill><name>csv-export</name><description>保留表头并回读导出结果。</description><location>' + csvSkillPath + '</location></skill>\n</available_skills>');
  append('model_change', { provider: 'synthetic-provider', modelId: 'pi-demo-model' });
  append('thinking_level_change', { thinkingLevel: 'off' });
  append('message', { message: system });
  const begin = prompt => { cursor += 1800; runMessages = []; firstCycle = true; observe({ type: 'agent_start' }); observe({ type: 'turn_start' }); const m = { role: 'user', content: text(prompt), timestamp: cursor }; observe({ type: 'message_start', message: m }); append('message', { message: m }); observe({ type: 'message_end', message: m }); runMessages.push(m); return parentId; };
  const finish = () => { observe({ type: 'agent_end', messages: runMessages, willRetry: false }); observe({ type: 'agent_settled', aborted: false }); cursor += 3500; };
  const cycle = (reply, calls = [], input = 4200) => {
    const start = cursor; if (!firstCycle) observe({ type: 'turn_start' }); firstCycle = false;
    const message = { role: 'assistant', content: [...(reply ? text(reply) : []), ...calls.map((c, i) => ({ type: 'toolCall', id: 'call-' + (next + 1) + '-' + i, name: c.name, arguments: c.args }))], api: 'openai-completions', provider: 'synthetic-provider', model: 'pi-demo-model', usage: usage(input), stopReason: calls.length ? 'toolUse' : 'stop', timestamp: start, durationMs: 1600 };
    observe({ type: 'message_start', message }, start); cursor += message.durationMs; append('message', { message }); observe({ type: 'message_end', message }); runMessages.push(message);
    const results = [];
    calls.forEach((call, i) => {
      const toolCallId = message.content.filter(c => c.type === 'toolCall')[i].id, toolStart = cursor;
      observe({ type: 'tool_execution_start', toolCallId, toolName: call.name, args: call.args }, toolStart);
      cursor += call.ms ?? 420;
      const result = { content: text(call.output), ...(call.details ? { details: call.details } : {}) };
      observe({ type: 'tool_execution_end', toolCallId, toolName: call.name, result, isError: !!call.error, durationMs: cursor - toolStart });
      const resultMessage = { role: 'toolResult', toolCallId, toolName: call.name, ...result, isError: !!call.error, timestamp: cursor, durationMs: cursor - toolStart };
      observe({ type: 'message_start', message: resultMessage }); append('message', { message: resultMessage }); observe({ type: 'message_end', message: resultMessage }); results.push(resultMessage); runMessages.push(resultMessage);
    });
    observe({ type: 'turn_end', message, toolResults: results }); cursor += 180;
  };
  begin('检查账单导出，先理解计算规则和当前测试。');
  cycle('先看输入、金额计算和技能材料。', [
    { name: 'read', args: { path: 'src/report.js' }, output: 'export const total = rows => rows.reduce((n, row) => n + row.amount, 0);\nexport const format = value => String(value);', ms: 340 },
    { name: 'read', args: { path: skillPath }, output: skill, ms: 220 },
    { name: 'read', args: { path: 'test/report.test.js' }, output: 'assert.equal(format(12.5), "12.50");\nassert.equal(total([{amount: 1}, {amount: 2}]), 3);', ms: 280 },
  ], 3500);
  cycle('当前显示没有固定两位小数；已取得原文件和定向测试。', [], 4800); finish();
  begin('<skill name="report-check" location="' + skillPath + '">\nReferences are relative to /demo/.pi/skills/report-check.\n\n' + skill.trim() + '\n</skill>\n\n修复金额显示，并实际跑一次检查。');
  cycle(skillStudy ? '按照 report-check 的金额显示规则修改，并在修改后运行定向检查。' : '', [{ name: 'edit', args: { path: 'src/report.js', edits: [{ oldText: 'export const format = value => String(value);', newText: 'export const format = value => value.toFixed(1);' }] }, output: 'Successfully replaced 1 block(s) in src/report.js.', details: { diff: '-export const format = value => String(value);\n+export const format = value => value.toFixed(1);', patch: '--- a/src/report.js\n+++ b/src/report.js\n@@ -2 +2 @@\n-export const format = value => String(value);\n+export const format = value => value.toFixed(1);', firstChangedLine: 2 } }], 5200);
  cycle(skillStudy ? '运行 report-check 要求的定向检查，验证金额显示。' : '', [{ name: 'bash', args: { command: 'node --test test/report.test.js' }, output: 'FAIL format amount\nExpected: 12.50\nActual: 12.5\nCommand exited with code 1', error: true, ms: 860 }], 5600);
  cycle(skillStudy ? '刚才的实现没有满足 report-check 的两位小数规则，修正后再检查。' : '检查返回的小数位数仍不对，修正后运行相同命令。', [{ name: 'edit', args: { path: 'src/report.js', edits: [{ oldText: 'value.toFixed(1)', newText: 'value.toFixed(2)' }] }, output: 'Successfully replaced 1 block(s) in src/report.js.', details: { diff: '-export const format = value => value.toFixed(1);\n+export const format = value => value.toFixed(2);', patch: '--- a/src/report.js\n+++ b/src/report.js\n@@ -2 +2 @@\n-export const format = value => value.toFixed(1);\n+export const format = value => value.toFixed(2);', firstChangedLine: 2 } }], 6100);
  cycle('', [{ name: 'bash', args: { command: 'node --test test/report.test.js' }, output: 'PASS format amount\nPASS total\nTests passed: 2', ms: 750 }], 6500);
  cycle('同一条定向检查现在通过，金额以两位小数显示。', [], 6800); finish();
  begin('再加 CSV 导出，先确认模块位置，保留已有行为。');
  cycle('', [{ name: 'read', args: { path: 'src/export.js' }, output: 'ENOENT: no such file or directory, open src/export.js', error: true, ms: 160 }], 7100);
  if (skillStudy) cycle('读取 csv-export，确认输出文件应满足哪些约定。', [{ name: 'read', args: { path: csvSkillPath }, output: csvSkill, ms: 240 }], 7200);
  const csv = 'export function csv(rows) {\n  return ["amount", ...rows.map(row => row.amount.toFixed(2))].join("\\n");\n}\n';
  cycle(skillStudy ? '按照 csv-export 保留 amount 表头，并以两位小数输出，写入后回读。' : '导出模块尚不存在，创建后再读取确认。', [{ name: 'write', args: { path: 'src/export.js', content: csv }, output: 'Successfully wrote to src/export.js', ms: 330 }], 7300);
  cycle('', [{ name: 'read', args: { path: 'src/export.js' }, output: csv, ms: 190 }], 7800);
  append('custom_message', { customType: 'demo-review-note', content: '演示扩展补充：CSV 表头需要单独保留。', display: true });
  cycle('模块已写入并回读，保留 amount 表头。', [], 8200); finish();
  const kept = begin('整理历史后，继续核对导出模块和定向检查。');
  observe({ type: 'compaction_start', reason: 'manual' }); cursor += 2200;
  const compaction = append('compaction', { summary: '模拟摘要：已修复两位小数显示；相同检查命令由失败转为通过；已创建 src/export.js 并回读。后续继续核对导出。', firstKeptEntryId: kept, tokensBefore: 9000, details: { readFiles: ['src/report.js', skillPath, 'test/report.test.js', 'src/export.js'], modifiedFiles: ['src/report.js', 'src/export.js'] }, systemMessage: { ...system, timestamp: cursor } });
  observe({ type: 'compaction_end', reason: 'manual', result: { summary: compaction.summary, firstKeptEntryId: kept, tokensBefore: 9000, details: compaction.details }, aborted: false, willRetry: false });
  if (skillStudy) cycle('压缩摘要没有保留技能正文，重新读取 report-check 后再执行最终检查。', [{ name: 'read', args: { path: skillPath }, output: skill, ms: 260 }], 3200);
  cycle(skillStudy ? '依据重新读取的 report-check 运行最终检查，同时核对导出内容。' : '按摘要继续，直接核对导出内容与检查结果。', [{ name: 'read', args: { path: 'src/export.js' }, output: csv, ms: 240 }, { name: 'bash', args: { command: 'node --test test/report.test.js' }, output: 'PASS format amount\nPASS total\nTests passed: 2', ms: 690 }], 3100);
  cycle('压缩后已重新核对文件与检查，没有把摘要当作本轮执行结果。', [], 3600); finish();
  begin('给我最终改动和检查依据。');
  cycle('已修复金额小数位并新增 CSV 模块。定向检查包含 2 项通过；模拟样例不代表在你的项目里执行过这些操作。', [], 3900); finish();
  return { synthetic: true, generatedFromSource: true, source, scenario: 'Pi 按源码事件格式生成的模拟会话', header: { type: 'session', version: 3, id: 'pi-synthetic-20261028-report', timestamp: iso(base), cwd: '/demo/report-project' }, entries, capture, modelContextWindow: null };
}
