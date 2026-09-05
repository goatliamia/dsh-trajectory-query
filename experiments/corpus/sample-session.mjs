// Debug one session file: decompress, print byte/char length and first lines, infer record shape.
// Usage: node sample-session.mjs <file>
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const file = process.argv[2];
const buf = zstdDecompressSync(readFileSync(file));
console.log('decompressed bytes:', buf.length);
const text = buf.toString('utf8');
console.log('chars:', text.length);
const lines = text.split('\n').filter((l) => l.trim());
console.log('lines:', lines.length);
console.log('---- first 3 lines (truncated 600 each) ----');
for (const l of lines.slice(0, 3)) console.log(l.slice(0, 600));
console.log('---- key shape of first 5 non-header lines ----');
for (const l of lines.slice(1, 6)) {
  try { const o = JSON.parse(l); console.log('keys:', Object.keys(o), '| type:', o.type ?? o.t, '| has seq:', 'seq' in o, '| has s:', 's' in o); }
  catch (e) { console.log('unparseable line:', l.slice(0, 200)); }
}
