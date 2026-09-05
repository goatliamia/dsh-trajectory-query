// Analyzer: tools (tool/call histogram + total).
export const tools = {
  id: 'tools',
  version: 1,
  definition: '按 tool/call 事件的 name 统计调用次数与分布。',
  events: ['tool/call'],
  misjudge: '解析不完整会话会低估;同一逻辑动作多次底层调用会被分开计数。',
  run(events) {
    const byName = {};
    let total = 0;
    for (const e of events) {
      if (e.type !== 'tool/call') continue;
      const n = e.data && e.data.name ? e.data.name : '(unknown)';
      byName[n] = (byName[n] || 0) + 1;
      total++;
    }
    const names = Object.keys(byName).sort((a, b) => byName[b] - byName[a]);
    return { total, distinct: names.length, byName: names.slice(0, 15).map((n) => ({ name: n, calls: byName[n] })) };
  }
};
