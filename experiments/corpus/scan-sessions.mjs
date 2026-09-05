// DSH session-log scan utilities (MIT, adapted from @deepseek-ai/dsh-session-persistence-jsonl scanZstdFrames).
// Usage: node scan-sessions.mjs <sessionsRoot> [topN]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 4247762216; // 0x28B52FFD

/** Locate complete zstd frames without decompressing blocks (dsh algorithm). */
export function scanZstdFrames(buffer, maxFrames = Infinity) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

/** Decode a concatenated-frame session artifact to plaintext. */
export function decodeZstdSession(buf) {
  const { frames } = scanZstdFrames(buf);
  const parts = [];
  for (const f of frames) parts.push(zstdDecompressSync(buf.subarray(f.start, f.end)));
  return Buffer.concat(parts);
}

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
