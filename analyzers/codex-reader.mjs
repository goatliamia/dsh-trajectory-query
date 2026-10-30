import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const unsupported = error => error?.code === -32601 || error?.code === -32602 && /unsupported|not support|pagination|itemsView/i.test(error.message);
export async function readCodexHistory(rpc, threadId) {
  const { thread } = await rpc('thread/read', { threadId });
  if (thread.id !== threadId) throw Error('Codex returned another thread');
  if (thread.historyMode !== 'paginated') {
    const full = await rpc('thread/read', { threadId, includeTurns: true });
    return { capturedAt: new Date().toISOString(), source: 'Codex App Server · thread/read (legacy history)', thread: full.thread };
  }
  async function pages(method, params) {
    const data = [], seen = new Set(); let cursor;
    do {
      const page = await rpc(method, { threadId, limit: 100, sortDirection: 'asc', ...params, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page.data)) throw Error('Invalid Codex history page');
      data.push(...page.data); cursor = page.nextCursor;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw Error('Codex pagination did not advance');
      if (cursor) seen.add(cursor);
      if (seen.size > 10000) throw Error('Codex history exceeds page budget');
    } while (cursor);
    return data;
  }
  let turns, mode;
  try {
    turns = await pages('thread/turns/list', { itemsView: 'notLoaded' });
    const items = await pages('thread/items/list', {}), byTurn = new Map(turns.map(t => [t.id, new Map()]));
    for (const row of items) {
      const bucket = byTurn.get(row.turnId);
      if (!bucket) throw Error('Thread changed while reading history; retry the read');
      bucket.set(row.item.id, row.item);
    }
    turns = turns.map(t => ({ ...t, itemsView: 'full', items: [...byTurn.get(t.id).values()] }));
    mode = 'thread/read + thread/turns/list + thread/items/list';
  } catch (error) {
    if (!unsupported(error)) throw error;
    turns = await pages('thread/turns/list', { itemsView: 'full' });
    mode = 'thread/read + thread/turns/list (item pagination unavailable)';
  }
  return { capturedAt: new Date().toISOString(), source: 'Codex App Server · ' + mode, consistency: 'paginated read; not an atomic runtime snapshot', thread: { ...thread, turns: [...new Map(turns.map(t => [t.id, t])).values()] } };
}

// Read-only App Server client. Never starts/resumes/steers a thread.
async function withCodexReader(run, options = {}) {
  options.signal?.throwIfAborted();
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
    if (options.signal?.aborted) { reject(options.signal.reason || new Error('Codex read cancelled')); return; }
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out reading ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const abort = () => { fail(options.signal.reason || new Error('Codex read cancelled')); child.kill(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await rpc('initialize', { clientInfo: { name: 'trace_review_readonly', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return await run(rpc);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    child.stdin.end(); lines.close();
    const kill = setTimeout(() => child.kill(), 2000); kill.unref(); child.once('exit', () => clearTimeout(kill));
  }
}
export async function readCodexThread(threadId, options = {}) {
  if (!threadId || typeof threadId !== 'string') throw new Error('An explicit thread ID or CODEX_THREAD_ID is required');
  return withCodexReader(rpc => readCodexHistory(rpc, threadId), options);
}
export async function listCodexThreads({ cwd = process.cwd(), query, cursor, limit = 10, signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw Error('Session list limit must be 1..20');
  return withCodexReader(async rpc => {
    const page = await rpc('thread/list', { cwd, limit, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true, ...(query ? { searchTerm: query } : {}), ...(cursor ? { cursor } : {}) });
    return { sessions: page.data.map(t => ({ session: t.id, host: 'codex', title: t.name || t.preview?.slice(0, 180), cwd: t.cwd, updatedAt: t.updatedAt, parent: t.parentThreadId })), ...(page.nextCursor ? { cursor: page.nextCursor } : {}), scope: 'Codex indexed metadata for the specified cwd; no rollout scan/repair' };
  }, { signal });
}
