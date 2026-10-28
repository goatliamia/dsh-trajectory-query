import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Read-only App Server client. Never starts/resumes/steers a thread.
export async function readCodexThread(threadId, options = {}) {
  if (!threadId || typeof threadId !== 'string') throw new Error('An explicit thread ID or CODEX_THREAD_ID is required');
  const npmEntry = join(process.env.APPDATA || '', 'npm/node_modules/@openai/codex/bin/codex.js');
  const executable = options.executable || (process.platform === 'win32' && existsSync(npmEntry) ? process.execPath : 'codex');
  const args = executable === process.execPath ? [npmEntry, 'app-server', '--stdio'] : ['app-server', '--stdio'];
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout }), pending = new Map();
  let nextId = 1;
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Codex App Server exited before completing the read')));
  child.stdin.on('error', fail);
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else item.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out reading ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'trace_review_readonly', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const { thread } = await rpc('thread/read', { threadId });
    if (thread.historyMode !== 'paginated') {
      const full = await rpc('thread/read', { threadId, includeTurns: true });
      return { capturedAt: new Date().toISOString(), source: 'Codex App Server · thread/read (legacy history)', thread: full.thread };
    }
    const turns = [], seen = new Set(); let cursor;
    do {
      const page = await rpc('thread/turns/list', { threadId, itemsView: 'full', limit: 30, sortDirection: 'asc', ...(cursor ? { cursor } : {}) });
      for (const turn of page.data) if (!seen.has(turn.id)) { seen.add(turn.id); turns.push(turn); }
      if (page.nextCursor === cursor && cursor) throw new Error('Thread pagination did not advance');
      cursor = page.nextCursor;
    } while (cursor);
    return { capturedAt: new Date().toISOString(), source: 'Codex App Server · thread/read + thread/turns/list', thread: { ...thread, turns } };
  } finally {
    child.stdin.end(); lines.close();
    const kill = setTimeout(() => child.kill(), 2000); kill.unref(); child.once('exit', () => clearTimeout(kill));
  }
}
