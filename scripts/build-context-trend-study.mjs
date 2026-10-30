// Independent study: reuse the shipped visual language; keep private data local.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
import { requireStudySnapshot } from './context-study-snapshot.mjs';

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const savedSource = '.dsh/context-trend-study-source.html';
const source = resolve(option('--source') || (existsSync(savedSource) ? savedSource : '.dsh/layout-review/geist.html'));
const mainTarget = resolve('.dsh/context-trend-study');
const target = resolve(option('--out') || mainTarget);
const allowIncomplete = process.argv.includes('--allow-incomplete');
if (allowIncomplete && target.toLowerCase() === mainTarget.toLowerCase()) {
  throw Error('Incomplete performance fixtures require a separate --out; the main preview must stay complete');
}
const frozen = readFileSync(source, 'utf8');
const match = frozen.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw Error('Use a frozen trace page containing trace-data');
const payload = JSON.parse(match[1]);
const coverage = requireStudySnapshot(payload, { allowIncomplete });
const assets = resolve('docs/demo/layout-review');
mkdirSync(target, { recursive: true });
const template = readFileSync('plugin/analysis-view/lib/trace/page.html', 'utf8');
let head = template.slice(0, template.indexOf('<script id="trace-data"'));
// This standalone presentation is light; don't leave dark-only element styles
// active while showing the project's light tokens.
for (;;) {
  const block = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*{/.exec(head);
  if (!block) break;
  let end = block.index + block[0].length, depth = 1;
  while (end < head.length && depth) { const c = head[end++]; if (c === '{') depth++; if (c === '}') depth--; }
  if (depth) throw Error('Unclosed theme media block');
  head = head.slice(0, block.index) + head.slice(end);
}
const seam = "  $('review-return').onclick=reviewReturnOverview;";
let renderer = readFileSync('plugin/analysis-view/lib/trace/page.js', 'utf8');
if (renderer.split(seam).length !== 2) throw Error('Trace boot seam changed');
renderer = renderer.replace(seam, () => readFileSync('lib/context-trend-geometry.mjs', 'utf8').replaceAll('export function ', 'function ') + '\n' + readFileSync(join(assets, 'context-observation.js'), 'utf8') + '\n' + seam);
new vm.Script(renderer);
const encoded = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
// Show the project's light presentation, using its own canonical tokens.
const projectTheme = readFileSync('docs/demo/layout-review/geist.css', 'utf8').match(/:root\s*{([\s\S]*?)}/)[1];
const page = head.replace('<title>执行路径</title>', '<title>上下文趋势 · 独立试作</title>')
  .replace('</head>', '<style>:root{' + projectTheme + '}</style><link rel="stylesheet" href="/study.css"></head>')
  .replace('<body class="geist-review">', '<body class="geist-review context-trend-study">')
  .replace('<span class="geist-edition">02</span>', '<span class="geist-edition">趋势试作</span>')
  + '<script id="trace-data" type="application/json">' + encoded + '</script>\n'
  + '<script src="/renderer.js"></script>\n<script>window.__geistPayload=JSON.parse(document.getElementById("trace-data").textContent);document.getElementById("trace-data").textContent="";window.__geistBoot();</script></body></html>';
writeFileSync(join(target, 'index.html'), page);
writeFileSync(join(target, 'renderer.js'), renderer);
console.log(JSON.stringify({ output: target, source, ...coverage }));
