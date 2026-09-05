// Analyzer: turns (turn boundaries + end reasons).
export const turns = {
  id: 'turns',
  version: 1,
  definition: '按 turn/start 与 turn/end 事件统计轮次;按 turn/end.reason.kind 分布结束原因。',
  events: ['turn/start', 'turn/end'],
  misjudge: 'compaction 只 shadow 表面、不删日志,但持久化解析不完整/打包会漏部分事件;turn/end 缺失时 openTurns>0。',
  run(events) {
    let starts = 0;
    const endReasons = {};
    for (const e of events) {
      if (e.type === 'turn/start') starts++;
      else if (e.type === 'turn/end') {
        const k = e.data && e.data.reason && e.data.reason.kind ? e.data.reason.kind : 'unknown';
        endReasons[k] = (endReasons[k] || 0) + 1;
      }
    }
    const ended = Object.values(endReasons).reduce((a, b) => a + b, 0);
    return { turns: starts, ended, openTurns: Math.max(0, starts - ended), endReasons };
  }
};
