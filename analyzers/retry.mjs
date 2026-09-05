// Analyzer: retry v1 — suspected ineffective repeat calls (heuristic, needs human check).
export const retry = {
  id: 'retry',
  version: 1,
  definition: '疑似无效重复:相邻(seq 差<50)两次 tool/call 的 name 与 arguments 完全一致,记为一次疑似重复对。',
  events: ['tool/call'],
  misjudge: '同参重复不一定是无效(轮询/幂等探测/故意重试);只报"疑似",样本需人工核对后才算结论。',
  run(events) {
    const calls = events.filter((e) => e.type === 'tool/call');
    const pairs = [];
    for (let i = 1; i < calls.length; i++) {
      const a = calls[i - 1]; const b = calls[i];
      if (b.seq - a.seq < 50 && (a.data && a.data.name) === (b.data && b.data.name) && (a.data && a.data.arguments) === (b.data && b.data.arguments)) {
        pairs.push({ name: a.data.name, seq: a.seq, nextSeq: b.seq });
      }
    }
    return { suspectedPairs: pairs.length, samples: pairs.slice(0, 10) };
  }
};
