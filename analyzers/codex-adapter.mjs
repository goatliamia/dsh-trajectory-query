import { createHash } from 'node:crypto';
import { win32, posix } from 'node:path';

const keys = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
const empty = () => Object.fromEntries(keys.map(k => [k, 0]));
const excerpt = (value, limit = 14000) => { const s = String(value ?? ''); return { text: s.slice(0, limit), omitted: Math.max(0, s.length - limit) }; };
const flat = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(v => v.text ?? '').join('\n') : JSON.stringify(value ?? '');
function decodedToolText(value) {
  if (Array.isArray(value)) return value.map(decodedToolText).join('\n');
  if (value && typeof value === 'object') {
    if (/image|audio|video/i.test(value.type || '') || value.mimeType && !/^text\//.test(value.mimeType)) return '';
    if (typeof value.output === 'string') return value.output;
    if (value.value) return decodedToolText(value.value);
    if (value.text) return decodedToolText(value.text);
    if (value.content) return decodedToolText(value.content);
    return JSON.stringify(value);
  }
  return String(value ?? '').split('\n').map(line => {
    try { const obj = JSON.parse(line); if (obj && typeof obj === 'object' && ('output' in obj || 'value' in obj)) return decodedToolText(obj); } catch {}
    return line;
  }).join('\n');
}
const short = (value, limit = 90) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const hash = value => createHash('sha256').update(value).digest('hex');
const failed = item => item.status === 'failed' || item.status === 'error' || item.exitCode != null && item.exitCode !== 0 || !!item.error || item.result?.isError === true;
const status = item => failed(item) ? 'error' : ['completed', 'complete', 'success'].includes(item.status) || !('status' in item) ? 'returned' : 'unknown';
const pathBase = path => String(path).replace(/\\/g, '/').split('/').at(-1);
const absolute = (path, cwd) => /^[A-Za-z]:[\\/]|^\\\\/.test(path) ? win32.normalize(path) : cwd?.includes('\\') ? win32.resolve(cwd, path) : posix.resolve(cwd || '/', path);
// A deliberately explicit character heuristic. These are visible-text estimates,
// never provider token counts or a claim about the full dispatched request.
export function estimateVisibleTokens(text) {
  const s = String(text ?? ''), wide = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  return Math.ceil(wide + (s.length - wide) / 4);
}
export function userText(item) {
  const raw = (item.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const request = raw.includes('## My request:') ? raw.split('## My request:').slice(1).join('\n').trim() : '';
  const clean = raw.replace(/<(in-app-browser-context|environment_context)\b[^>]*>[\s\S]*?<\/\1>/g, '').trim();
  return request || clean;
}
function commandBody(command) {
  if (Array.isArray(command)) return command.at(-1) || '';
  const match = String(command || '').match(/\s-Command\s+([\s\S]*)$/i);
  let body = match ? match[1].trim() : String(command || '');
  if ((body[0] === '"' || body[0] === "'") && body.at(-1) === body[0]) body = body.slice(1, -1);
  return body.replace(/`"/g, '"');
}
// Only literal paths adjacent to a read primitive are accepted. Listing/search
// results and arbitrary source-code strings do not become successful file reads.
export function commandReadEvidence(command, commandActions = []) {
  const body = commandBody(command), result = [];
  for (const action of commandActions) if (action.type === 'read' && (action.path || action.filePath)) result.push({ path: action.path || action.filePath, basis: 'official-command-action' });
  const re = /\b(Get-Content|gc|cat|type)\s+(?:(?:-LiteralPath|-Path|-Raw)\s+)*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;|\r\n]+))/gi;
  for (const m of body.matchAll(re)) {
    const path = m[2] || m[3] || m[4];
    if (path && !/^[\-$@]|\*|\?/.test(path)) result.push({ path, basis: 'literal-read-command', primitive: m[1] });
  }
  // fs.readFile[Sync] calls are observed only as a stated read intention. A zero
  // exit code is process success, not proof that every branch ran.
  const fsRead = /\b(?:readFileSync|readFile)\s*\(\s*['"]([^'"\r\n]+)['"]/g;
  for (const m of body.matchAll(fsRead)) if (!/^[\-$@]|\*|\?/.test(m[1])) result.push({ path: m[1], basis: 'literal-script-read', conditional: true });
  const id = path => String(path).replace(/\\+/g, '/').replace(/\/+/g, '/').toLowerCase();
  return result.filter((x, i) => result.findIndex(o => id(o.path) === id(x.path)) === i);
}
export function classifyCodexItem(item) {
  if (item.type === 'fileChange') return { kind: 'write', title: '修改文件', evidence: 'official-api:fileChange' };
  if (item.type === 'commandExecution') {
    const cmd = commandBody(item.command), reads = commandReadEvidence(item.command, item.commandActions);
    if (reads.some(r => /(?:^|[\\/])SKILL\.md$/i.test(r.path))) return { kind: 'read', title: '读取技能说明', reads, evidence: 'command-and-result' };
    if (reads.length) return { kind: 'read', title: '读取 ' + pathBase(reads[0].path) + (reads.length > 1 ? ' 等文件' : ''), reads, evidence: 'command-and-result' };
    if (/\brg\b|\bSelect-String\b|\bgrep\b/.test(cmd)) return { kind: 'query', title: /--files\b/.test(cmd) ? '查找文件' : '查找文件内容', evidence: 'command' };
    if (/\b(?:test|self-test|--test|npm\s+test|pnpm\s+test)\b/i.test(cmd)) return { kind: 'run', title: '运行验证', evidence: 'command' };
    if (/\b(?:build|build-[\w-]+\.mjs)\b/i.test(cmd)) return { kind: 'run', title: '构建预览', evidence: 'command' };
    if (/\bGet-ChildItem\b|\bls\b/.test(cmd)) return { kind: 'query', title: '查看目录', evidence: 'command' };
    return { kind: 'run', title: '运行命令', evidence: 'official-api:commandExecution' };
  }
  if (item.type === 'mcpToolCall') {
    const source = [item.server, item.tool].join('/'), arg = item.arguments || {};
    return { kind: /search|query|find|list|get|read/.test(item.tool) || item.readOnlyHint ? 'query' : 'other', title: /cua_repl/.test(source) ? (arg.title || '操作浏览器／应用') : (arg.title || '调用 ' + source), evidence: 'official-api:mcpToolCall', source: { server: item.server, tool: item.tool, pluginId: item.pluginId ?? null, appContext: item.appContext ?? null } };
  }
  if (item.type === 'webSearch') return { kind: 'query', title: '查询网页', evidence: 'official-api:webSearch' };
  if (item.type === 'imageView') return { kind: 'read', title: '查看图片', evidence: 'official-api:imageView' };
  if (item.type === 'collabAgentToolCall') return { kind: 'other', title: item.tool === 'spawnAgent' ? '启动子 Agent' : '协调子 Agent', evidence: 'official-api:collabAgentToolCall' };
  return { kind: 'other', title: item.type, evidence: 'official-api' };
}

function compositionItem(item, state, skillCalls, skillMaterials = []) {
  const add = (key, text) => { state[key] += estimateVisibleTokens(text); };
  if (item.type === 'additional_tools') { add('tools', JSON.stringify(item.tools)); return; }
  if (item.type === 'message') {
    const text = flat(item.content);
    if (item.role === 'assistant') add('assistant', text);
    else if (item.role === 'system' || item.role === 'developer') add('system', text);
    else {
      const supplemental = [...text.matchAll(/<(?:environment_context|in-app-browser-context)\b[^>]*>[\s\S]*?<\/(?:environment_context|in-app-browser-context)>/g)].map(m => m[0]).join('\n');
      add('inject', supplemental); add('user', text.replace(/<(environment_context|in-app-browser-context)\b[^>]*>[\s\S]*?<\/\1>/g, ''));
    }
  } else if (/^(function_call|custom_tool_call)$/.test(item.type)) {
    const input = item.arguments || item.input || '';
    // A path mentioned in code, a catalog, or a search is not a skill load.
    // Accept only an exclusive literal read command, or a native skill call.
    const commandLiteral = String(input).match(/\b(?:cmd|command)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    let readCommand = '';
    if (commandLiteral) { try { readCommand = commandLiteral[1][0] === '"' ? JSON.parse(commandLiteral[1]) : commandLiteral[1].slice(1, -1); } catch {} }
    const skillReads = commandReadEvidence(readCommand);
    if (/^(?:skill|load_skill)$/.test(item.name || '') || skillReads.length && skillReads.every(r => /SKILL\.md$/i.test(r.path)) && !/[;|]|\brg\b|\bSelect-String\b/.test(readCommand)) skillCalls.add(item.call_id);
    add('assistant', input);
  } else if (/^(function_call_output|custom_tool_call_output)$/.test(item.type)) {
    let output = decodedToolText(item.output).replace(/\r\n/g, '\n');
    if (skillCalls.has(item.call_id)) add('skill', output);
    else {
      // Exact matching text proves these bytes were returned. Current files are
      // merely candidates; a changed document that does not match is not used.
      for (const material of skillMaterials) {
        const content = material.text.replace(/\r\n/g, '\n').trim();
        if (content.length >= 100 && output.includes(content)) { add('skill', content); output = output.replace(content, ''); }
      }
      add('tool', output);
    }
  }
  else if (item.type === 'compaction') add('inject', item.encrypted_content ? '' : flat(item.summary || item.content || item.message));
  // Reasoning bodies and encrypted payloads are not rendered or estimated.
}

export function parseCodexRollout(text, { capturedAt, threadId, skillMaterials = [] } = {}) {
  const cutoff = capturedAt ? Date.parse(capturedAt) : Infinity, rows = [], malformed = [];
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); if (Date.parse(row.timestamp) <= cutoff) rows.push(row); } catch { malformed.push(index + 1); }
  }
  const meta = rows.find(r => r.type === 'session_meta')?.payload;
  if (threadId && meta && meta.id !== threadId) throw new Error('Rollout thread ID differs from official snapshot');
  const completed = new Map(), usage = [], compositions = [], compactions = [], contexts = [], skills = [], collaboration = [];
  const responses = rows.filter(r => r.type === 'response_item');
  for (const row of responses) if (row.payload.type === 'function_call' && row.payload.namespace === 'collaboration') {
    const p = row.payload, result = responses.find(r => r.payload.call_id === p.call_id && r.payload.type === 'function_call_output');
    let args = {}; try { args = JSON.parse(p.arguments); } catch {}
    let returned = {}; try { returned = JSON.parse(result?.payload.output || '{}'); } catch {}
    // Message bodies can be encrypted. Never copy ciphertext or infer content.
    collaboration.push({ id: p.id, callId: p.call_id, tool: p.name, taskName: args.task_name ?? args.target ?? null, taskPath: returned.task_name ?? null, turnId: p.internal_chat_message_metadata_passthrough?.turn_id, start: Date.parse(row.timestamp), end: result ? Date.parse(result.timestamp) : null, source: 'local-rollout', receiverThreadIds: [], childHistoryAvailable: false });
  }
  let state = empty(), turnId = null, skillCalls = new Set(), latestUsage = null, window = null;
  const save = row => compositions.push({ time: Date.parse(row.timestamp), ordinal: row.ordinal, turnId, ...state });
  for (const row of rows) {
    const p = row.payload || {};
    if (row.type === 'turn_context') { turnId = p.turn_id; contexts.push({ turnId, time: Date.parse(row.timestamp), model: p.model, reasoningEffort: p.effort }); }
    if (row.type === 'event_msg' && p.type === 'task_started') { turnId = p.turn_id; window = p.model_context_window ?? window; }
    if (row.type === 'event_msg' && p.type === 'item_completed' && p.item?.id) completed.set(p.item.id, { time: Date.parse(row.timestamp), start: p.started_at_ms ?? null, end: p.completed_at_ms ?? null, turnId: p.turn_id, ordinal: row.ordinal });
    if (row.type === 'token_usage_record') { usage.push({ time: Date.parse(row.timestamp), turnId: p.turn_id, responseId: p.response_id, usage: p.usage, source: 'local-rollout' }); latestUsage = p.usage; }
    if (row.type === 'event_msg' && p.type === 'token_count' && p.info) { window = p.info.model_context_window ?? window; latestUsage = p.info.last_token_usage ?? latestUsage; }
    if (row.type === 'response_item') { compositionItem(p, state, skillCalls, skillMaterials); save(row); }
    if (row.type === 'compacted') {
      const before = { ...state }; state = empty(); skillCalls = new Set();
      for (const item of p.replacement_history || []) compositionItem(item, state, skillCalls, skillMaterials);
      compactions.push({ time: Date.parse(row.timestamp), ordinal: row.ordinal, before, after: { ...state }, retainedItems: p.replacement_history?.length ?? null, source: 'local-rollout', kind: 'compaction' }); save(row);
      // Retained skills are evidence of text retained in that snapshot, not proof
      // of continued compliance or causal influence on later actions.
      for (const item of p.replacement_history || []) if (/<skill_(?:content|instructions)\b/.test(flat(item.content))) skills.push({ kind: 'retained-skill-content', time: Date.parse(row.timestamp), source: 'local-rollout', estimate: true });
    }
  }
  return { completed, usage, compositions, compactions, contexts, skills, collaboration, current: { ...state }, latestUsage, modelContextWindow: window,
    evidence: { source: 'local-rollout', unstable: true, rows: rows.length, malformedLines: malformed, cutoff: capturedAt ?? null, textEstimate: 'CJK characters + other characters / 4; visible text only; excludes hidden reasoning, images, serialization and unrecorded instructions' } };
}

export function adaptCodexThread(snapshot, options = {}) {
  const { thread } = snapshot;
  if (!thread?.id || !Array.isArray(thread.turns)) throw new Error('Expected official Codex thread snapshot');
  const local = options.rollout ? parseCodexRollout(options.rollout, { capturedAt: snapshot.capturedAt, threadId: thread.id, skillMaterials: options.skillMaterials || [] }) : null;
  const callFacts = {}, fileOperations = [], boundaries = [], events = [], skillEvents = [], episodes = [], requests = [];
  let seq = 0, timingMatched = 0;
  const stamp = item => item.localTiming || local?.completed.get(item.id);
  const turns = thread.turns.map((turn, index) => {
    const start = turn.startedAt != null ? turn.startedAt * 1000 : stamp(turn.items?.[0])?.start ?? thread.createdAt * 1000;
    const end = turn.completedAt != null ? turn.completedAt * 1000 : turn.durationMs != null ? start + turn.durationMs : null;
    const prompts = [], steps = [], markers = [], compactions = [];
    const output = { id: turn.id, number: index + 1, seq: ++seq, start, end, endSeq: null, reason: { kind: turn.status === 'inProgress' ? 'running' : turn.status }, prompts, steps, retries: [], markers, title: '', errors: 0 };
    let ordinalPosition = start;
    const extra = (local?.collaboration || []).filter(e => e.turnId === turn.id).map(e => ({ type: 'collabAgentToolCall', id: e.id, tool: e.tool, taskName: e.taskName, taskPath: e.taskPath, status: e.end == null ? 'inProgress' : 'completed', receiverThreadIds: [], localTiming: { start: e.start, end: e.end }, evidenceSource: 'local-rollout' }));
    // The API's native order is authoritative even when timestamps are absent.
    const items = [...(turn.items || [])];
    for (const item of extra) { const at = items.findIndex(native => stamp(native)?.start != null && stamp(native).start > item.localTiming.start); items.splice(at < 0 ? items.length : at, 0, item); }
    for (const item of items) {
      if (item.type === 'reasoning') continue;
      const time = stamp(item), precise = time?.start != null && time?.end != null;
      if (precise) timingMatched++;
      const a = precise ? time.start : ordinalPosition, b = precise ? time.end : a;
      ordinalPosition = Math.max(ordinalPosition, b);
      const itemSeq = ++seq;
      events.push({ id: item.id, type: item.type, turn: output.number, seq: itemSeq, start: precise ? a : null, end: precise ? b : null, source: item.evidenceSource || 'official-api', timingSource: precise ? 'local-rollout' : 'unrecorded' });
      if (item.type === 'userMessage') {
        prompts.push({ seq: itemSeq, time: a, ...excerpt(userText(item), 12000) });
        for (const ref of (item.content || []).filter(c => c.type === 'skill')) skillEvents.push({ kind: 'explicit-skill-reference', name: ref.name, path: ref.path, turn: output.number, seq: itemSeq, source: 'official-api' });
        continue;
      }
      if (item.type === 'contextCompaction') {
        const marker = { type: 'compaction/end', seq: itemSeq, time: b, source: precise ? 'local-rollout' : 'official-api' }; markers.push(marker); compactions.push(marker);
        boundaries.push({ kind: 'compaction', seq: itemSeq, time: b, turn: output.number, source: marker.source });
        continue;
      }
      const step = { number: steps.length + 1, seq: itemSeq, start: a, end: b, endSeq: itemSeq, assistantSeq: itemSeq, assistantTime: a, reply: null, calls: [], retries: [], markers: [], inTok: null, cacheTok: null, outTok: null, endObserved: precise, timingSource: precise ? 'local-rollout' : 'ordinal-only', errors: 0, semanticUnit: 'observed-action' };
      if (item.type === 'agentMessage') { step.reply = excerpt(item.text, 12000); step.phase = item.phase; steps.push(step); continue; }
      if (!['commandExecution', 'mcpToolCall', 'fileChange', 'webSearch', 'imageView', 'collabAgentToolCall'].includes(item.type)) continue;
      const cls = classifyCodexItem(item), state = status(item), resultSeq = state === 'unknown' ? null : ++seq;
      if (item.type === 'collabAgentToolCall' && item.evidenceSource === 'local-rollout') { cls.evidence = 'local-rollout:collaboration'; cls.title = (item.tool === 'spawn_agent' ? '启动子 Agent · ' : '协调子 Agent · ') + item.taskName; }
      const args = item.type === 'commandExecution' ? { command: commandBody(item.command), cwd: item.cwd, commandActions: item.commandActions }
        : item.type === 'mcpToolCall' ? item.arguments : item.type === 'fileChange' ? { changes: item.changes } : item;
      const result = item.type === 'commandExecution' ? item.aggregatedOutput : item.type === 'mcpToolCall' ? flat(item.result?.content) : item.type === 'fileChange' ? (item.changes || []).map(c => c.diff || '').join('\n') : JSON.stringify(item.results || item.states || '');
      const names = { read: 'read', write: 'apply_patch', run: 'pwsh', query: 'web_search', other: item.type === 'mcpToolCall' ? item.server + '/' + item.tool : item.type };
      const target = item.changes?.[0]?.path || cls.reads?.[0]?.path || item.path || null;
      const call = { id: item.id, seq: itemSeq, name: names[cls.kind], nativeName: item.type === 'mcpToolCall' ? item.server + '/' + item.tool : item.type, classification: cls, signature: hash(JSON.stringify([item.type, args])), target, args: excerpt(JSON.stringify(args), 22000), start: a, end: state === 'unknown' ? null : b, resultSeq, status: state, error: state === 'error' ? { code: item.exitCode != null ? 'EXIT_' + item.exitCode : 'TOOL_ERROR', message: short(item.error || result, 180) } : null, result: excerpt(result, 18000), durationMs: item.durationMs ?? (precise ? b - a : null), timingSource: step.timingSource, source: cls.source };
      step.calls.push(call); step.errors = state === 'error' ? 1 : 0; output.errors += step.errors;
      let outcome = state === 'error' ? '操作未成功' + (item.exitCode != null ? '，退出码 ' + item.exitCode : '') + '。' : state === 'unknown' ? '尚未记录完成结果。' : item.type === 'fileChange' ? 'Codex 记录文件改动已完成。' : item.type === 'commandExecution' ? '命令退出码 0' + (String(result || '').trim() ? '，已返回输出。' : '，没有文字输出。') : '已收到工具返回。';
      if (state === 'returned' && /\b(?:passed|PASS|self-test.*ok|tests?\s+ok)\b/i.test(result || '')) outcome += ' 输出包含检查通过标记。';
      if (cls.reads?.length && state === 'returned') outcome += ' 读取目标来自命令参数；未逐条证明每个脚本分支执行。';
      callFacts[itemSeq] = { seq: itemSeq, title: cls.title, outcome, detail: '来源：' + cls.evidence + (precise ? '；起止：本地 rollout 对应 item.id' : '；轮内起止未记录，仅保留动作顺序'), tone: state === 'error' ? 'bad' : state === 'unknown' ? 'unknown' : 'normal', target, preview: null, resultSeq, evidence: cls, source: item.evidenceSource || 'official-api', ...(item.type === 'fileChange' ? { diffChanges: item.changes.map(c => ({ path: c.path, kind: c.kind, diff: excerpt(c.diff, 40000) })) } : {}) };
      if (item.type === 'collabAgentToolCall' && item.tool === 'spawn_agent') markers.push({ type: 'subagent/invocation', seq: itemSeq, step: step.number, time: a, taskName: item.taskName, taskPath: item.taskPath, source: item.evidenceSource || 'official-api', childHistoryAvailable: false });
      for (const read of cls.reads || []) {
        const path = absolute(read.path, item.cwd || thread.cwd);
        const source = read.basis === 'official-command-action' ? 'official-api' : 'estimate';
        fileOperations.push({ seq: itemSeq, turn: output.number, step: step.number, path, kind: 'read', status: state, time: a, end: b, source, evidence: { ...read, commandExitCode: item.exitCode, confidence: read.conditional ? 'intended-read-in-process' : 'read-command-returned', outcome: state } });
        if (/SKILL\.md$/i.test(path)) skillEvents.push({ kind: 'skill-file-read', path, turn: output.number, step: step.number, seq: itemSeq, status: state, source, evidence: read });
      }
      if (item.type === 'fileChange') for (const change of item.changes || []) fileOperations.push({ seq: itemSeq, turn: output.number, step: step.number, path: change.path, kind: 'change', status: state, time: a, end: b, source: 'official-api', changeKind: change.kind?.type, diff: excerpt(change.diff, 40000) });
      if (item.type === 'collabAgentToolCall') for (const childId of item.receiverThreadIds || []) { const marker = { type: 'subagent/catalog', childId, time: a, seq: itemSeq, label: cls.title, source: 'official-api', states: item.states }; markers.push(marker); step.markers.push(marker); }
      if (state === 'error') episodes.push({ id: 'codex-' + item.id, turn: output.number, condition: call.error.code, reason: cls.title + '未成功', summary: '后续结果待确认', steps: [step.number], failureSeqs: [itemSeq], pairs: [], readSeqs: [], targets: target ? [target] : [], start: a, end: b, firstError: b, resolvedAt: null, complete: false, failedCount: 1, confirmedCount: 0, unconfirmedCount: 1, failedCallMs: call.durationMs, stepMs: precise ? b - a : null, continuationMs: null, sequence: [{ kind: 'failure', time: b, label: outcome, seqs: [itemSeq] }, { kind: 'unknown', time: b, label: '未推断恢复', seqs: [] }] });
      steps.push(step);
    }
    output.endSeq = seq; output.title = short(prompts[0]?.text || '继续执行', 100);
    if (!steps.length) steps.push({ number: 1, seq: ++seq, start, end: end ?? start, endSeq: seq, assistantSeq: null, assistantTime: null, reply: null, calls: [], retries: [], markers: [], errors: 0, semanticUnit: 'turn-boundary' });
    output.calls = steps.reduce((n, s) => n + s.calls.length, 0);
    // Request-like entries here are renderer compatibility points sampled AFTER
    // observed actions. Their semanticUnit prevents presenting them as requests.
    for (const step of steps) if (local) {
      const row = local.compositions.findLast(r => r.time <= step.end);
      if (row) requests.push({ turn: output.number, step: step.number, seq: step.seq, time: step.end, ...Object.fromEntries(keys.map(k => [k, row[k]])), total: keys.reduce((n, k) => n + row[k], 0), source: 'estimate', semanticUnit: 'visible-retained-text-after-action', activeMs: null });
    }
    return output;
  });
  // Exact same native operation and full parameters, same turn, later successful
  // completion. A changed command is never labeled recovery.
  for (const episode of episodes) {
    const t = turns[episode.turn - 1], original = t.steps.flatMap(s => s.calls).find(c => c.seq === episode.failureSeqs[0]);
    const later = t.steps.flatMap(s => s.calls).find(c => c.seq > original.seq && c.signature === original.signature && c.status === 'returned' && c.start >= original.end);
    if (later) Object.assign(episode, { pairs: [{ failedSeq: original.seq, successSeq: later.seq, successTime: later.end, successStart: later.start }], complete: true, confirmedCount: 1, unconfirmedCount: 0, resolvedAt: later.end, continuationMs: later.end - original.end, summary: '同参操作随后返回成功', sequence: [...episode.sequence.slice(0, 1), { kind: 'success', time: later.end, label: '同参操作随后成功', seqs: [later.seq] }] });
  }
  const totals = { turns: turns.length, steps: turns.reduce((n, t) => n + t.steps.length, 0), calls: turns.reduce((n, t) => n + t.calls, 0), errors: episodes.length };
  const current = local?.current ?? null;
  const session = { id: thread.id, title: thread.name || 'Codex 当前对话', parentSession: thread.parentThreadId, source: { host: 'codex', name: snapshot.source, file: thread.path, session: thread.id }, firstSeq: 0, lastSeq: seq, eventCount: events.length, diagnostics: { replacementEventsExcluded: 0, unmatchedResults: 0, duplicateResults: 0, unresolvedCalls: turns.flatMap(t => t.steps).flatMap(s => s.calls).filter(c => c.resultSeq == null).length }, turns, communications: [], totals, overview: { rulesVersion: 1, episodes, retries: [], representatives: episodes.map(e => e.id) } };
  const evidence = { api: { source: 'official-api', name: snapshot.source }, local: local?.evidence ?? null, timingMatched, visibleEvents: events.length, context: { estimate: true, semantics: 'visible text retained in local history, not full model input', incomplete: true, knownCategories: current ? keys.filter(k => current[k] > 0) : [], unknown: ['unrecorded request serialization', 'image tokens', 'hidden reasoning', 'unrecorded system/tool definitions'] }, model: 'Configured model is current thread metadata; per-turn model comes only from local turn_context.' };
  return { schema: 1, generatedAt: snapshot.capturedAt, mainSession: thread.id, sessions: [session], host: 'codex', events,
    context: { session: thread.id, cutoffSeq: seq, eventCount: events.length, source: { name: 'Codex official history + optional local rollout; independent visible-text estimate' }, requests, boundaries, retries: [], retryStarted: [], callFacts, fileOperations, supplementSources: [], current, route: { model: local?.contexts.at(-1)?.model || thread.model, provider: thread.modelProvider, reasoningEffort: local?.contexts.at(-1)?.reasoningEffort || thread.reasoningEffort }, skillEvents: [...skillEvents, ...(local?.skills || [])], collaborationEvents: local?.collaboration || [], compactions: local?.compactions || [], usage: local?.usage || [] },
    officialStats: { session: thread.id, source: { name: 'Codex native usage telemetry (local rollout)' }, snapshot: { turns: [], steps: [], stepCount: 0 }, context: { pressure: { pressureTokens: local?.latestUsage?.input_tokens ?? null, contextWindow: local?.modelContextWindow ?? null }, breakdown: null, source: 'local-rollout token_count; last completed request input, not projected current occupancy' } }, evidence };
}
