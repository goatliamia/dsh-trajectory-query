const insightText = (value, limit = 120) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit) + '…' : text;
};
const insightFile = value => String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/');
function insightJSON(excerpt) {
  if (!excerpt || excerpt.omitted > 0) return null;
  try { const value = JSON.parse(excerpt.text); return value && typeof value === 'object' ? value : null; } catch { return null; }
}
function commandArgument(command, key) {
  const match = String(command).match(new RegExp('(?:^|\\s)-' + key + '\\s+(?:"([^"]+)"|\\x27([^\\x27]+)\\x27|([^\\s;|]+))', 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}
function commandSubject(command, verb) {
  const match = String(command).match(new RegExp('\\b' + verb + '\\s+(?:(?:-Path|-LiteralPath)\\s+)?(?:"([^"]+)"|\\x27([^\\x27]+)\\x27|([^\\s;|]+))', 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  return value.startsWith('-') ? '' : value;
}
function editPreview(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || before === after) return null;
  const bounded = text => text.split(/\r?\n/).slice(0, 600).join('\n').slice(0, 48000);
  const a = bounded(before), b = bounded(after);
  return { before: a, after: b, partial: a !== before.replace(/\r\n/g, '\n') || b !== after.replace(/\r\n/g, '\n') };
}
export function describeCall(call) {
  const args = insightJSON(call.args) || {}, result = insightJSON(call.result);
  const target = call.target || args.file_path || args.path || args.filePath || '';
  const file = insightFile(target), text = call.result?.text || '', name = call.name || '工具';
  let title = '调用 ' + name, outcome = '', detail = '', preview = null;
  if (['read', 'read_file', 'read_text_file', 'read_image'].includes(name)) {
    title = (name === 'read_image' ? '查看图片 ' : '读取 ') + (file || '文件');
    const range = text.match(/Showing lines (\d+)-(\d+) of (\d+)/);
    if (range) outcome = '返回第 ' + range[1] + '–' + range[2] + ' 行，文件共 ' + range[3] + ' 行。';
    else if (/<type>file<\/type>/.test(text)) outcome = '返回了文件内容。';
    if (Number.isFinite(args.offset)) detail = '请求从第 ' + args.offset + ' 行开始' + (Number.isFinite(args.limit) ? '，最多 ' + args.limit + ' 行' : '');
  } else if (['edit', 'write', 'write_file', 'apply_patch', 'multi_edit'].includes(name)) {
    title = (name === 'write' || name === 'write_file' ? '写入 ' : '修改 ') + (file || '文件');
    if (/\b(?:updated|written|created) successfully\b|Successfully (?:wrote|updated|applied)/i.test(text)) outcome = '工具确认文件已更新。';
    if (name === 'edit') preview = editPreview(args.old_string, args.new_string);
    if (preview) detail = args.replace_all ? '替换所有匹配片段' : '替换指定文本片段';
  } else if (name === 'trajectory_read' || name === 'session_event_read') {
    const range = result?.requested;
    title = range && Number.isFinite(range.from) && Number.isFinite(range.to)
      ? '读取会话记录 #' + range.from + '–' + range.to
      : Number.isFinite(args.seq) ? '读取会话记录 #' + args.seq + (name === 'trajectory_read' ? ' 附近' : '') : '读取会话记录';
    if (Number.isFinite(result?.returned)) outcome = '返回 ' + result.returned + ' 条事件记录。';
    const event = result?.events?.find(e => e.seq === args.seq);
    if (event) detail = '目标记录 #' + event.seq + '：' + ({ 'user/message': '用户消息', 'assistant/message': '模型回复', 'tool/call': '工具调用', 'tool/result': '工具返回', 'agent/inbox/spliced': '待处理消息队列变更' }[event.type] || event.type);
  } else if (['trajectory_search', 'session_search', 'session_event_search', 'web_search', 'grep', 'glob'].includes(name)) {
    const query = args.query ?? args.pattern ?? args.q ?? '';
    title = (name.startsWith('trajectory') || name.startsWith('session') ? '搜索会话' : name === 'web_search' ? '搜索网页' : '查找文件内容') +
      (query ? '“' + insightText(query, 55) + '”' : '');
    if (Number.isFinite(result?.hitCount)) outcome = '命中 ' + result.hitCount + ' 条' + (Number.isFinite(result.returned) ? '，本次返回 ' + result.returned + ' 条' : '') + '。';
    else if (Number.isFinite(result?.returned)) outcome = '本次返回 ' + result.returned + ' 条结果。';
    const hit = result?.items?.find(item => typeof item.text === 'string' && item.text.trim());
    if (hit) detail = '命中摘录：' + insightText(hit.text, 100);
  } else if (['pwsh', 'bash', 'run_code'].includes(name)) {
    const command = args.command || args.code || '';
    const read = commandSubject(command, 'Get-Content'), path = commandArgument(command, 'Path'), pattern = commandArgument(command, 'Pattern');
    if (/\bSelect-String\b/i.test(command) && pattern) title = '查找“' + insightText(pattern, 45) + '”' + (path ? ' · ' + insightFile(path) : '');
    else if (read) title = '读取 ' + insightFile(read);
    else {
      const script = command.match(/\bnode\s+['"]?([^'"\s;|]+\.m?js)\b/i);
      title = script ? '运行 ' + insightFile(script[1]) : '运行命令';
      if (!script && args.description) detail = '调用方说明：' + insightText(args.description, 95);
    }
    const found = [...new Set([...text.matchAll(/^([^\r\n:<>]+\.(?:[cm]?js|tsx?|css|json)):\d+:/gm)].map(m => insightFile(m[1])))];
    if (found.length) outcome = '输出定位到 ' + found.slice(0, 3).join('、') + (found.length > 3 ? ' 等文件' : '') + '。';
    const reported = text.split(/\r?\n/).find(line => /^(?:PASS\b|FAIL\b|Tests?\s+(?:passed|failed)|Test Files\s)/i.test(line.trim()));
    if (reported) outcome = '命令输出报告：' + insightText(reported, 110);
    if (!outcome && text.trim()) outcome = '命令返回了输出。';
  } else if (name === 'web_fetch') {
    try { const url = new URL(args.url); title = '读取网页 ' + url.hostname + url.pathname; } catch { title = '读取网页'; }
  } else if (name === 'cordis_inspect_query') {
    title = '查询运行时状态';
    if (args.query) detail = '查询：' + insightText(typeof args.query === 'string' ? args.query : JSON.stringify(args.query), 100);
  } else if (name === 'plugin_manager') {
    title = '管理插件' + (args.action ? ' · ' + insightText(args.action, 30) : '');
  } else if (args.description) detail = '调用方说明：' + insightText(args.description, 100);
  const code = call.error?.code || call.error?.info?.code;
  let tone = 'normal';
  if (call.status === 'error') {
    tone = 'bad';
    outcome = ({
      FS_NOT_OBSERVED: '修改被拦住：还没有读取过目标文件，需要先读再改。',
      FS_STALE_VERSION: '修改被拦住：文件在上次读取后发生了变化，需要重新读取。',
      TOOL_TIMEOUT: '操作等待超时，未取得正常返回。',
      SESSION_QUERY_PERSISTENCE_FAILED: '历史存储服务报错，本次读取没有完成。',
      TOOL_ABORTED_BEFORE_DISPATCH: '执行前已被取消，工具没有实际启动。',
    })[code] || ('工具报错：' + insightText(text.replace(/^Error:\s*/i, '') || call.error?.message || code || '没有错误说明', 130));
    if (preview) detail = '原计划' + detail;
  } else if (call.status === 'unknown' || call.resultSeq == null) {
    tone = 'unknown'; outcome = '没有对应的返回记录，暂时不能判断结果。';
  } else if (result?.ok === false) {
    tone = 'bad'; outcome = '工具已返回，但结果报告未成功' + (typeof result.error?.message === 'string' ? '：' + insightText(result.error.message, 100) : '。');
  } else if (!outcome) outcome = text.trim() ? '已收到工具返回，可展开查看具体内容。' : '工具已返回，没有文字内容。';
  return { seq: call.seq, title: insightText(title, 110), target: target ? String(target) : null,
    outcome, detail, preview, tone, resultSeq: call.resultSeq, resultExcerpted: (call.result?.omitted || 0) > 0 };
}
export function stepInsight(turn, step, episodes, facts = {}) {
  const calls = step.calls.map(c => facts[c.seq] || describeCall(c)), index = turn.steps.indexOf(step);
  const previous = turn.steps[index - 1], next = turn.steps[index + 1];
  const stepFor = seq => turn.steps.find(s => s.calls.some(c => c.seq === seq));
  const links = [];
  for (const e of episodes.filter(e => e.turn === turn.number)) for (const pair of e.pairs) {
    if (step.calls.some(c => c.seq === pair.failedSeq)) {
      const success = stepFor(pair.successSeq);
      if (success) links.push({ step: success.number, text: '同样的操作在第 ' + success.number + ' 步返回成功', kind: 'recovery' });
    }
    if (step.calls.some(c => c.seq === pair.successSeq)) {
      const failed = stepFor(pair.failedSeq);
      if (failed) links.push({ step: failed.number, text: '这次补上了第 ' + failed.number + ' 步未成功的同样操作', kind: 'recovery' });
    }
  }
  const uniqueLinks = links.filter((l, i) => links.findIndex(other => other.step === l.step && other.text === l.text) === i);
  const before = previous?.calls.filter(c => c.resultSeq != null && c.end <= step.start);
  const input = index === 0 ? { label: '本轮问题', text: insightText(turn.prompts?.[0]?.text || turn.title || '没有记录到用户原文', 120) }
    : before?.length ? { label: '此前拿到', text: (before.length > 1 ? before.length + ' 项工具返回，其中：' : '') + (facts[before[0].seq] || describeCall(before[0])).outcome }
    : { label: '承接', text: '继续第 ' + previous.number + ' 步之后的执行。' };
  const following = next ? { step: next.number, text: next.calls.length
    ? (facts[next.calls[0].seq] || describeCall(next.calls[0])).title + (next.calls.length > 1 ? ' 等 ' + next.calls.length + ' 项操作' : '')
    : next.reply ? '整理并给出回复' : '继续执行' } : null;
  const prose = step.reply?.text?.split(/\u0060{3}/)[0].replace(/(^|\n)#{1,6}\s+/g, '$1').replace(/\*\*|__|\u0060/g, '');
  return { calls, input, links: uniqueLinks, following, reply: step.reply?.text ? insightText(prose || '本步回复包含代码，可查看原文。', 220) : null };
}
