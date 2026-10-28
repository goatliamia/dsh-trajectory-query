export const CONTEXT_CATEGORIES = [
  { key: 'system', label: '系统提示', color: '#7065c6' },
  { key: 'tools', label: '工具定义', color: '#bf8b32' },
  { key: 'user', label: '用户消息', color: '#4c946d' },
  { key: 'inject', label: '补充内容', color: '#ab6ba4' },
  { key: 'skill', label: '技能内容', color: '#cf7950' },
  { key: 'assistant', label: '助手消息', color: '#5286bf' },
  { key: 'tool', label: '工具结果', color: '#39a29b' },
];

// Independent implementation of the documented context turn/delta semantics:
// compare the last dispatched context of adjacent turn runs, category by category.
export function contextByTurn(requests) {
  const turns = [];
  for (const request of requests) {
    const previous = turns.at(-1);
    if (previous && previous.turn === (request.turn ?? 0)) {
      previous.last = request;
      previous.steps++;
    } else turns.push({ turn: request.turn ?? 0, steps: 1, last: request });
  }
  return turns.map((run, i) => {
    const baseline = i ? turns[i - 1].last : null;
    const parts = {};
    let increase = 0, decrease = 0, net = 0;
    for (const category of CONTEXT_CATEGORIES) {
      const after = run.last[category.key] ?? 0;
      const before = baseline?.[category.key] ?? 0;
      const delta = baseline === null ? 0 : after - before;
      parts[category.key] = { before, after, delta };
      net += delta;
      if (delta > 0) increase += delta;
      else decrease -= delta;
    }
    return {
      turn: run.turn, steps: run.steps, seq: run.last.seq, time: run.last.time,
      baselineSeq: baseline?.seq ?? null, baselineTurn: i ? turns[i - 1].turn : null,
      isBaseline: baseline === null, net, increase, decrease, parts,
      total: CONTEXT_CATEGORIES.reduce((sum, c) => sum + parts[c.key].after, 0),
    };
  });
}

// One session-wide scale for ordinary additions. Panning and horizontal zoom
// never change vertical units; unusually large replacements are explicitly capped.
export function contextDisplayScale(rows) {
  let values = rows.filter(r => !r.isBaseline && r.increase > 0).map(r => r.increase);
  if (!values.length) values = rows.map(r => r.decrease).filter(v => v > 0);
  values.sort((a, b) => a - b);
  const typical = Math.max(1000, values[Math.max(0, Math.ceil(values.length * .95) - 1)] || 1000);
  const order = 10 ** Math.floor(Math.log10(typical));
  const limit = [1, 2, 3, 5, 10].map(n => n * order).find(n => n >= typical);
  return { limit, pixels: 108 };
}

export function contextBarAmounts(row) {
  if (!row) return { increase: 0, decrease: 0, values: {} };
  return {
    increase: row.isBaseline ? row.total : row.increase,
    decrease: row.isBaseline ? 0 : row.decrease,
    values: Object.fromEntries(CONTEXT_CATEGORIES.map(c => [c.key, row.parts[c.key][row.isBaseline ? 'after' : 'delta']])),
  };
}

export function contextDisplaySide(amount, scale) {
  const height = Math.min(Math.max(0, amount), scale.limit) / scale.limit * scale.pixels;
  return { height, factor: amount > 0 ? height / amount : 0, overflow: amount > scale.limit };
}

export function recoveredStepNumbers(turn, episodes) {
  const successfulCalls = new Set(episodes.filter(e => e.turn === turn.number).flatMap(e => e.pairs.map(p => p.successSeq)));
  return new Set(turn.steps.filter(s => !s.calls.some(c => c.status === 'error') &&
    s.calls.some(c => c.status === 'returned' && successfulCalls.has(c.seq))).map(s => s.number));
}
