// Preview-only projection. Every operation keeps its native event references;
// Code Mode wrappers remain available without counting their children twice.
export const FAMILIES = {
  read: { label: '读取', color: '#3877a8', icon: 'file' },
  search: { label: '搜索', color: '#8062af', icon: 'search' },
  write: { label: '修改', color: '#a9753f', icon: 'edit' },
  command: { label: '命令', color: '#378778', icon: 'terminal' },
  process: { label: '后台任务', color: '#58768a', icon: 'clock' },
  web: { label: '网页', color: '#6379b0', icon: 'globe' },
  coordination: { label: '协作', color: '#98718f', icon: 'branch' },
  other: { label: '其他工具', color: '#707780', icon: 'tool' },
};
const codeMode = name => /^run_?code$/i.test(name || '');
const readNames = new Set(['read', 'read_file', 'read_text_file', 'read_image']);
const writeNames = new Set(['write', 'write_file', 'edit', 'multi_edit', 'apply_patch']);
const shellNames = new Set(['pwsh', 'bash', 'shell', 'terminal', 'exec_command']);
const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const json = value => { if (value && typeof value === 'object') return value; try { return JSON.parse(value); } catch { return {}; } };
const clip = (text, n) => String(text ?? '').slice(0, n);
export const baseName = path => String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '';
export function filePath(value, workspace = '') {
  let path = String(value || '').replace(/\\/g, '/');
  if (!/^(?:[a-z]:\/|\/)/i.test(path) && workspace) path = workspace.replace(/\\/g, '/') + '/' + path;
  const prefix = path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
  const parts = [];
  for (const part of path.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop(); else parts.push(part);
  }
  return prefix + parts.join('/');
}
export const fileId = path => /^(?:[a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
export function familyOf(name, args = {}) {
  if (readNames.has(name) || name === 'str_replace_editor' && args.command === 'view') return 'read';
  if (writeNames.has(name) || name === 'str_replace_editor') return 'write';
  if (['grep', 'glob', 'search'].includes(name) || /^(?:trajectory|session|session_event)_(?:search|read)$/.test(name)) return 'search';
  if (shellNames.has(name) || codeMode(name)) return 'command';
  if (/^(?:job_|get_terminal|write_stdin)/.test(name)) return 'process';
  if (/^(?:web_|fetch_url)/.test(name)) return 'web';
  if (/agent|message|goal|todo|schedule|present/.test(name)) return 'coordination';
  return 'other';
}
function grepEvidence(text, meta) {
  const files = [];
  if (meta?.shape === 'matches' && Array.isArray(meta.files)) {
    for (const file of meta.files) {
      if (typeof file.path !== 'string' || !Array.isArray(file.matches)) continue;
      const lines = file.matches.filter(m => Number.isInteger(m.lineNumber) && typeof m.line === 'string');
      if (lines.length) files.push({ path: file.path, lines: lines.map(m => m.lineNumber), sample: clip(lines[0].line, 170) });
    }
    return { files, total: Number.isFinite(meta.total) ? meta.total : null, shown: files.reduce((n, f) => n + f.lines.length, 0), truncated: !!meta.truncated };
  }
  // Only the tool's recorded `path` + `Line N:` groups establish file access.
  // The requested search directory and spill locator never establish a read.
  let path = null, file = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^Line (\d+):(?: (.*))?$/.exec(line);
    if (match && path) {
      if (!file) { file = { path, lines: [], sample: clip(match[2] || '', 170) }; files.push(file); }
      file.lines.push(Number(match[1]));
    } else if (!line.trim()) { path = null; file = null; }
    else if (!/^Found \d|^No matches|^\(|^Line /.test(line) && !/^\s/.test(line)) { path = line; file = null; }
  }
  const header = /^Found (\d+)(?: of (\d+))? matches?\b/m.exec(text);
  const total = header ? Number(header[2] || header[1]) : /^No matches found\s*$/.test(text.trim()) ? 0 : null;
  const shown = files.reduce((n, f) => n + f.lines.length, 0);
  return { files, total, shown, truncated: !!header?.[2] || /\(Omitted|line truncated|complete result|Full grep result/i.test(text) };
}
function commandDetails(command) {
  const compact = String(command || '').replace(/\s+/g, ' ').trim();
  if (/(?:^|[;&|]\s*|\belan\s+run\s+\S+\s+)(?:lean|lake)(?:\.exe)?\s/i.test(compact)) return { title: '运行 Lean', subject: compact };
  const runner = /\b(node|python3?|pytest|pnpm|npm|git|rg|Get-Content|Select-String|Get-ChildItem|cargo|go|dotnet)\b(?:\s+([^;|]{1,110}))?/i.exec(compact);
  if (runner) return { title: ['rg', 'Select-String'].includes(runner[1]) ? '命令检索' : runner[1] === 'Get-Content' ? '读取命令' : '运行 ' + runner[1], subject: clip(runner[0], 120) };
  return { title: '执行命令', subject: clip(compact, 120) };
}
export function describeOperation(call, args, text, meta, workspace) {
  const family = familyOf(call.name, args), files = [];
  const target = meta?.path || args.file_path || args.path || args.filePath;
  let title = call.name, subject = '', summary = '工具返回了结果', metrics = [], search = null;
  const resolved = value => filePath(value, args.workdir || workspace);
  if (family === 'read' || family === 'write') {
    const recorded = meta?.path || /<path>([^<]+)<\/path>/.exec(text)?.[1] || target;
    const path = typeof recorded === 'string' ? resolved(recorded) : null;
    title = family === 'read' ? call.name === 'read_image' ? '读取图片' : '读取文件' : /^(?:write|write_file)$/.test(call.name) || args.command === 'create' ? '写入文件' : '修改文件';
    subject = path ? baseName(path) : '文件';
    const lineRows = [...text.matchAll(/^\s*(\d+):/gm)].map(m => Number(m[1]));
    const range = /Showing lines (\d+)-(\d+) of (\d+)/.exec(text);
    const count = Array.isArray(meta?.lines) ? meta.lines.length : range ? Number(range[2]) - Number(range[1]) + 1 : lineRows.length || null;
    if (family === 'read') {
      summary = count ? '返回 ' + count + ' 行文件内容' : call.name === 'read_image' ? '图片读取已返回' : '文件读取已返回';
      if (count) metrics.push(['返回行数', count + ' 行']);
      if (range || lineRows.length) metrics.push(['读取窗口', range ? range[1] + '–' + range[2] + ' 行' : lineRows[0] + '–' + lineRows.at(-1) + ' 行']);
    } else {
      const content = args.content ?? args.file_text;
      const before = args.old_string ?? args.old_str, after = args.new_string ?? args.new_str;
      summary = typeof content === 'string' ? '写入请求已返回' : typeof before === 'string' && typeof after === 'string' ? '文本替换已返回' : '修改请求已返回';
      if (typeof content === 'string') metrics.push(['写入内容', content.split(/\r?\n/).length + ' 行']);
      if (typeof before === 'string' && typeof after === 'string') metrics.push(['替换片段', before.split(/\r?\n/).length + ' → ' + after.split(/\r?\n/).length + ' 行']);
    }
    if (path) files.push({ path, access: family === 'read' ? 'read' : 'write', lines: lineRows });
  } else if (call.name === 'grep') {
    search = grepEvidence(text, meta); title = '搜索文件内容'; subject = clip(args.pattern || args.query || '', 90);
    summary = search.total === 0 ? '没有匹配结果' : search.total != null ? '命中 ' + search.total + ' 处 · 返回 ' + search.shown + ' 处片段' : search.shown ? '返回 ' + search.shown + ' 处匹配片段' : '搜索返回已记录';
    metrics = [['匹配结果', search.total == null ? '未记录总量' : search.total + ' 处'], ['涉及文件', search.files.length + ' 个有返回片段']];
    for (const f of search.files) files.push({ ...f, path: resolved(f.path), access: 'match' });
  } else if (call.name === 'glob') {
    title = '发现文件路径'; subject = clip(args.pattern || '', 90);
    const count = Number.isFinite(meta?.total) ? meta.total : /^No files found/.test(text) ? 0 : /^Found (\d+)/.exec(text)?.[1];
    summary = count != null ? '发现 ' + count + ' 个路径' : '返回了文件路径列表';
    metrics = [['内容读取', '未读取文件正文']];
  } else if (family === 'command') {
    const info = commandDetails(args.command || args.code || ''); title = info.title; subject = info.subject;
    const exit = Number.isInteger(meta?.exitCode) ? meta.exitCode : /^(?:Process )?(?:exited with code|exit[_ ]?code)\s*[:=]?\s*(-?\d+)\b/im.exec(text)?.[1];
    const failed = /^\s*(?:FAIL\b|Tests?\s+failed\b)/im.test(text), passed = /^\s*(?:PASS\b|Tests?\s+passed\b)/im.test(text);
    summary = exit != null ? '进程退出码 ' + exit : failed ? '输出包含失败项' : passed ? '输出包含通过项' : text.trim() ? '命令返回了输出' : '命令已返回';
    if (exit != null) metrics.push(['退出码', String(exit)]);
    metrics.push(['返回输出', text ? text.split(/\r?\n/).length + ' 行' : '无文字输出']);
    if (args.description) metrics.push(['调用方说明', clip(args.description, 140)]);
  } else if (family === 'process') {
    title = ({ job_output: '读取后台输出', job_list: '查看后台任务', job_kill: '停止后台任务' })[call.name] || '后台任务操作';
    subject = String(args.job_id || args.jobId || args.id || args.session_id || ''); summary = text.trim() ? '后台任务返回已记录' : '未返回文字内容';
  } else if (family === 'web') {
    title = call.name === 'web_search' ? '搜索网页' : '读取网页'; subject = args.query || args.url || ''; summary = '网页工具返回已记录';
  } else if (family === 'coordination') {
    title = ({ subagent: '委派子任务', send_message: '发送协作消息', list_agents: '查看子代理', present: '交付文件', get_goal: '查看目标', update_goal: '更新目标' })[call.name] || call.name;
    subject = args.name || args.description || args.target || args.path || ''; summary = '操作返回已记录';
  } else { subject = args.description || args.query || args.path || ''; }
  if (call.status === 'error') summary = clip(text.replace(/^Error:\s*/i, '').replace(/\s+/g, ' ') || call.error?.message || '工具返回了错误', 160);
  if (call.status === 'pending') summary = '记录中尚无对应返回';
  return { family, title, subject: clip(subject, 160), summary, metrics, files, search };
}
export function projectOperations(events, { workspace = '' } = {}) {
  const roots = new Map(), starts = new Map(), rows = [], pendingStarts = new Map();
  for (const e of events) {
    if (e.surfaceOp && typeof e.surfaceOp === 'object') continue;
    const d = e.data || {};
    if (e.type === 'tool/call') {
      const call = { id: d.callId, seq: e.seq, startSeq: e.seq, name: d.name, turn: d.turn, step: d.step, start: e.time, end: null, resultSeq: null, status: 'pending', inner: false, args: json(d.arguments), text: '', meta: null };
      roots.set(d.callId, call); rows.push(call);
    } else if (e.type === 'tool/result') {
      const call = roots.get(d.message?.source?.callId || d.message?.toolCallId || d.callId);
      if (!call || call.resultSeq != null) continue;
      Object.assign(call, { end: e.time, resultSeq: e.seq, status: d.error || d.message?.isError ? 'error' : 'returned', text: textOf(d.message?.content), meta: d.meta, error: d.error });
    } else if (e.type === 'tool/ptc-dispatch-start') {
      starts.set(d.subCallId, e); pendingStarts.set(d.subCallId, e);
    } else if (e.type === 'tool/ptc-dispatch') {
      const root = roots.get(d.rootCallId), start = starts.get(d.subCallId); pendingStarts.delete(d.subCallId);
      if (!root) continue;
      rows.push({ id: d.subCallId, rootId: d.rootCallId, parentId: d.parentCallId, rootSeq: root.seq,
        seq: e.seq, startSeq: start?.seq ?? null, name: d.name, turn: root.turn, step: root.step,
        start: start?.time ?? null, end: e.time, resultSeq: e.seq, status: d.isError ? 'error' : 'returned', inner: true,
        args: json(d.arguments), text: textOf(d.content), meta: d.meta, error: d.error });
    }
  }
  for (const e of pendingStarts.values()) {
    const d = e.data, root = roots.get(d.rootCallId);
    if (root && d.name) rows.push({ id: d.subCallId, rootId: d.rootCallId, rootSeq: root.seq, seq: e.seq, startSeq: e.seq,
      name: d.name, turn: root.turn, step: root.step, start: e.time, end: null, resultSeq: null, status: 'pending', inner: true, args: json(d.arguments), text: '', meta: null });
  }
  const hasChildren = new Set(rows.filter(c => c.inner).map(c => c.rootId));
  const parents = new Set(rows.filter(c => c.inner).map(c => c.parentId));
  const wrappers = rows.filter(c => !c.inner && codeMode(c.name) && hasChildren.has(c.id));
  const calls = rows.filter(c => !codeMode(c.name) || !hasChildren.has(c.id) && !parents.has(c.id)).map(c => {
    const detail = describeOperation(c, c.args, c.text, c.meta, workspace);
    const args = JSON.stringify(c.args, null, 2), output = c.text;
    return { ...c, ...detail, args: clip(args, 6000), argsOmitted: Math.max(0, args.length - 6000), text: clip(output, 8000), textOmitted: Math.max(0, output.length - 8000), meta: undefined };
  }).sort((a, b) => a.seq - b.seq);
  const files = new Map();
  for (const call of calls) for (const record of call.files) {
    const id = fileId(record.path);
    if (!files.has(id)) files.set(id, { id, path: record.path, name: baseName(record.path), accesses: [] });
    files.get(id).accesses.push({ seq: call.seq, turn: call.turn, step: call.step, tool: call.name, status: call.status, access: record.access, lines: record.lines || [], sample: record.sample });
  }
  return { calls, files: [...files.values()], counts: { outer: rows.filter(c => !c.inner).length, inner: rows.filter(c => c.inner).length, wrappers: wrappers.length, operations: calls.length },
    wrappers: wrappers.map(c => ({ seq: c.seq, id: c.id, turn: c.turn, step: c.step })) };
}
