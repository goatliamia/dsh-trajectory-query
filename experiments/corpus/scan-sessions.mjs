// Scan persisted DSH session logs — stats by event count / compaction markers.
// Usage: node scan-sessions.mjs <sessionsRoot> [topN]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeZstdSession } from './decode-session.mjs';

const root = process.argv[2];
const topN = Number(process.argv[3] || 15);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.zstd')) yield p;
  }
}

const rows = [];
for (const file of walk(root)) {
  let buf;
  try { buf = decodeZstdSession(readFileSync(file)); } catch (e) { rows.push({ file, err: String(e).slice(0, 160) }); continue; }
  const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
  let sessionId = null, eventCount = 0, seqMin = Infinity, seqMax = -1, surfaceReplace = 0;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'session') { if (typeof o.id === 'string') sessionId = o.id; continue; }
    const seq = typeof o.seq === 'number' ? o.seq : null;
    if (seq !== null) { eventCount++; if (seq < seqMin) seqMin = seq; if (seq > seqMax) seqMax = seq; }
    if (o.type === 'assistant/message' && o.surfaceOp && typeof o.surfaceOp === 'object' && o.surfaceOp.op === 'replace') surfaceReplace++;
  }
  rows.push({ file, decompKB: Math.round(buf.length / 1024), eventCount, seqMin: seqMin === Infinity ? null : seqMin, seqMax, surfaceReplace, sessionId });
}
rows.sort((a, b) => (b.eventCount || 0) - (a.eventCount || 0));
console.log(JSON.stringify(rows.slice(0, topN), null, 2));
