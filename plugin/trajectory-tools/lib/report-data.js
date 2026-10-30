// The evidence service owns measurements; renderers receive this compact,
// versioned table without excerpts, methods, or a second statistics formula.
import { createHash } from 'node:crypto';

export const REPORT_DATA_VERSION = 'trajectory-data/1';
export const REPORT_COLUMNS = {
  turn: ['轮次', 'turn', 'identifier'], step: ['步骤', 'step', 'identifier'],
  time: ['记录时间', 'timestamp-ms', 'observed'], start: ['开始时间', 'timestamp-ms', 'observed'], end: ['返回时间', 'timestamp-ms', 'observed'],
  wallMs: ['活动耗时', 'ms', 'official'], ttftMs: ['首字等待', 'ms', 'official'], modelMs: ['模型耗时', 'ms', 'official'],
  toolMs: ['工具累计耗时', 'ms', 'official'], toolCoveredMs: ['工具覆盖时间', 'ms', 'official'],
  contextTokens: ['步骤输入记录', 'tokens', 'official'], uncachedInputTokens: ['未缓存输入', 'tokens', 'reported'],
  cacheHit: ['输入缓存比例', 'ratio', 'official'],
  cacheReadTokens: ['缓存读取', 'tokens', 'reported'], cacheWriteTokens: ['缓存写入', 'tokens', 'reported'], outputTokens: ['输出', 'tokens', 'reported'],
  retries: ['重试次数', 'count', 'official'], calls: ['调用次数', 'count', 'observed'], errors: ['错误数', 'count', 'observed'],
  operations: ['文件操作记录', 'count', 'observed'],
  returnedCharacters: ['返回文本', 'characters', 'observed'], nativeDurationMs: ['原生持续时间', 'ms', 'reported'],
  name: ['工具', 'text', 'observed'], file: ['文件', 'text', 'observed'], status: ['返回状态', 'text', 'observed'],
  text: ['原文摘录', 'text', 'verbatim'], kind: ['记录类型', 'text', 'observed'],
  omittedCharacters: ['摘录省略字符', 'characters', 'observed'],
  system: ['系统提示', 'tokens', 'estimated'], tools: ['工具定义', 'tokens', 'estimated'], user: ['用户消息', 'tokens', 'estimated'],
  inject: ['补充内容', 'tokens', 'estimated'], skill: ['技能内容', 'tokens', 'estimated'], assistant: ['助手消息', 'tokens', 'estimated'], tool: ['工具结果', 'tokens', 'estimated'],
  total: ['构成估算合计', 'tokens', 'estimated'],
};
export function reportTable({ source, kind, rows, fields, coverage = {}, labels = {}, columnInfo = {} }) {
  if (!source?.host || !source.session || !source.snapshot || typeof source.log !== 'string' || !source.log) throw Error('Report data requires host, session, snapshot and a string log identity');
  const columns = Object.fromEntries(fields.map(key => {
    if (!REPORT_COLUMNS[key]) throw Error('Unknown report field: ' + key);
    const [label, unit, basis] = REPORT_COLUMNS[key]; return [key, { label: labels[key] || label, unit, basis, nullable: true,
      aggregate: ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'calls', 'errors', 'returnedCharacters'].includes(key) ? 'sum' : 'none', ...columnInfo[key] }];
  }));
  const id = createHash('sha256').update(JSON.stringify([source, kind, fields])).digest('hex').slice(0, 24);
  return { schema: REPORT_DATA_VERSION, id, source, kind, columns, coverage,
    rows: rows.map(row => {
      if (typeof row.id !== 'string' || !row.id) throw Error('Report rows need stable IDs');
      return { id: row.id, evidence: row.evidence || [], ...Object.fromEntries(fields.map(key => [key,
        typeof row[key] === 'number' ? Number.isFinite(row[key]) ? row[key] : null : row[key] ?? null])) };
    }) };
}
export function reportPage(table, offset = 0, limit = 250) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > table.rows.length) throw Error('Invalid data offset');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Data limit must be 1..500');
  return { ...table, rows: table.rows.slice(offset, offset + limit), totalRows: table.rows.length, offset,
    nextOffset: offset + limit < table.rows.length ? offset + limit : null };
}
export const reportRef = (index, seq) => Number.isSafeInteger(seq) ? [{ session: index.scope.session, log: index.log?.id ?? index.log, seq }] : [];

export function inspectionReportData(index, query, source) {
  const inRange = turn => !query.turns || turn >= query.turns.from && turn <= query.turns.to;
  const pathKey = value => { const normalized = value.replace(/\\+/g, '/').replace(/\/+/g, '/'); return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized; };
  const match = call => !query.focus || (query.focus.tool ? call.name === query.focus.tool
    : call.files.some(file => pathKey(file.path) === pathKey(query.focus.file)));
  const calls = index.views.io.filter(c => inRange(c.turn) && match(c));
  if (query.focus?.tool) for (const root of index.relations?.calls || []) {
    if (root.name !== query.focus.tool || calls.some(c => c.seq === root.callSeq)) continue;
    const [turn, step] = index.relations.locations[root.callSeq] || [];
    if (inRange(turn)) calls.push({ seq: root.callSeq, resultSeq: root.resultSeq, turn, step, name: root.name,
      files: [], status: root.resultSeq == null ? 'unknown' : 'returned', outputCharacters: null, start: null, end: null });
  }
  calls.sort((a,b)=>a.seq-b.seq);
  const keys = query.focus ? new Set(calls.map(c => c.turn + ':' + c.step)) : null;
  const selected = row => inRange(row.turn) && (!keys || keys.has(row.turn + ':' + row.step));
  const coverage = { ...index.coverage, ...(query.focus ? { focusedMetrics: 'Whole owning steps; not attributed tool/file usage or waiting' } : {}) };
  if (query.groupBy === 'file') coverage.grouping = 'Calls touching multiple files occur in multiple groups; returned characters describe each complete call result';
  const table = (kind, rows, fields) => reportTable({ source, kind, rows, fields, coverage });
  if (query.view === 'context') {
    const fields = ['seq', 'turn', 'step', 'time', 'system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total'];
    const requests = (index.contextSamples || []).map(tuple => Object.fromEntries(fields.map((key, i) => [key, tuple[i]]))).filter(selected).sort((a,b)=>a.seq-b.seq);
    coverage.context = { ...coverage.context, selectedRows: requests.length,
      status: !requests.length ? 'unavailable' : index.coverage.context.firstRecordedTurn > (query.turns?.from ?? 1) ? 'partial' : 'available',
      missingValues: 'null means unrecorded; gaps are not zero', sampleUnit: 'recorded request composition' };
    return table('context', requests.map(r => ({ ...r, id: 'context:' + r.seq, evidence: reportRef(index, r.seq) })),
      ['turn', 'step', 'time', 'system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total']);
  }
  if (query.view === 'cost') return table('usage', index.usageRows.filter(selected).sort((a,b)=>a.seq-b.seq).map(r => ({
    id: 'usage:' + r.seq, turn: r.turn, step: r.step, uncachedInputTokens: r.input,
    cacheReadTokens: r.cacheRead, cacheWriteTokens: r.cacheWrite, outputTokens: r.output, evidence: reportRef(index, r.seq),
  })), ['turn', 'step', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']);
  if (query.view === 'io' || query.view === 'repeats') {
    if (query.view === 'repeats') throw Error('Use the repeats summary and linked reads to select an evidence-backed sequence; no inferred attempt graph');
    if (query.groupBy) {
      const groups = new Map();
      for (const c of calls) for (const label of new Set(query.groupBy === 'tool' ? [c.name] : c.files.map(f => f.path))) {
        if (!groups.has(label)) groups.set(label, { id: 'group:' + label, name: query.groupBy === 'tool' ? label : null, file: query.groupBy === 'file' ? label : null, calls: 0, errors: 0, returnedCharacters: 0, evidence: [] });
        const g = groups.get(label); g.calls++; g.errors += c.status === 'error' ? 1 : 0;
        g.returnedCharacters = g.returnedCharacters === null || c.outputCharacters == null ? null : g.returnedCharacters + c.outputCharacters;
        if (g.evidence.length < 6) g.evidence.push(...reportRef(index, c.seq));
      }
      return table('groups', [...groups.values()], [query.groupBy === 'tool' ? 'name' : 'file', 'calls', 'errors', 'returnedCharacters']);
    }
    return table('calls', calls.map(c => ({ ...c, id: 'call:' + c.seq, returnedCharacters: c.outputCharacters,
      evidence: [...reportRef(index, c.seq), ...reportRef(index, c.resultSeq)] })), ['turn', 'step', 'name', 'status', 'start', 'end', 'returnedCharacters']);
  }
  return table('steps', index.stepEntries.filter(selected).sort((a,b)=>(a.evidence.seq??Infinity)-(b.evidence.seq??Infinity)).map(s => ({ id: 'step:' + s.turn + ':' + s.step,
    turn: s.turn, step: s.step, start: s.evidence.start, end: s.evidence.end,
    wallMs: s.official.wall, ttftMs: s.official.ttft, modelMs: s.official.model, toolMs: s.official.tool,
    toolCoveredMs: s.official.toolWall, contextTokens: s.official.context, cacheHit: s.official.cacheHit, outputTokens: s.official.output, retries: s.official.retries,
    evidence: reportRef(index, s.evidence.assistantSeq ?? s.evidence.seq),
  })), ['turn', 'step', 'start', 'end', 'wallMs', 'ttftMs', 'modelMs', 'toolMs', 'toolCoveredMs', 'contextTokens', 'cacheHit', 'outputTokens', 'retries']);
}
