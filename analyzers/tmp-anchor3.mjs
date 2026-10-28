import { readFileSync, writeFileSync } from 'node:fs';

const file = 'plugin/analysis-view/lib/trace/page.js';
let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const oldRestore = `    if(anchor){const p=overviewProjection,l=p.layout[anchor.index];viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
const newRestore = `    if(anchor){const p=overviewProjection;const l=p.layout.find(row=>row.index===anchor.index)||p.layout.find(row=>row.turn&&row.turn.number===anchor.turn);if(l)viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
if (s.includes(oldRestore)) s = s.replace(oldRestore, newRestore);

const oldAnchor = `      if(segment)anchor={index:segment.index,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
const newAnchor = `      if(segment)anchor={index:segment.index,turn:segment.turn&&segment.turn.number,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
if (s.includes(oldAnchor)) s = s.replace(oldAnchor, newAnchor);

if (!s.includes('function renderSafe()')) {
  s = s.replace(/\n  function render\(\) \{/, '\n  function render() { try { renderSafe(); } catch (error) { const box = document.getElementById("render-error"); if (box) { box.hidden = false; box.textContent = "渲染失败:" + (error && error.message || error); } } }\n\n  function renderSafe() {');
}

writeFileSync(file, s, 'utf8');
console.log('patched', s.includes('function renderSafe()') ? 'with guard' : 'without guard');
