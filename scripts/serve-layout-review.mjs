import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('docs/demo/layout-review'), data = resolve('.dsh/layout-review');
const files = new Map([
  ['/', resolve(data, 'preserved.html')], ['/index.html', resolve(data, 'preserved.html')],
  ['/style.css', resolve(root, 'style.css')], ['/app.js', resolve(root, 'app.js')],
  ['/layout.mjs', resolve(root, 'layout.mjs')], ['/data.json', resolve(data, 'data.json')],
  ['/baseline', resolve(data, 'installed-trace.html')],
  ['/geist', resolve(data, 'geist.html')],
  ['/codex', resolve('.dsh/codex-review/current-thread.html')],
  ['/pi', resolve('.dsh/pi-review/current-thread.html')],
  ['/skills', resolve('.dsh/skill-review/index.html')],
  ['/versions/files-v1', resolve(data, 'checkpoints/2026-10-28-files-v1/preserved.html')],
  ['/fonts/Geist-Variable.woff2', resolve(root, 'fonts/Geist-Variable.woff2')],
  ['/fonts/GeistMono-Variable.woff2', resolve(root, 'fonts/GeistMono-Variable.woff2')],
]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const path = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!path || req.method !== 'GET') { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': (types[extname(path)] || 'text/plain') + '; charset=utf-8', 'cache-control': 'no-store' }); res.end(await readFile(path)); }
  catch { res.writeHead(500).end('Preview asset unavailable'); }
});
server.listen(Number(process.argv[2] || 0), '127.0.0.1', () => console.log('Layout preview: http://127.0.0.1:' + server.address().port + '/'));
