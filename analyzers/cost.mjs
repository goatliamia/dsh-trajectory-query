// Analyzer: cost (v1) — deterministic token-usage fold over `assistant/message.usage`.
//
// 成本是**确定性事实**:只从 usage 读数字,不做"值不值"的判断。
// 实测(真实 v3 会话,839 个 assistant/message):
//   - totalTokens === inputTokens + cacheReadTokens + outputTokens,837/837 全等;
//   - cacheWriteTokens 只有 26 条上报、reasoningTokens 811 条 —— **缺失是"没上报",不是 0**;
//   - inputTokens 就是未命中(新)的输入,cacheReadTokens 是命中前缀的部分。
// 所以:整个 usage 缺失的请求记 unknown(字段全 null),单个字段缺失也记 null,求和只加已上报的值。
export const cost = {
  id: 'cost',
  version: 1,
  definition: '按 assistant/message.usage 逐请求汇总 token(input / cacheRead / cacheWrite / output / reasoning / total),并给出确定性的派生量:cache 效率 = cacheRead/(cacheRead+input)。',
  events: ['assistant/message'],
  misjudge: '适配器未上报 usage 的请求记为 unknown(null),不按 0 计;单字段缺失同理。totals 是"已上报值之和",覆盖率见 coverage —— 某个 provider 不报 cacheWrite,不等于它没写缓存。',
  run(events) {
    const requests = [];
    for (const e of events) {
      if (e.type !== 'assistant/message') continue;
      const d = e.data || {};
      const src = (d.message && d.message.source) || {};
      const u = d.usage;
      const row = {
        seq: e.seq,
        turn: typeof d.turn === 'number' ? d.turn : null,
        step: typeof d.step === 'number' ? d.step : null,
        provider: typeof src.provider === 'string' ? src.provider : null,
        model: typeof src.model === 'string' ? src.model : null,
        unknown: u === undefined || u === null || typeof u !== 'object'
      };
      row.input = row.unknown ? null : num(u.inputTokens);
      row.cacheRead = row.unknown ? null : num(u.cacheReadTokens);
      row.cacheWrite = row.unknown ? null : num(u.cacheWriteTokens);
      row.output = row.unknown ? null : num(u.outputTokens);
      row.reasoning = row.unknown ? null : num(u.reasoningTokens);
      row.total = row.unknown ? null : num(u.totalTokens);
      row.cacheEfficiency = row.unknown ? null : ratio(row.cacheRead, row.input);
      requests.push(row);
    }
    return {
      requestCount: requests.length,
      unknownRequests: requests.filter((r) => r.unknown).length,
      coverage: {
        input: countReported(requests, 'input'),
        cacheRead: countReported(requests, 'cacheRead'),
        cacheWrite: countReported(requests, 'cacheWrite'),
        output: countReported(requests, 'output'),
        reasoning: countReported(requests, 'reasoning'),
        total: countReported(requests, 'total')
      },
      totals: totalsOf(requests),
      requests,
      byTurn: groupByTurn(requests)
    };
  },
  // 表格摘要随 analyzer 自带(issue #4)
  summary(f) {
    if (f.requestCount === 0) return '0 requests';
    const t = f.totals;
    const unknown = f.unknownRequests > 0 ? ' (+' + f.unknownRequests + ' unknown)' : '';
    return f.requestCount + ' requests' + unknown + ' · in ' + compact(t.input) + ' / cached ' + compact(t.cacheRead) +
      ' / out ' + compact(t.output) + ' · cache ' + (f.totals.cacheEfficiency === null ? 'n/a' : (f.totals.cacheEfficiency * 100).toFixed(1) + '%');
  }
};

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumKnown(values) {
  let sum = null;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sum = (sum || 0) + v;
  }
  return sum;
}

function ratio(cacheRead, input) {
  if (cacheRead === null || input === null) return null;
  const denominator = cacheRead + input;
  return denominator > 0 ? cacheRead / denominator : null;
}

function countReported(rows, field) {
  let n = 0;
  for (const r of rows) if (r[field] !== null) n++;
  return n;
}

function totalsOf(rows) {
  const input = sumKnown(rows.map((r) => r.input));
  const cacheRead = sumKnown(rows.map((r) => r.cacheRead));
  return {
    requests: rows.length,
    unknownRequests: rows.filter((r) => r.unknown).length,
    input,
    cacheRead,
    cacheWrite: sumKnown(rows.map((r) => r.cacheWrite)),
    output: sumKnown(rows.map((r) => r.output)),
    reasoning: sumKnown(rows.map((r) => r.reasoning)),
    total: sumKnown(rows.map((r) => r.total)),
    cacheEfficiency: ratio(cacheRead, input)
  };
}

function groupByTurn(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.turn === null ? 'null' : String(r.turn);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].map(([key, list]) => ({
    turn: key === 'null' ? null : Number(key),
    ...totalsOf(list)
  }));
}

function compact(value) {
  if (value === null || value === undefined) return 'n/a';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  return String(value);
}
