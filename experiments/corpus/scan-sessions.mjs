// Scan persisted DSH session logs — stats by event count / compaction markers.
// Usage: node scan-sessions.mjs <sessionsRoot> [topN]
//
// DSH 0.1.5 起会话格式升级到 V3:迁移会在**原目录**里生成 session.v3.jsonl.zstd,
// 并保留迁移前的 session.v2.jsonl.zstd(旧副本、内容更少)。所以按目录归组,
// 每个目录只取版本号最高的那份日志,避免同一个会话被数两遍。
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decodeZstdSession } from './decode-session.mjs';

const root = process.argv[2];
const topN = Number(process.argv[3] || 15);

const LOG_RE = /^session(?:\.v(\d+))?\.jsonl\.zstd$/;

function* walkLogs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkLogs(p);
    else if (e.isFile() && LOG_RE.test(e.name)) yield p;
  }
}

/** 每个目录只保留版本号最高的日志;无版本号的 legacy 文件优先级最低。 */
function selectCurrent(files) {
  const byDir = new Map();
  for (const file of files) {
    const version = Number(LOG_RE.exec(basename(file))[1] ?? -1);
    const previous = byDir.get(dirname(file));
    if (previous === undefined || version > previous.version) byDir.set(dirname(file), { file, version });
  }
  return [...byDir.values()].map((entry) => entry.file).sort();
}

const rows = [];
for (const file of selectCurrent([...walkLogs(root)])) {
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
