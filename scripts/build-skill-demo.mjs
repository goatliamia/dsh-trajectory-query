import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createPiSample } from '../analyzers/pi-sample.mjs';
import { adaptPiSession } from '../analyzers/pi-adapter.mjs';

const input = createPiSample({ version: 'simulation', revision: 'synthetic-skill-study', repository: 'local-demo', localPath: 'synthetic' }, { skillStudy: true });
const payload = adaptPiSession(input), session = payload.sessions[0];
const compression = payload.context.boundaries.find(e => e.kind === 'compaction');
payload.context.route = { provider: '交互样例', model: '模拟 Agent' };
payload.skillStudy = { synthetic: true, selected: 'report-check', skills: ['report-check', 'csv-export'].map(name => {
  const reads = payload.context.skillEvents.filter(e => e.kind === 'skill-file-read' && e.name === name);
  const relations = session.turns.flatMap(t => t.steps.flatMap(step => {
    const quote = step.reply?.text || '';
    if (!quote.includes(name) || !step.calls.some(c => c.name !== 'read')) return [];
    const calls = step.calls.filter(c => c.name !== 'read');
    return [{ turn: t.number, step: step.number, time: step.start, seqs: calls.map(c => c.seq), quote, evidence: 'explicit-reference' }];
  }));
  return { name, label: name === 'report-check' ? '金额检查' : 'CSV 导出', path: reads[0]?.path, reads,
    intervals: reads.map(read => ({ from: read.time, to: compression && read.time < compression.time ? compression.time : session.turns.at(-1).end,
      turn: read.turn, endReason: compression && read.time < compression.time ? '压缩后正文移出' : '保留至记录末尾', evidence: 'synthetic-context-snapshot' })), relations };
}) };
let page = readFileSync(resolve('.dsh/layout-review/geist.html'), 'utf8');
page = page.replace(/<script id="trace-data" type="application\/json">[\s\S]*?<\/script>/, () => '<script id="trace-data" type="application/json">' + JSON.stringify(payload).replace(/</g, '\\u003c') + '</script>');
page = page.replace(/<title>[^<]*<\/title>/, '<title>Skill · 关系模拟</title>').replace('<body class="geist-review">', '<body class="geist-review skill-study">').replace('<strong>执行路径</strong>', '<strong>Skill · 关系模拟</strong>');
page = page.replace('<div class="app">', '<div class="study-banner" role="note"><b>模拟数据</b>金额显示与 CSV 导出 · 读取、引用、压缩和结果均为演示。</div><div class="app">');
page = page.replace('</head>', '<style>' + readFileSync('docs/demo/layout-review/skill-study.css', 'utf8') + '</style></head>');
const seam = "  $('review-return').onclick=reviewReturnOverview;", index = page.lastIndexOf(seam);
page = page.slice(0, index) + readFileSync('docs/demo/layout-review/skill-study.js', 'utf8') + '\n' + page.slice(index);
for (const script of page.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
const output = resolve('.dsh/skill-review'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'graph-data.json'), JSON.stringify(payload));
writeFileSync(resolve(output, 'index.html'), page);
console.log(JSON.stringify({ page: '/skills', synthetic: true, skills: payload.skillStudy.skills.map(s => ({ name: s.name, reads: s.reads.length, references: s.relations.length, intervals: s.intervals.length })) }));
