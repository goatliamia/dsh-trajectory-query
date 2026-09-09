// Analyzer: incidents (v1) — deterministic runtime-incident detection.
// Detects retry-loop (same tool + same args, consecutive, optionally after failure),
// 调用失败 errors, and 空转 turns (no tool call). 每条 incident 带证据 seq(机械层,非模型)。
export const incidents = {
  id: 'incidents',
  version: 1,
  definition: '从事件流确定性判定 incident:retry-loop v1(同 tool 同参连续)、调用失败(error)、空转 turn(该 turn 无工具调用)。',
  events: ['turn/start', 'tool/call', 'tool/result'],
  misjudge: 'retry-loop 仅按"同 tool 同参连续"判定(>=2 次),轮询/幂等探测可能被误报;含错误判定为"该 run 的 seq 区间内出现过失败结果"。',
  run(events) {
    let turns = 0, currentTurn = 0;
    const turnTools = new Map();
    const turnErrors = new Set();
    const turnAssistant = new Set();
    const nameSeq = [];
    let toolCalls = 0, errors = 0;
    const errorSeqs = new Set();
    const errFirst = [];
    for (const e of events) {
      if (e.type === 'turn/start') { turns++; currentTurn++; continue; }
      if (e.type === 'assistant/message' && currentTurn) turnAssistant.add(currentTurn);
      if (e.type === 'tool/call') {
        toolCalls++;
        const name = e.data && e.data.name ? e.data.name : '(tool)';
        const args = e.data && typeof e.data.arguments === 'string' ? e.data.arguments : JSON.stringify(e.data && e.data.arguments);
        nameSeq.push({ name, args, seq: e.seq, turn: currentTurn });
        turnTools.set(currentTurn, (turnTools.get(currentTurn) || 0) + 1);
      } else if (e.type === 'tool/result') {
        const d = e.data;
        const err = d && (d.error || (d.message && d.message.content && d.message.content[0] && d.message.content[0].isError));
        if (err) {
          errors++;
          errorSeqs.add(e.seq);
          if (currentTurn) turnErrors.add(currentTurn);
          if (errFirst.length < 8) errFirst.push({ kind: (d.error && (d.error.name || d.error.code)) || 'error', seq: e.seq });
        }
      }
    }
    let emptyTurns = 0;
    for (let t = 1; t <= turns; t++) if (!(turnTools.get(t) > 0) && !turnAssistant.has(t)) emptyTurns++;

    // retry-loop: consecutive same name + same args
    const list = [];
    let i = 0;
    while (i < nameSeq.length) {
      let j = i;
      while (j < nameSeq.length && nameSeq[j].name === nameSeq[i].name && nameSeq[j].args === nameSeq[i].args) j++;
      if (j - i >= 2) {
        const run = nameSeq.slice(i, j);
        const hasErr = run.some((x) => { for (const s of errorSeqs) if (s >= x.seq && s <= x.seq + 3) return true; return false; });
        list.push({
          type: 'retry-loop', severity: (j - i) + (hasErr ? 2 : 0),
          title: '重复调用循环', detail: '连续 ' + (j - i) + ' 次对 "' + run[0].name + '" 的重复调用(同参)',
          cause: run[0].name + ' 同签名工具连续重复调用' + (hasErr ? '; 且 seq 区间含失败结果' : ''),
          runtimeKnew: hasErr ? '上一次调用失败,重复状态已累积' : '重复调用状态已累积',
          modelKnew: '仅收到各次 tool result,无重复/失败聚合状态',
          harness: '未检测到主动打断', impact: (j - i) + ' 次冗余调用',
          seqs: run.map((x) => x.seq)
        });
      }
      i = j;
    }
    if (errors > 0) list.push({
      type: 'error', severity: 1, title: '调用失败', detail: errors + ' 个调用返回错误',
      cause: '工具调用返回错误', runtimeKnew: '错误码见证据', modelKnew: '收到 tool result(可能已含错误)', harness: '未检测到针对性处理', impact: '该部分目标未达成',
      seqs: errFirst.map((x) => x.seq)
    });
    if (emptyTurns > 0) list.push({
      type: 'noop', severity: 1, title: '空转 turn', detail: emptyTurns + ' 个 turn 无任何工具调用',
      cause: '该 turn 未产生工具动作', runtimeKnew: '-', modelKnew: '无工具上下文', harness: '-', impact: '该 turn 未推进', seqs: []
    });
    list.sort((a, b) => b.severity - a.severity);
    return { turns, toolCalls, errors, emptyTurns, incidentCount: list.length, incidents: list };
  },
  // 表格摘要随 analyzer 自带(issue #4):空表也不能是空单元格
  summary(f) {
    const list = f.incidents || [];
    if (list.length === 0) return '0 incidents';
    const byType = {};
    for (const inc of list) byType[inc.type] = (byType[inc.type] || 0) + 1;
    const noun = f.incidentCount === 1 ? 'incident' : 'incidents';
    return `${f.incidentCount} ${noun}: ` + Object.entries(byType).map(([type, n]) => `${type}×${n}`).join(', ');
  }
};
