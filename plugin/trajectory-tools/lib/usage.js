// Shared usage extraction for history queries and diagnostic distributions.
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = values => { const known = values.filter(v => v != null); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
export function cacheEfficiency(cacheRead, input) {
  return cacheRead == null || input == null || cacheRead + input <= 0 ? null : cacheRead / (cacheRead + input);
}
export function costRequests(events) {
  return (events || []).filter(e => e.type === 'assistant/message' && !(e.surfaceOp && typeof e.surfaceOp === 'object')).map(event => {
    const data = event.data || {}, source = data.message?.source || {}, usage = data.usage;
    const unknown = !usage || typeof usage !== 'object';
    const row = { seq: event.seq, turn: number(data.turn), step: number(data.step),
      provider: typeof source.provider === 'string' ? source.provider : null,
      model: typeof source.model === 'string' ? source.model : null, unknown,
      input: unknown ? null : number(usage.inputTokens), cacheRead: unknown ? null : number(usage.cacheReadTokens),
      cacheWrite: unknown ? null : number(usage.cacheWriteTokens), output: unknown ? null : number(usage.outputTokens),
      reasoning: unknown ? null : number(usage.reasoningTokens), total: unknown ? null : number(usage.totalTokens) };
    row.cacheEfficiency = cacheEfficiency(row.cacheRead, row.input);
    return row;
  });
}
export function costTotals(rows = []) {
  const totals = Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'total'].map(k => [k, sum(rows.map(r => r[k]))]));
  return { requests: rows.length, unknownRequests: rows.filter(r => r.unknown).length, ...totals,
    cacheEfficiency: cacheEfficiency(totals.cacheRead, totals.input) };
}
export function costCoverage(rows = []) {
  return Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'total'].map(k => [k, rows.filter(r => r[k] != null).length]));
}
export function costByTurn(rows = []) {
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.turn)) groups.set(row.turn, []); groups.get(row.turn).push(row); }
  return [...groups].map(([turn, own]) => ({ turn, ...costTotals(own) }));
}
