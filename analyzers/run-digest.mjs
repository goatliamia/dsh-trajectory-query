// Digest runner: session artifact → structured facts (analyzers) → md report + facts json.
// Usage: node analyzers/run-digest.mjs <session.zstd> [outPrefix]
// outPrefix 缺省为 "experiments/reports/digest-<sessionId-or-file>"
import { writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSession } from './load-session.mjs';
import { turns } from './turns.mjs';
import { tools } from './tools.mjs';
import { errors } from './errors.mjs';
import { retry } from './retry.mjs';
import { incidents } from './incidents.mjs';

const ANALYZERS = [turns, tools, errors, retry, incidents];
const here = dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) { console.error('usage: node run-digest.mjs <session.zstd> [outPrefix]'); process.exit(1); }
const outPrefix = process.argv[3] || join(here, '..', 'experiments', 'reports', 'digest-' + basename(file).replace(/\.jsonl\.zstd$/i, ''));

const { id, events } = loadSession(file);
const facts = {};
for (const a of ANALYZERS) facts[a.id] = { version: a.version, ...a.run(events) };

// 每个 analyzer 自带 summary(facts);漏写时显式渲染 "(no summary)",不再静默留空(issue #4)。
const rows = ANALYZERS.map((a) => {
  const summary = typeof a.summary === 'function' ? a.summary(facts[a.id]) : '(no summary)';
  return `| ${a.id} v${a.version} | ${summary} |`;
});

const incidentLines = facts.incidents && facts.incidents.incidents ? facts.incidents.incidents.map((x) => `- **${x.title}** (sev ${x.severity}) — ${x.detail}; cause: ${x.cause}; runtime: ${x.runtimeKnew}; model: ${x.modelKnew}; harness: ${x.harness}; impact: ${x.impact}; evidence seq: ${(x.seqs || []).join(', ')}`) : ['- 无'];
const md = [
  `# Digest: ${id || basename(file)}`,
  '',
  `- 生成:${new Date().toISOString()};文件:${file}`,
  `- 事件(可解析落盘):${events.length};seq ${events.length ? events[0].seq : '-'}–${events.length ? events[events.length - 1].seq : '-'}`,
  `- 复跑:\`node analyzers/run-digest.mjs "${file}"\``,
  `- 局限:jsonl 打包/截断会漏事件;live 会话最准走 ctx.sessionQuery(分析器同源可复用)。`,
  '',
  '| analyzer v | facts |',
  '| --- | --- |',
  ...rows,
  '',
  '### Incidents (v1, 机械层, 确定性)',
  ...incidentLines,
  '',
  '> 列全部由确定性分析器产出(模型不写列)。开放解读与人工核验见 skill/analysis.md。',
  ''
].join('\n');

writeFileSync(`${outPrefix}.facts.json`, JSON.stringify({ session: id, events: events.length, facts }, null, 2), 'utf8');
writeFileSync(`${outPrefix}.digest.md`, md, 'utf8');
console.log(md);
console.log(`WROTE ${outPrefix}.facts.json / .digest.md`);
