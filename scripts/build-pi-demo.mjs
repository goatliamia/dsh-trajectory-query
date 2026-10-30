import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createPiSample, PI_SOURCE_REVISION } from '../analyzers/pi-sample.mjs';
import { adaptPiSession } from '../analyzers/pi-adapter.mjs';
import { readPiSession } from '../analyzers/pi-reader.mjs';
import { writeHostTracePage } from './host-trace-page.mjs';

const args = process.argv.slice(2), option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
let input;
if (option('--session')) {
  input = await readPiSession(option('--session'), { leafId: option('--leaf'), captureFile: option('--capture'), synthetic: args.includes('--synthetic') });
} else {
  const sourceRoot = option('--source') || 'D:/projects/new loop/pi', revision = option('--revision') || PI_SOURCE_REVISION;
  const git = (...command) => execFileSync('git', ['-C', sourceRoot, ...command], { encoding: 'utf8', windowsHide: true });
  const readSource = path => git('show', revision + ':' + path);
  const paths = ['packages/agent/src/types.ts', 'packages/agent/src/agent-loop.ts', 'packages/ai/src/types.ts', 'packages/coding-agent/src/core/session-manager.ts', 'packages/coding-agent/src/core/agent-session.ts', 'packages/coding-agent/src/core/system-prompt.ts', 'packages/coding-agent/src/core/skills.ts', 'packages/coding-agent/src/core/tools/read.ts', 'packages/coding-agent/src/core/tools/edit.ts', 'packages/coding-agent/src/core/tools/write.ts', 'packages/coding-agent/README.md'];
  input = createPiSample({ repository: git('remote', 'get-url', 'origin').trim(), localPath: sourceRoot, revision: git('rev-parse', revision).trim(), version: JSON.parse(readSource('packages/coding-agent/package.json')).version, refUpdatedAt: git('show', '-s', '--format=%cI', revision).trim(), originalHead: git('rev-parse', 'HEAD').trim(), originalWorktreeStatus: git('status', '--short').trim(), updateMode: 'Read-only pinned revision; original worktree preserved', files: paths.map(path => ({ path, sha256: createHash('sha256').update(readSource(path)).digest('hex') })) });
}
const payload = adaptPiSession(input), out = resolve('.dsh/pi-review'); mkdirSync(out, { recursive: true });
if (input.synthetic) {
  writeFileSync(resolve(out, 'sample.json'), JSON.stringify(input, null, 2));
  writeFileSync(resolve(out, 'synthetic-session.jsonl'), [input.header, ...input.entries].map(JSON.stringify).join('\n') + '\n');
  writeFileSync(resolve(out, 'synthetic-events.jsonl'), input.capture.map(JSON.stringify).join('\n') + '\n');
}
writeFileSync(resolve(out, 'source-evidence.json'), JSON.stringify(input.source, null, 2));
writeFileSync(resolve(out, 'graph-data.json'), JSON.stringify(payload));
const result = writeHostTracePage(payload, option('--out') || resolve(out, 'current-thread.html'));
console.log(JSON.stringify({ ...result, ...payload.sessions[0].totals, files: payload.context.fileOperations.length, skills: payload.context.skillEvents.length }));
