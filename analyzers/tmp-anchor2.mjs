import { readFileSync, writeFileSync } from 'node:fs';

const file = 'plugin/analysis-view/lib/trace/page.js';
let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const oldRestore = `    if(anchor){const p=overviewProjection,l=p.layout[anchor.index];viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
const newRestore = `    if(anchor){const p=overviewProjection;const l=p.layout.find(row=>row.index===anchor.index)||p.layout.find(row=>row.turn&&row.turn.number===anchor.turn);if(l)viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
if (s.includes(oldRestore)) s = s.replace(oldRestore, newRestore);
else console.log('restore already guarded');

const oldAnchor = `      if(segment)anchor={index:segment.index,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
const newAnchor = `      if(segment)anchor={index:segment.index,turn:segment.turn&&segment.turn.number,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
if (s.includes(oldAnchor)) s = s.replace(oldAnchor, newAnchor);
else console.log('anchor already has turn');

// 整页渲染兜底:出错就显示一行错误,而不是留一张空白图
if (!s.includes('__renderGuard')) {
  s = s.replace(
    'function render() {',
    `function render() {\n    try { renderUnguarded(); } catch (error) { window.__renderGuard = String(error && error.message || error); const box = document.getElementById('render-error'); if (box) { box.hidden = false; box.textContent = '渲染失败:' + window.__renderGuard; } }\n    if (false) {`,
  );
  // 给原来的函数改名
  s = s.replace('function render() {', 'function renderUnguarded() {');
}
writeFileSync(file, s, 'utf8');
console.log('guards written');
