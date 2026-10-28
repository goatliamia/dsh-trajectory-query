import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCodexThread } from '../analyzers/codex-reader.mjs';

// Read-only capture followed by the common graph. No conversation mutations.
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const threadId = option('--thread') || process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
const out = resolve(option('--out') || '.dsh/codex-review/current-thread.html');
const snapshotPath = resolve(option('--snapshot') || '.dsh/codex-review/current-thread.json');
const snapshot = await readCodexThread(threadId);
await mkdir(dirname(snapshotPath), { recursive: true });
await writeFile(snapshotPath, JSON.stringify(snapshot));
execFileSync(process.execPath, ['scripts/build-codex-demo.mjs', '--snapshot', snapshotPath, '--out', out, ...(args.includes('--api-only') ? ['--api-only'] : [])], { cwd: resolve('.'), stdio: 'inherit', windowsHide: true, timeout: 30000 });
