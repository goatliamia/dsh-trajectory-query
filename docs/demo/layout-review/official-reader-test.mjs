import assert from 'node:assert/strict';
import { createOfficialReader } from './official-reader.mjs';
let snapshot = { turns: [{ turn: 1 }], stepCount: 1 }, state = { openState: 'open', loadingOlder: false, hasMore: true };
let loads = 0, finishPage;
const stats = { getSnapshot: () => snapshot, subscribe: () => () => {} }, trajectory = { getSnapshot: () => ({}) };
const opened = [], requests = [];
const ctx = {
  sessions: { binding: () => ({ session: { getSnapshot: () => state, loadOlder: () => { loads++; return new Promise(resolve => { finishPage = resolve; }); } } }) },
  uiConversation: { binding: () => ({ target: key => ({ stats, trajectory })[key] }) },
  sidebarRight: { openResource: (...args) => opened.push(args) },
};
let status = 200;
const summary = { turn: 1, total: 2, files: [{ path: 'large.bin', binary: true, added: 0, deleted: 0 }], added: 7, deleted: 9 };
const reader = createOfficialReader(ctx, 'session/a', async (url, options) => {
  requests.push({ url, options }); return { status, ok: status === 200, json: async () => summary };
});
assert.equal(reader.stats, stats, 'use the official observable instead of maintaining another fold or store');
assert.equal(reader.trajectory, trajectory);
const a = reader.loadOlder(), b = reader.loadOlder();
assert.equal(a, b); assert.equal(loads, 1);
snapshot = { turns: [{ turn: 0 }, { turn: 1 }], stepCount: 2 }; finishPage();
assert.equal(await a, 'grew');
state.loadingOlder = true; assert.equal(await reader.loadOlder(), 'retry');
state.loadingOlder = false; state.hasMore = false; assert.equal(await reader.loadOlder(), 'exhausted');
assert.equal(reader.changeSequence({ data: { get: key => key === 'deliverables' ? { changes: { seq: 99 } } : undefined } }), 99);
assert.equal(reader.changeSequence({ data: { get: () => undefined } }), undefined);
assert.equal(await reader.readFileChanges(99), summary);
assert.equal(requests.at(-1).url, 'api/changes.summary?sessionId=session%2Fa&seq=99');
assert.equal(requests.at(-1).options.credentials, 'same-origin');
await reader.readFileDiff(99, 2);
assert.equal(requests.at(-1).url, 'api/changes.diff?sessionId=session%2Fa&seq=99&index=2');
reader.openFileReview(99, 1, 2);
assert.deepEqual(opened[0], ['dsh-resource://changes-review/session/session%2Fa/99/1', { params: { index: 2 } }]);
status = 404; assert.equal(await reader.readFileChanges(99), undefined, 'expired summaries are unavailable, never zero-change summaries');
status = 500; await assert.rejects(reader.readFileChanges(99), /HTTP 500/);
assert.throws(() => reader.openFileReview(99, 0, 2), /Invalid turn/);
reader.dispose(); assert.equal(requests.at(-1).options.signal.aborted, true);
console.log('PASS official reader: shared targets, paging, native summary/diff/review coordinates and unavailable-state handling');
