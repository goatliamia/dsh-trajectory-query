// Analyzer: errors (tool-result errors + error turn-end reasons), first occurrence per kind.
export const errors = {
  id: 'errors',
  version: 1,
  definition: '统计 tool/result 携带 error(name/code) 与 turn/end reason.kind==="error" 的事件;按 name+code 去重并记录首现 seq。',
  events: ['tool/result', 'turn/end'],
  misjudge: '同一根因常多次报错,去重键不区分上下文;error.code 缺失时只按 name。',
  run(events) {
    const kinds = new Map();
    let total = 0;
    const firstSeqs = [];
    for (const e of events) {
      let name = null; let code = null;
      if (e.type === 'tool/result') {
        const err = e.data && e.data.error;
        if (!err) continue;
        name = err.name; code = err.code;
      } else if (e.type === 'turn/end') {
        const r = e.data && e.data.reason;
        if (!r || r.kind !== 'error') continue;
        name = 'turn-end-error';
        code = (r.error && r.error.code) || (r.error && r.error.message);
      } else continue;
      total++;
      const key = name + (code ? ':' + code : '');
      if (!kinds.has(key)) { kinds.set(key, 0); firstSeqs.push({ kind: key, name, code, firstSeq: e.seq }); }
      kinds.set(key, kinds.get(key) + 1);
    }
    return {
      total,
      distinct: kinds.size,
      firstSeqs: firstSeqs.slice(0, 20).map((f) => ({ ...f, count: kinds.get(f.kind) }))
    };
  },
  // 表格摘要随 analyzer 自带(issue #4)
  summary: (f) => `${f.total} error events / ${f.distinct} kinds`
};
