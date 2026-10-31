import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Explicit file only. Never infer the active session from modification time.
export async function readClaudeTranscript(file, { signal, maxBytes = 128 * 1024 * 1024 } = {}) {
  if (!file) throw Error('Claude requires an explicit transcript file');
  const path = resolve(file); signal?.throwIfAborted();
  if ((await stat(path)).size > maxBytes) throw Error('Claude transcript exceeds input budget');
  const bytes = await readFile(path, { signal });
  if (bytes.length > maxBytes) throw Error('Claude transcript exceeds input budget');
  const input = bytes.toString('utf8'), lines = input.split(/\r?\n/), rows = [];
  let incompleteTail = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { rows.push({ ...JSON.parse(lines[i]), __trajectoryLine: i + 1 }); }
    catch { if (i === lines.length - 1 && !input.endsWith('\n')) incompleteTail = true; else throw Error('Invalid Claude JSON at line ' + (i + 1)); }
  }
  const ids = new Set(rows.map(r => r.sessionId).filter(Boolean));
  if (ids.size !== 1) throw Error('Claude transcript must identify exactly one session');
  return { rows, sessionId: [...ids][0], source: { name: 'Claude Code local transcript', file: path, sha256: createHash('sha256').update(bytes).digest('hex'), incompleteTail }, capturedAt: new Date().toISOString() };
}
