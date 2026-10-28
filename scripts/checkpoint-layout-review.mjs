import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const workspace = resolve('.');
const root = resolve('.dsh/layout-review/checkpoints/2026-10-28-files-v1');
if (existsSync(root)) throw new Error('Checkpoint already exists; it is never overwritten.');
const sources = [];
function collect(dir) {
  for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else sources.push(file);
  }
}
collect('docs/demo/layout-review');
// files-v1 froze the plugin trace sources as they stood before the Geist study; they now live
// under docs/demo/layout-review/base and the plugin serves the derived page instead.
collect('docs/demo/layout-review/base');
sources.push('scripts/build-preserved-demo.mjs', 'scripts/build-context-review.mjs', 'scripts/serve-layout-review.mjs');
const records = [];
function snapshot(from, to) {
  const target = join(root, to), bytes = readFileSync(from);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
  records.push({ path: to.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const file of sources) snapshot(file, join('source', relative(workspace, resolve(file))));
for (const name of ['preserved.html', 'installed-trace.html', 'context-data.json']) snapshot(join('.dsh/layout-review', name), name);
writeFileSync(join(root, 'manifest.json'), JSON.stringify({
  version: 'files-v1', date: '2026-10-28', timezone: 'Asia/Shanghai',
  description: 'Frozen file-object prototype before the Geist visual study. Includes exact rendered data and source copies.',
  files: records,
}, null, 2));
console.log('Frozen files-v1: ' + records.length + ' files in ' + root);
