// Extract semantic event lines from a DSH session artifact for oracle/key building.
// Text mapping mirrors dsh-session-query's semantic docs (user/assistant/tool messages).
// Usage: node extract-events.mjs <session.zstd> <out.txt>
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeZstdSession } from './scan-sessions.mjs';

function contentText(content) {
  if (!Array.isArray(content)) return '';
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') out.push(b.text.trim());
      else if (b.type === 'reasoning') { /* skip */ }
      else if (b.type === 'tool-call') out.push(String(b.name || ''), String(typeof b.arguments === 'string' ? b.arguments : JSON.stringify(b.arguments)));
      else if (b.type === 'tool-result') walk(b.content);
    }
  };
  walk(content);
  return out.filter(Boolean).join('\n');
}

const file = process.argv[2];
const outFile = process.argv[3];
const text = decodeZstdSession(readFileSync(file)).toString('utf8');
const out = [];
for (const raw of text.split('\n')) {
  if (!raw.trim()) continue;
  let o; try { o = JSON.parse(raw); } catch { continue; }
  if (!o || typeof o !== 'object' || o.type === 'session') continue;
  if (typeof o.seq !== 'number') continue;
  let t = '';
  const d = o.data;
  switch (o.type) {
    case 'user/message': t = contentText(d && d.content); break;
    case 'assistant/message': t = contentText(d && d.message && d.message.content); break;
    case 'tool/call': t = [d && d.name, typeof d && d.arguments === 'string' ? d.arguments : JSON.stringify(d && d.arguments)].filter(Boolean).join('\n'); break;
    case 'tool/result': t = [contentText(d && d.message && d.message.content), d && d.error && d.error.name, d && d.error && d.error.code].filter(Boolean).join('\n'); break;
    case 'todo/write': t = (d && d.todos || []).map((x) => [x && x.status, x && x.content].filter(Boolean).join(' ')).join('\n'); break;
    default: break;
  }
  if (t && t.trim()) out.push(`${o.seq}|${o.type}|${t.replace(/\n/g, '\\n')}`);
}
writeFileSync(outFile, out.join('\n'), 'utf8');
console.log(JSON.stringify({ lines: out.length, outFile }));
