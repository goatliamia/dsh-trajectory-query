import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';

// Assemble current shipped renderer + shared observations + host semantics.
// No dependency on a cached DSH conversation or its private stats snapshot.
export function writeHostTracePage(payload, output) {
  if (!['pi', 'codex'].includes(payload.host)) throw Error('Unsupported trace host');
  const template = readFileSync('plugin/analysis-view/lib/trace/page.html', 'utf8');
  let head = template.slice(0, template.indexOf('<script id="trace-data"')).replaceAll('/analysis-view/trace/fonts/', '/fonts/');
  for (;;) {
    const block = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*{/.exec(head); if (!block) break;
    let end = block.index + block[0].length, depth = 1;
    while (end < head.length && depth) { const char = head[end++]; if (char === '{') depth++; if (char === '}') depth--; }
    if (depth) throw Error('Unclosed theme media block'); head = head.slice(0, block.index) + head.slice(end);
  }
  const root = 'docs/demo/layout-review/', css = readFileSync(root + 'context-observation.css', 'utf8');
  const theme = readFileSync(root + 'geist.css', 'utf8').match(/:root\s*{([\s\S]*?)}/)[1];
  head = head.replace(/<title>[^<]*<\/title>/, '<title>' + (payload.host === 'pi' ? 'Pi' : 'Codex') + ' · 会话分析</title>')
    .replace('<body class="geist-review">', '<body class="geist-review context-trend-study ' + payload.host + '-review">')
    .replace('</head>', '<style>:root{' + theme + '}' + css + '</style></head>')
    .replace('<span class="geist-edition">02</span>', '<span class="geist-edition">' + (payload.host === 'pi' ? 'Pi' : 'Codex') + '</span>');
  if (payload.host === 'pi') head = head.replace('<strong>执行路径</strong>', '<strong>Pi · ' + (payload.synthetic ? '模拟会话' : '会话分析') + '</strong>');
  if (payload.synthetic) head = head.replace('<div class="app">', '<p role="note" style="font:11px var(--sans);color:var(--muted);padding:0 24px">全部内容、时长、用量与结果均为模拟；没有调用模型。</p><div class="app">');
  let renderer = readFileSync('plugin/analysis-view/lib/trace/page.js', 'utf8');
  const seam = "  $('review-return').onclick=reviewReturnOverview;";
  if (renderer.split(seam).length !== 2) throw Error('Trace boot seam changed');
  renderer = renderer.replace(seam, () => readFileSync(root + payload.host + '-host.js', 'utf8') + '\n' + readFileSync(root + 'context-observation.js', 'utf8') + '\n' + seam);
  new vm.Script(renderer);
  const encoded = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = head + '<script id="trace-data" type="application/json">' + encoded + '</script><script>' + renderer.replace(/<\/script/gi, '<\\/script') + '\nwindow.__geistPayload=JSON.parse(document.getElementById("trace-data").textContent);document.getElementById("trace-data").textContent="";window.__geistBoot();</script></body></html>';
  mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, html);
  return { output: resolve(output), bytes: Buffer.byteLength(html), host: payload.host, synthetic: !!payload.synthetic };
}
