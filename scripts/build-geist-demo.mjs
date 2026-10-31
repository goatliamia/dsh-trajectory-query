import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { visualTokenCss } from '../design/tokens.mjs';
const root = resolve('docs/demo/layout-review');
// Start from the page build-preserved-demo just produced, not from the 10/28 snapshot:
// otherwise fixes to preserved.js / context-layer.js never reach this page.
const base = resolve('.dsh/layout-review/preserved.html');
let page = readFileSync(base, 'utf8');
const dataMatch = page.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/);
const payload = JSON.parse(dataMatch[1]);
const officialStats = JSON.parse(readFileSync(resolve('.dsh/layout-review/official-stats.json'), 'utf8'));
if (officialStats.session !== payload.mainSession) throw new Error('Official stats session mismatch');
payload.officialStats = officialStats;
const currentContext = JSON.parse(readFileSync(resolve('.dsh/layout-review/context-data.json'), 'utf8'));
if (currentContext.session !== payload.mainSession || currentContext.cutoffSeq !== officialStats.cutoffSeq) throw new Error('Context snapshot cutoff mismatch');
payload.context.current = currentContext.current;
payload.context.route = currentContext.route;
const actors = JSON.parse(readFileSync(resolve('.dsh/layout-review/actor-data.json'), 'utf8'));
if (actors.session !== payload.mainSession || actors.cutoffSeq !== officialStats.cutoffSeq) throw new Error('Actor snapshot cutoff mismatch');
payload.context.skillEvents = actors.skillEvents;
payload.context.skillAnalysis = actors.skillAnalysis;
payload.context.agentBranches = actors.agentBranches;
const encodedPayload = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
page = page.replace(dataMatch[0], () => '<script id="trace-data" type="application/json">' + encodedPayload + '</script>');
// preserved.html is built from the current demo sources, so the renderer files are already
// swapped in; only the Geist-only seams below still need patching.
if (!page.includes('right=scroll+vw-gutter,base=232;') || !page.includes('const mainH=Math.max(420,bottom+72)')) throw new Error('Overview geometry seam changed');
page = page.replace('right=scroll+vw-gutter,base=232;', 'right=scroll+vw-gutter,base=(geistOverviewFrame=geistOverviewGeometry()).base;');
page = page.replace('const mainH=Math.max(420,bottom+72)', 'const mainH=Math.max(geistOverviewFrame.height,bottom+72)');
const gestureStart = page.indexOf('  function bindOverviewViewport(){');
const gestureEnd = page.indexOf('  const preciseTime=', gestureStart);
if (gestureStart < 0 || gestureEnd < 0) throw new Error('Frozen gesture seam changed');
page = page.slice(0, gestureStart) + readFileSync(resolve(root, 'geist-navigation.js'), 'utf8') + '\n' + page.slice(gestureEnd);
const seam = "  $('review-return').onclick=reviewReturnOverview;";
if (!page.includes(seam)) throw new Error('Frozen renderer boot seam changed');
page = page.replace(/<title>[^<]*<\/title>/, '<title>执行路径 · Geist 视觉试作</title>');
page = page.replace('<body>', '<body class="geist-review">');
page = page.replace('</head>', '<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin><style>' + readFileSync(resolve(root, 'geist.css'), 'utf8') + readFileSync(resolve(root, 'actors.css'), 'utf8') + readFileSync(resolve(root, 'geist-progressive.css'), 'utf8') + '</style></head>');
page = page.replace(seam, () => ['tool-result-model.mjs', 'context-overview-model.mjs', 'actor-model.mjs'].map(name => readFileSync(resolve(root, name), 'utf8').replaceAll('export function ', 'function ')).join('\n') + '\n' + ['geist-step.js', 'geist-selection.js', 'geist-file-history.js', 'geist-context-overview.js', 'geist-layout.js', 'geist.js', 'geist-tools.js', 'geist-actors.js', 'geist-materials.js', 'geist-skill-evidence.js', 'geist-persist.js', 'geist-chat-jump.js', 'geist-progressive.js', 'geist-updates.js'].map(name => readFileSync(resolve(root, name), 'utf8')).join('\n') + '\n' + seam);
page = page.replace('<strong>执行路径</strong><small id="review-state">', '<strong>执行路径</strong><span class="geist-edition">02</span><small id="review-state">');
page = page.replace('<a href="/baseline" target="_blank">安装版原图 ↗</a>', '<a href="/versions/files-v1" target="_blank" rel="noopener" class="geist-previous" title="打开已固定的文件层版本">上一版 ↗</a>');
// Visual defaults and interaction fixes share the frozen event data and branch geometry.
page = page.replace("overviewLayers.add('context');", "overviewLayers.add('context'); overviewLayers.add('files');");
for (const script of page.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
page=page.replace('</head>','<style>@media not (prefers-color-scheme: dark){'+visualTokenCss({legacyAliases:true})+'}</style></head>');
writeFileSync(resolve('.dsh/layout-review/geist.html'), page);
console.log('Built Geist study from frozen files-v1; original checkpoint unchanged.');
