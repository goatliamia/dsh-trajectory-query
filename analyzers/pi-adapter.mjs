import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const categories = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
const empty = () => Object.fromEntries(categories.map(k => [k, 0]));
const text = content => typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const excerpt = (value, limit = 16000) => { const s = String(value ?? ''); return { text: s.slice(0, limit), omitted: Math.max(0, s.length - limit) }; };
const estimate = value => { const s = String(value ?? ''), wide = (s.match(/[\u3400-\u9fff]/g) || []).length; return Math.ceil(wide + (s.length - wide) / 4); };
const signature = (name, args) => createHash('sha256').update(JSON.stringify([name, args])).digest('hex');
const basename = value => String(value || '').split('/').at(-1);
export function piSessionPath(entries, leafId = entries.at(-1)?.id) {
  const map = new Map(entries.map(e => [e.id, e])), path = [], visited = new Set();
  let next = leafId;
  while (next) { if (visited.has(next)) throw new Error('Pi session parentId cycle'); visited.add(next); const e = map.get(next); if (!e) throw new Error('Missing Pi session parent: ' + next); path.push(e); next = e.parentId; }
  return path.reverse();
}
// Mirrors the documented Session v3 projection semantics: latest compaction,
// firstKeptEntryId range, current leaf path, then append-only content edits.
export function piVisibleComposition(path) {
  const index = path.findLastIndex(e => e.type === 'compaction');
  let active = path;
  if (index >= 0) {
    const cp = path[index], first = path.findIndex(e => e.id === cp.firstKeptEntryId);
    active = [cp, ...(first >= 0 ? path.slice(first, index).filter(e => !(e.type === 'message' && e.message.role === 'system')) : []), ...path.slice(index + 1)];
  }
  const edits = new Map(active.filter(e => e.type === 'context_edit').map(e => [e.targetId, e.replacement]));
  const parts = empty(), tools = new Map(), sections = new Map(), skillCalls = new Set();
  let system = '';
  const add = (key, value) => { parts[key] += estimate(value); };
  const apply = message => {
    if (message.role === 'system') {
      system += text(message.content);
      for (const [key, value] of Object.entries(message.sections || {})) value == null ? sections.delete(key) : sections.set(key, value);
      for (const tool of message.toolsAdded || []) tools.set((tool.namespace || '') + ':' + tool.name, tool);
      for (const tool of message.toolsRemoved || []) tools.delete((tool.namespace || '') + ':' + tool.name);
    } else if (message.role === 'user') {
      const value = text(message.content), skill = value.match(/^<skill name="[^"]+" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
      if (skill) { add('skill', skill[1]); add('user', skill[2] || ''); } else add('user', value);
    } else if (message.role === 'assistant') {
      add('assistant', text(message.content));
      for (const call of (Array.isArray(message.content) ? message.content : []).filter(c => c.type === 'toolCall')) { add('assistant', JSON.stringify({ name: call.name, arguments: call.arguments })); if (call.name === 'read' && /(?:^|\/)SKILL\.md$/i.test(call.arguments.path || '')) skillCalls.add(call.id); }
    } else if (message.role === 'toolResult') add(skillCalls.has(message.toolCallId) && !message.isError ? 'skill' : 'tool', text(message.content));
    else if (message.role === 'custom') add('inject', text(message.content));
  };
  for (const e of active) {
    if (edits.has(e.id) && edits.get(e.id) === null) continue;
    if (e.type === 'compaction') { if (e.systemMessage) apply(e.systemMessage); add('inject', e.summary); }
    else if (e.type === 'custom_message') add('inject', text(edits.get(e.id)?.content ?? e.content));
    else if (e.type === 'branch_summary') add('inject', e.summary);
    else if (e.type === 'message') apply(edits.has(e.id) ? { ...e.message, content: edits.get(e.id).content } : e.message);
    // Plain custom entries are extension state and do not enter LLM context.
  }
  add('system', system);
  for (const [key, value] of sections) add(['project_context', 'cwd', 'skills'].includes(key) ? 'inject' : 'system', value);
  add('tools', tools.size ? JSON.stringify([...tools.values()]) : '');
  return parts;
}
export function adaptPiSession(input) {
  if (input.header?.type !== 'session' || input.header.version !== 3) throw new Error('Expected Pi Session v3 header');
  const path = piSessionPath(input.entries, input.leafId), synthetic = input.synthetic === true, source = synthetic ? 'synthetic' : 'pi-session-v3';
  const capture = input.capture || [], starts = new Map(), ends = new Map();
  for (const row of capture) {
    if (row.event.type === 'tool_execution_start') starts.set(row.event.toolCallId, row);
    if (row.event.type === 'tool_execution_end') ends.set(row.event.toolCallId, row);
  }
  const callFacts = {}, fileOperations = [], requests = [], boundaries = [], skillEvents = [], events = [], turns = [], episodes = [];
  const resultById = new Map(path.filter(e => e.type === 'message' && e.message.role === 'toolResult').map(e => [e.message.toolCallId, e]));
  let currentTurn = null, seq = 0, known = [], latestUsage = null;
  const newTurn = entry => {
    const start = entry.message.timestamp;
    currentTurn = { id: entry.id, number: turns.length + 1, seq: ++seq, start, end: start, endSeq: null, reason: { kind: 'completed' }, title: text(entry.message.content).replace(/^<skill[\s\S]*?<\/skill>\s*/, '').slice(0, 100), prompts: [{ seq, time: start, ...excerpt(text(entry.message.content)) }], steps: [], markers: [], retries: [], errors: 0 };
    turns.push(currentTurn);
  };
  for (const entry of path) {
    const at = Date.parse(entry.timestamp), entrySeq = ++seq;
    events.push({ id: entry.id, type: entry.type, seq: entrySeq, time: at, synthetic, source });
    if (entry.type === 'message' && entry.message.role === 'user') {
      newTurn(entry);
      const match = text(entry.message.content).match(/^<skill name="([^"]+)" location="([^"]+)">/);
      if (match) skillEvents.push({ id: entry.id, kind: 'explicit-skill-reference', name: match[1], path: match[2], turn: currentTurn.number, step: 1, seq: entrySeq, time: at, status: 'expanded-user-message', source, synthetic });
    }
    if (entry.type === 'message' && entry.message.role === 'system' && entry.message.sections?.skills) {
      const catalog = [...entry.message.sections.skills.matchAll(/<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]+)<\/description>\s*<location>([^<]+)<\/location>\s*<\/skill>/g)].map(m => ({ name: m[1], description: m[2], path: m[3] }));
      if (catalog.length) skillEvents.push({ id: entry.id, kind: 'catalog', entries: catalog, turn: Math.max(1, turns.length), step: 1, seq: entrySeq, time: at, source, synthetic });
    }
    if (entry.type === 'compaction' && currentTurn) {
      boundaries.push({ kind: 'compaction', seq: entrySeq, time: at, turn: currentTurn.number, source, synthetic, tokensBefore: entry.tokensBefore, firstKeptEntryId: entry.firstKeptEntryId, summary: entry.summary });
      currentTurn.markers.push({ type: 'compaction/end', seq: entrySeq, time: at, source, synthetic });
    }
    if (entry.type !== 'message' || entry.message.role !== 'assistant') { known.push(entry); continue; }
    const message = entry.message;
    if (!currentTurn) throw new Error('Assistant message before user input is not a conversational sample');
    const requestParts = piVisibleComposition(known), number = currentTurn.steps.length + 1;
    const responseEnd = message.durationMs == null ? at : message.timestamp + message.durationMs;
    const step = { number, seq: entrySeq, start: message.timestamp, end: responseEnd, endSeq: entrySeq, assistantSeq: entrySeq, assistantTime: responseEnd, reply: text(message.content) ? excerpt(text(message.content)) : null, calls: [], retries: [], markers: [], inTok: message.usage?.input ?? null, cacheTok: message.usage?.cacheRead ?? null, outTok: message.usage?.output ?? null, endObserved: message.durationMs != null, semanticUnit: 'pi-assistant-turn', errors: 0, synthetic };
    latestUsage = message.usage ?? latestUsage;
    for (const native of message.content.filter(c => c.type === 'toolCall')) {
      const resultEntry = resultById.get(native.id), result = resultEntry?.message, begin = starts.get(native.id), finish = ends.get(native.id);
      const state = !result ? 'unknown' : result.isError ? 'error' : 'returned', callSeq = ++seq;
      const start = begin?.observedAt ?? responseEnd, end = finish?.observedAt ?? result?.timestamp ?? null;
      const call = { id: native.id, seq: callSeq, name: native.name === 'bash' ? 'bash' : native.name, nativeName: native.name, signature: signature(native.name, native.arguments), target: native.arguments.path || null, args: excerpt(JSON.stringify(native.arguments)), start, end, resultSeq: result ? ++seq : null, status: state, error: result?.isError ? { code: 'PI_TOOL_ERROR', message: text(result.content).slice(0, 180) } : null, result: result ? excerpt(text(result.content)) : null, durationMs: finish?.event.durationMs ?? result?.durationMs ?? null, timingSource: begin && finish ? source + '-capture' : 'unrecorded-start', source, synthetic };
      step.calls.push(call); step.end = Math.max(step.end, end ?? responseEnd); step.errors += state === 'error' ? 1 : 0;
      const title = native.name === 'read' ? (/SKILL\.md$/i.test(call.target) ? '读取技能材料 ' : '读取 ') + basename(call.target) : ['edit', 'write'].includes(native.name) ? (native.name === 'edit' ? '修改 ' : '写入 ') + basename(call.target) : native.name === 'bash' ? '运行定向检查' : '调用 ' + native.name;
      let outcome = state === 'error' ? '工具返回错误：' + text(result.content).slice(0, 170) : state === 'unknown' ? '没有配对的返回记录。' : text(result.content).slice(0, 170) || '已返回结果。';
      if (native.name === 'bash' && state === 'returned' && /^PASS/m.test(text(result.content))) outcome = '命令输出报告：PASS · ' + text(result.content).replace(/\n/g, ' · ');
      const edit = native.arguments.edits?.[0], preview = native.name === 'edit' && edit ? { before: edit.oldText, after: edit.newText, partial: native.arguments.edits.length !== 1 } : native.name === 'write' ? { before: '', after: native.arguments.content, partial: false } : null;
      callFacts[callSeq] = { seq: callSeq, title, outcome, target: call.target, detail: 'Pi ' + native.name + ' · ' + (synthetic ? '模拟会话，未实际执行' : '会话记录') + (result?.details?.patch ? ' · 返回 details.patch' : ''), tone: state === 'error' ? 'bad' : state === 'unknown' ? 'unknown' : 'normal', resultSeq: call.resultSeq, preview, patch: result?.details?.patch ?? null, source, synthetic };
      if (['read', 'edit', 'write'].includes(native.name) && call.target) fileOperations.push({ seq: callSeq, turn: currentTurn.number, step: number, path: posix.resolve(input.header.cwd, call.target), kind: native.name === 'read' ? 'read' : 'change', status: state, time: start, end, source, synthetic, nativeKind: native.name, diff: result?.details?.patch ? excerpt(result.details.patch) : null });
      if (native.name === 'read' && /SKILL\.md$/i.test(call.target)) skillEvents.push({ id: native.id, kind: 'skill-file-read', name: basename(posix.dirname(call.target)), path: call.target, turn: currentTurn.number, step: number, seq: callSeq, time: start, status: state, source, synthetic });
      if (state === 'error') episodes.push({ id: 'pi-' + native.id, turn: currentTurn.number, condition: 'PI_TOOL_ERROR', reason: title + '未成功', summary: '后续结果待确认', steps: [number], failureSeqs: [callSeq], pairs: [], readSeqs: [], targets: call.target ? [call.target] : [], start, end: end ?? start, firstError: end ?? start, resolvedAt: null, complete: false, failedCount: 1, confirmedCount: 0, unconfirmedCount: 1, failedCallMs: call.durationMs, stepMs: step.end - step.start, continuationMs: null, sequence: [{ kind: 'failure', time: end ?? start, label: outcome, seqs: [callSeq] }], synthetic, source });
    }
    requests.push({ turn: currentTurn.number, step: number, seq: entrySeq, time: message.timestamp, ...requestParts, total: categories.reduce((n, k) => n + requestParts[k], 0), activeMs: null, source: 'estimate', synthetic, semanticUnit: 'pi-request-visible-context-estimate' });
    currentTurn.steps.push(step); currentTurn.errors += step.errors; currentTurn.end = step.end; currentTurn.endSeq = seq;
    known.push(entry);
  }
  for (const episode of episodes) {
    const calls = turns[episode.turn - 1].steps.flatMap(s => s.calls), original = calls.find(c => c.seq === episode.failureSeqs[0]), next = calls.find(c => c.seq > original.seq && c.signature === original.signature && c.status === 'returned' && c.start >= original.end);
    if (next) Object.assign(episode, { complete: true, confirmedCount: 1, unconfirmedCount: 0, resolvedAt: next.end, summary: '相同操作随后返回成功', continuationMs: next.end - original.end, pairs: [{ failedSeq: original.seq, successSeq: next.seq, successTime: next.end, successStart: next.start }], sequence: [...episode.sequence, { kind: 'success', time: next.end, label: '同参操作成功', seqs: [next.seq] }] });
  }
  for (const t of turns) t.calls = t.steps.reduce((n, s) => n + s.calls.length, 0);
  const totals = { turns: turns.length, steps: turns.reduce((n, t) => n + t.steps.length, 0), calls: turns.reduce((n, t) => n + t.calls, 0), errors: episodes.length };
  const session = { id: input.header.id, title: 'Pi · 模拟账单导出任务', parentSession: null, source: { host: 'pi', session: input.header.id, file: 'synthetic-session.jsonl', revision: input.source.revision }, firstSeq: 0, lastSeq: seq, eventCount: path.length, diagnostics: { replacementEventsExcluded: 0, unmatchedResults: 0, duplicateResults: 0, unresolvedCalls: turns.flatMap(t => t.steps).flatMap(s => s.calls).filter(c => c.resultSeq == null).length }, turns, communications: [], totals, overview: { rulesVersion: 1, episodes, retries: [], representatives: episodes.map(e => e.id) } };
  return { schema: 1, host: 'pi', synthetic, generatedAt: new Date().toISOString(), mainSession: session.id, sessions: [session], events, evidence: { synthetic, source: input.source, scenario: input.scenario, nativeFields: ['Session v3 parentId tree', 'SystemMessage.sections/toolsAdded/toolsRemoved', 'AssistantMessage.durationMs/usage', 'ToolResultMessage.isError/details/durationMs', 'CompactionEntry.firstKeptEntryId/systemMessage', 'tool_execution_start/end'], context: { estimate: true, incomplete: true, excluded: ['hidden thinking', 'image tokens', 'provider serialization'] }, agents: 'Pi core has no built-in sub-agents; example extension not installed or simulated.' }, context: { session: session.id, cutoffSeq: seq, eventCount: path.length, source: { name: 'Pi source-format simulation; independent visible-text estimate' }, requests, boundaries, retries: [], retryStarted: [], callFacts, fileOperations, supplementSources: [], current: piVisibleComposition(path), route: { model: 'pi-demo-model · 模拟', provider: 'synthetic-provider' }, skillEvents, agentBranches: [] }, officialStats: { session: session.id, source: { name: 'Synthetic Pi Usage; not provider measurements' }, snapshot: { turns: [], steps: [], stepCount: 0 }, context: { pressure: { pressureTokens: latestUsage ? latestUsage.input + latestUsage.cacheRead + latestUsage.cacheWrite : null, contextWindow: null }, breakdown: null, source: 'synthetic' } } };
}
