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

const ANALYZERS = [turns, tools, errors, retry];
const here = dirname(fileURLToPath(import.meta.url));

const file = process.argv[2];
if (!file) { console.error('usage: node run-digest.mjs <session.zstd> [outPrefix]'); process.exit(1); }
const outPrefix = process.argv[3] || join(here, '..', 'experiments', 'reports', 'digest-' + basename(file).replace(/\.jsonl\.zstd$/i, ''));

const { id, events } = loadSession(file);
const facts = {};
for (const a of ANALYZERS) facts[a.id] = { version: a.version, ...a.run(events) };

const rows = [];
for (const a of ANALYZERS) {
  const f = facts[a.id];
  const cells = [];
  if (a.id === 'turns') cells.push(`${f.turns} turns (end ${f.ended})`);
  if (a.id === 'tools') cells.push(`${f.total} calls / ${f.distinct} tools; top: ${f.byName.slice(0, 3).map((x) => `${x.name}×${x.calls}`).join(', ')}`);
  if (a.id === 'errors') cells.push(`${f.total} error events / ${f.distinct} kinds`);
  if (a.id === 'retry') cells.push(`${f.suspectedPairs} suspected repeat pairs`);
  rows.push(`| ${a.id} v${a.version} | ${cells.join(' ')} |`);
}

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
  '> 列全部由确定性分析器产出(模型不写列)。开放解读与人工核验见 skill/analysis.md。',
  ''
].join('\n');

writeFileSync(`${outPrefix}.facts.json`, JSON.stringify({ session: id, events: events.length, facts }, null, 2), 'utf8');
writeFileSync(`${outPrefix}.digest.md`, md, 'utf8');
console.log(md);
console.log(`WROTE ${outPrefix}.facts.json / .digest.md`);
