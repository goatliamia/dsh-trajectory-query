import { readFileSync, writeFileSync } from 'node:fs';

const file = 'plugin/analysis-view/lib/trace/page.js';
let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const oldRestore = `    if(anchor){const p=overviewProjection,l=p.layout[anchor.index];viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
const newRestore = `    if(anchor){const p=overviewProjection;const l=p.layout.find(row=>row.index===anchor.index)||p.layout.find(row=>row.turn&&row.turn.number===anchor.turn);if(l)viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}`;
if (!s.includes(oldRestore)) throw new Error('restore line missing');
s = s.replace(oldRestore, newRestore);

const oldAnchor = `      if(segment)anchor={index:segment.index,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
const newAnchor = `      if(segment)anchor={index:segment.index,turn:segment.turn&&segment.turn.number,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};`;
if (!s.includes(oldAnchor)) throw new Error('anchor line missing');
s = s.replace(oldAnchor, newAnchor);

// 恢复书签时:锚点不在当前布局里就退回全览,别把整页渲染打断
const oldBookmark = `if (reviewOverviewBookmark) overviewScale = reviewOverviewBookmark.scale;`;
const newBookmark = `if (reviewOverviewBookmark && reviewOverviewBookmark.scale > 1) {
      overviewScale = reviewOverviewBookmark.scale;
      const bookmarkAnchor = reviewOverviewBookmark.anchor;
      if (bookmarkAnchor && overviewProjection && !overviewProjection.layout.some((row) => row.index === bookmarkAnchor.index || (row.turn && row.turn.number === bookmarkAnchor.turn))) {
        overviewScale = 1;
        reviewOverviewBookmark = null;
      }
    }`;
if (s.includes(oldBookmark)) s = s.replace(oldBookmark, newBookmark);

writeFileSync(file, s, 'utf8');
console.log('anchor restore hardened');
