// Transform recorded outcomes, not tool names alone, into a small branch vocabulary.
export function collectToolResults(session, facts, fileOperations) {
  const covered = new Set();
  const results = session.overview.episodes.map(e => {
    const seqs = [...e.failureSeqs, ...e.readSeqs, ...e.pairs.map(p => p.successSeq)];
    seqs.forEach(seq => covered.add(seq));
    return { id: 'incident:' + e.id, kind: 'incident', turn: e.turn, step: e.steps?.[0], time: e.firstError, seqs, incident: e, calls: [] };
  });
  const files = new Map();
  for (const op of fileOperations) { if (!files.has(op.seq)) files.set(op.seq, []); files.get(op.seq).push(op); }
  for (const t of session.turns) for (const step of t.steps) {
    const groups = new Map();
    for (const call of step.calls) {
      if (covered.has(call.seq)) continue;
      const fact = facts[call.seq], records = files.get(call.seq) || [], file = records[0], operation = fact?.operation;
      let kind = null;
      if (call.status === 'error' || fact?.tone === 'bad') kind = 'error';
      else if (call.status !== 'returned' || call.resultSeq == null) { if (operation) kind = 'pending'; else continue; }
      else if (operation) kind = ({ write: 'change', search: 'query' })[operation.family] || operation.family;
      else if (/^命令输出报告：(?:PASS|FAIL|Tests? (?:passed|failed)|Test Files)\b/i.test(fact?.outcome || '')) kind = 'check';
      else if (file?.kind === 'change') kind = 'change';
      else if (file?.kind === 'read') kind = 'read';
      else if (/^(?:trajectory|session|session_event)_(?:read|search)$/.test(call.name) && /(?:返回|命中) \d+ 条/.test(fact?.outcome || '')) kind = 'query';
      else if (['grep', 'glob', 'web_search', 'web_fetch'].includes(call.name) && fact?.outcome && !/已收到工具返回|工具已返回/.test(fact.outcome)) kind = 'query';
      if (!kind) continue;
      const key = operation ? call.name + ':' + kind : kind;
      let group = groups.get(key);
      if (!group) { group = { id: t.number + ':' + step.number + ':' + key, kind, family: operation?.family, recorded: !!operation, turn: t.number, step: step.number, time: call.end ?? call.start, seqs: [], calls: [] }; groups.set(key, group); }
      group.seqs.push(call.seq);
      group.calls.push({ ...call, file: file?.path ?? null, files: records, fact });
      group.time = Math.max(group.time, call.end ?? call.start);
    }
    results.push(...groups.values());
  }
  return results.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function toolResultLabel(result) {
  if (result.kind === 'incident') return null;
  const calls = result.calls, paths = [...new Set(calls.map(c => c.file).filter(Boolean))];
  if (result.recorded) {
    const call = calls[0], operation = call.fact?.operation;
    if (result.kind === 'pending') return call.name + (calls.length > 1 ? ' ×' + calls.length : '') + ' · 待返回';
    if (result.kind === 'error') return call.name + ' · 受阻';
    if (calls.length > 1) return call.name + ' ×' + calls.length;
    if (call.name === 'grep') return 'grep · ' + (operation?.search?.total ?? operation?.search?.shown ?? '?') + ' 处匹配';
    if (call.name === 'glob') return 'glob · 发现路径';
    if (operation?.family === 'read') return 'read · ' + (operation.metrics.find(([key]) => key === '返回行数')?.[1] || '取回内容');
    if (operation?.family === 'write') return call.name + ' · ' + (paths[0]?.split(/[\\/]/).at(-1) || '文件修改');
    if (operation?.family === 'command') {
      const program = operation.subject.match(/\b(?:node|python3?|lean|lake|git|rg|pnpm|npm|Get-Content|Select-String)\b/)?.[0];
      return call.name + ' · ' + (program || '命令输出');
    }
    return call.name + ' · ' + ({ process: '后台输出', web: '网页返回', coordination: '协作返回' }[operation?.family] || '工具返回');
  }
  if (result.kind === 'error') return calls.length > 1 ? calls.length + ' 次受阻' : '操作受阻';
  if (result.kind === 'read') {
    const range = calls.length === 1 && calls[0].fact?.outcome?.match(/返回第 (\d+)–(\d+) 行/);
    return range ? '取回 ' + (Number(range[2]) - Number(range[1]) + 1) + ' 行' : paths.length === 1 ? '取回文件内容' : '取回 ' + paths.length + ' 个文件';
  }
  if (result.kind === 'change') {
    const preview = calls.length === 1 && calls[0].fact?.preview;
    if (preview && !preview.partial && preview.before === '' && (calls[0].nativeName === 'write' || calls[0].name === 'write')) return '写入 ' + preview.after.split(/\r?\n/).length + ' 行';
    return preview && !preview.partial ? '替换 ' + preview.before.split(/\r?\n/).length + '→' + preview.after.split(/\r?\n/).length + ' 行' : paths.length > 1 ? '修改 ' + paths.length + ' 个文件' : '写入修改已返回';
  }
  if (result.kind === 'check') {
    if (calls.some(c => /^命令输出报告：FAIL\b/i.test(c.fact?.outcome || '') || /^\s*FAIL\b/im.test(c.result?.text || ''))) return '检查报告未过';
    if (calls.every(c => /^命令输出报告：PASS\b/i.test(c.fact?.outcome || ''))) return '检查有通过项';
    return '取得检查输出';
  }
  if (calls.length === 1) {
    const outcome = calls[0].fact?.outcome || '';
    if (/^(?:返回|命中) 0 条/.test(outcome)) return '没有匹配结果';
    return outcome.match(/(?:返回|命中) \d+ 条(?:事件记录|记录)?/)?.[0] || '取回查询结果';
  }
  return calls.length + ' 项查询结果';
}

export function compactToolLabel(call) {
  const operation = call.fact?.operation;
  if (call.name === 'grep') return 'grep ' + (operation?.search?.total ?? operation?.search?.shown ?? '?') + '处';
  if (operation?.family === 'read') return 'read ' + (operation.metrics.find(([key]) => key === '返回行数')?.[1] || '内容').replace(/\s+/g, '');
  if (operation?.family === 'command') { const program = operation.subject.match(/\b(?:node|python3?|lean|lake|git|rg|pnpm|npm)\b/)?.[0]; return program ? call.name + '/' + program : call.name; }
  return call.name === 'job_output' ? '后台输出' : call.name;
}

export function toolResultEndpoint(members) {
  const priority = result => result.kind === 'error' || result.kind === 'incident' && !result.incident.complete ? 3 : result.kind === 'pending' ? 2 : 1;
  return members.reduce((chosen, member) => priority(member.result) > priority(chosen) ? member.result : chosen, members[0].result);
}

// Native measurements are kept intact. Inconsistent historical timing is not drawn as a ratio.
export function toolTiming(stats, step) {
  if (!stats || !Number.isFinite(stats.toolWall)) return { status: 'missing', spans: [], coverage: null, cumulative: null };
  const wall = step.end - step.start;
  const candidates = stats.calls.filter(c => Number.isFinite(c.startedAt) && Number.isFinite(c.endedAt));
  const valid = wall >= 0 && stats.toolWall >= 0 && stats.toolWall <= wall + 1 && candidates.every(c => c.startedAt >= step.start && c.endedAt >= c.startedAt && c.endedAt <= step.end + 1);
  return { status: valid ? 'measured' : 'inconsistent', coverage: stats.toolWall, cumulative: stats.tool,
    spans: valid ? candidates.map(c => ({ start: c.startedAt, end: c.endedAt, seq: c.seq })) : [],
    pending: stats.toolPending, partial: stats.tools.reduce((sum, tool) => sum + tool.count, 0) > stats.calls.length };
}
