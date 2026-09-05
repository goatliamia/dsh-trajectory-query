// Load a persisted DSH session artifact into typed events for analyzers.
// Reuses decode from experiments/corpus/decode-session.mjs (multi-frame zstd).
import { readFileSync } from 'node:fs';
import { decodeZstdSession } from '../experiments/corpus/decode-session.mjs';

export function loadSession(file) {
  const buf = decodeZstdSession(readFileSync(file));
  const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
  const events = [];
  let id = null;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'session') { id = o.id; continue; }
    if (typeof o.seq !== 'number') continue; // packed rows / partial writes: skipped
    events.push(o);
  }
  events.sort((a, b) => a.seq - b.seq);
  return { id, file, events };
}
