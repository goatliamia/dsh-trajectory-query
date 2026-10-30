import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const files = new Map([
  ['/', resolve('.dsh/context-trend-study/index.html')],
  ['/renderer.js', resolve('.dsh/context-trend-study/renderer.js')],
  ['/study.css', resolve('docs/demo/layout-review/context-observation.css')],
  ...['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].flatMap(name => [
    ['/fonts/' + name, resolve('plugin/analysis-view/lib/trace/fonts', name)],
    ['/analysis-view/trace/fonts/' + name, resolve('plugin/analysis-view/lib/trace/fonts', name)],
  ]),
]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (req.method !== 'GET' || !file) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-store' }); res.end(readFileSync(file)); }
  catch { res.writeHead(500).end('Preview asset unavailable'); }
}).listen(Number(process.argv[2] || 3089), '127.0.0.1', function () { console.log('Context trend study: http://127.0.0.1:' + this.address().port + '/'); });
