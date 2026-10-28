import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const folder = resolve('.dsh/layout-review');
mkdirSync(folder, { recursive: true });
const html = readFileSync(resolve(folder, 'installed-trace.html'), 'utf8');
const match = html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Missing installed trace payload');
const raw = JSON.parse(match[1]);
const s = raw.sessions.find(s => s.id === raw.mainSession);
const names = { edit: '修改', write: '写入', read: '读取', pwsh: '命令', bash: '命令', cordis_inspect_query: '运行时查询', read_image: '读图', session_search: '历史查询' };
const turns = s.turns.map(t => ({
  number: t.number, start: t.start, end: t.end ?? t.steps.at(-1)?.end ?? t.start,
  steps: t.steps.length, calls: t.calls, errors: t.errors, reason: t.reason?.kind,
  stepTimes: t.steps.map(s => ({ start: s.start, end: s.end, number: s.number })),
}));
const episodes = s.overview.episodes.map(e => {
  const call = s.turns.find(t => t.number === e.turn)?.steps.flatMap(s => s.calls).find(c => e.failureSeqs.includes(c.seq));
  const operation = names[call?.name] || call?.name || '工具';
  const label = e.condition.startsWith('FS_') ? '修改受阻' : e.condition === 'TOOL_TIMEOUT' ? '查询超时' : e.condition === 'SESSION_QUERY_PERSISTENCE_FAILED' ? '历史库异常' : operation + '报错';
  return { ...e, targets: undefined, label, tool: call?.name };
});
const retries = s.turns.flatMap(t => t.steps.flatMap(s => s.retries.map(r => ({ id: 'retry-' + r.seq, turn: t.number, step: s.number, time: r.time, delayMs: r.delayMs || 0, seq: r.seq, code: r.failure?.code || '请求失败' }))));
const data = { sessionId: s.id, title: s.title, totals: s.totals, turns, episodes, retries, capturedAt: new Date().toISOString() };
writeFileSync(resolve(folder, 'data.json'), JSON.stringify(data));
console.log(JSON.stringify({ turns: turns.length, incidents: episodes.length, retries: retries.length, output: resolve(folder, 'data.json') }));
