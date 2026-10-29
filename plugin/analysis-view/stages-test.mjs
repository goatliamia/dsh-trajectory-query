import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { apply } from './lib/index.js';
import { buildTracePayload } from './lib/trace-build.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const childGate = deferred(), childStarted = deferred();
const event = (type, seq, data) => ({ type, seq, time: 1000 + seq, data });
const argumentsText = JSON.stringify({ command: 'x'.repeat(1900), file_path: 'D:/demo.txt' });
const rows = [
  event('turn/start', 0, { turn: 1 }), event('user/message', 1, { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'Please inspect this.' }] }),
  event('step/start', 2, { turn: 1, step: 1 }), event('tool/call', 3, { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: argumentsText }),
  event('tool/result', 4, { turn: 1, step: 1, callId: 'c1', message: { toolCallId: 'c1', content: [{ type: 'text', text: 'result '.repeat(300) }] } }),
  event('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Read the result.' }] } }),
  event('step/end', 6, { turn: 1, step: 1 }), event('turn/end', 7, { turn: 1 }), event('subagent/catalog', 8, { childId: 'child' }),
];
const revisions = new Map([['main', 'r1'], ['child', 'c1']]);
let handler, mainReads = 0, childReads = 0, leases = 0;
const services = {
  sessions: new Map(),
  sessionPersistence: { async stat(id) { return revisions.has(id) ? { revision: revisions.get(id) } : undefined; } },
  sessionQuery: { async observeSession(id) {
    if (id === 'child') { childReads++; childStarted.resolve(); assert.ok(leases > 0); await childGate.promise; }
    else { mainReads++; leases++; }
    return { events: rows.filter(e => e.type !== 'subagent/catalog' || id === 'main'), revision: revisions.get(id), source: 'prepared',
      [Symbol.dispose]() { if (id === 'main') leases--; } };
  } },
  webServer: { register(route) { handler = route.handler; return () => {}; } },
};
apply({ get: name => services[name], effect: fn => fn() });
const server = http.createServer((req, res) => handler(req, res));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const get = query => fetch(origin + '/analysis-view/' + query);
try {
  const shell = await (await get('trace?staged=1&session=main')).text();
  assert.ok(shell.includes('trace-pending'));
  assert.ok(shell.includes('正在读取主干'));
  assert.equal(shell.includes('<div id="trace-loading"'), false, 'the actual page is the loading surface');
  assert.equal(mainReads, 0, 'the visible shell does not wait for or start a log replay');
  const query = 'trace-data?session=main&stage=';
  const [core, same] = await Promise.all([get(query + 'core').then(r => r.json()), get(query + 'core').then(r => r.json())]);
  assert.equal(core.cut, same.cut);
  assert.equal(mainReads, 1, 'all stages and concurrent core requests share one main observation');
  assert.ok(core.payload.sessions[0].turns[0].steps[0].calls[0].args.text.length <= 96);
  const actorResponse = get(query + 'actors&cut=' + core.cut);
  await childStarted.promise;
  const detailResponse = await get(query + 'details&cut=' + core.cut);
  const detail = await detailResponse.json();
  assert.equal(leases, 1, 'the main observation stays pinned while a child is pending');
  assert.equal(childReads, 1);
  const expected = JSON.parse(JSON.stringify(buildTracePayload(rows, 'main').sessions[0].turns[0]));
  assert.deepEqual(detail.payload.sessions[0].turns[0], expected, 'eager details retain all original parameters/results/replies');
  const turn = await (await get(query + 'turn&turn=1&cut=' + core.cut)).json();
  assert.deepEqual(turn.payload.sessions[0].turns[0], expected, 'priority detail works before any child has finished');
  assert.equal(mainReads, 1);
  assert.equal((await get(query + 'turn&turn=999&cut=' + core.cut)).status, 404);
  assert.equal((await get('trace-data?session=other&stage=details&cut=' + core.cut)).status, 409, 'cuts cannot be used for another session');
  assert.equal((await get(query + 'details&cut=expired')).status, 409);
  console.log('PASS immediate shell, shared main cut, independent core/details, complete eager bodies and priority turn reads');
  childGate.resolve();
  const actors = await (await actorResponse).json();
  assert.equal(actors.payload.context.agentBranches[0].steps.length, 1);
  assert.equal(leases, 0);
  const metadata = await (await get('trace-version?staged=1&session=main')).json();
  assert.equal(metadata.version, actors.payload.traceVersion);
  const cached = await (await get(query + 'core')).json();
  assert.equal(cached.cut, core.cut);
  assert.equal(mainReads, 1);
  revisions.set('child', 'c2');
  assert.equal((await (await get('trace-version?staged=1&session=main')).json()).version, null);
  const next = await (await get(query + 'core')).json();
  assert.notEqual(next.cut, core.cut);
  assert.equal(mainReads, 2);
  assert.equal((await get(query + 'details&cut=' + core.cut)).status, 200, 'an older captured cut remains consistent while a newer cut loads');
  await (await get(query + 'actors&cut=' + next.cut)).arrayBuffer();
  assert.equal(leases, 0);
  console.log('PASS child revision invalidation, stable captured cuts, metadata revalidation and lease cleanup');
} finally { childGate.resolve(); await new Promise(r => server.close(r)); }

// Exercise real bridge delivery ordering without a browser or a timing race.
// In particular, an empty core must never erase official detail received first.
const bridge = readFileSync(new URL('../../docs/demo/layout-review/trace-bridge.js', import.meta.url), 'utf8');
for (const early of [true, false]) {
  const coreGate = deferred(), detailGate = deferred(), actorGate = deferred(), turnGate = deferred();
  const handlers = new Map(), frames = [], calls = [], announcements = [];
  const parent = { postMessage: value => announcements.push(value) }, origin = 'http://localhost';
  const element = { textContent: JSON.stringify({ traceLoad: { sessionId: 's' } }) };
  const sandbox = { URLSearchParams, performance, AbortController, DOMException, location: { origin }, requestAnimationFrame: fn => frames.push(fn), setTimeout() {},
    document: { getElementById: id => id === 'trace-data' ? element : { querySelectorAll: () => [] }, body: { classList: { remove() {} } } },
    fetch: async url => {
      const stage = new URL(url, origin).searchParams.get('stage'); calls.push(stage);
      const value = await ({ core: coreGate, details: detailGate, actors: actorGate, turn: turnGate }[stage]).promise;
      return { ok: true, json: async () => ({ sessionId: 's', cut: 'cut1', payload: value }) };
    },
  };
  const mergePatch = patch => {
    const data = sandbox.window.__geistPayload;
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) data[key] = { ...data[key], ...value };
      else data[key] = value;
    }
  };
  const bootCounts = [];
  sandbox.window = { parent, addEventListener: (type, fn) => handlers.set(type, fn),
    __geistBoot: () => bootCounts.push(sandbox.window.__geistPayload.context.requests.length),
    __geistUpdate: (patch, options) => { mergePatch(patch); if (options.stage && options.stage !== 'turn') sandbox.window.__geistPayload.traceStage[options.stage] = 'ready'; },
  };
  const message = (sessionId = 's') => handlers.get('message')({ origin, source: parent,
    data: { type: 'analysis-trace-data', sessionId, payload: { context: { requests: [{ seq: 1, turn: 1, total: 120 }] }, traceStatus: { context: 'ready' } } } });
  const flush = async () => { await new Promise(r => setImmediate(r)); while (frames.length) frames.shift()(); await new Promise(r => setImmediate(r)); };
  vm.runInNewContext(bridge, sandbox);
  assert.equal(bootCounts.length, 1, 'actual page chrome is available before the log');
  if (early) message();
  message('another-session');
  coreGate.resolve({ mainSession: 's', sessions: [], context: { requests: [] }, traceVersion: 'core' });
  await flush();
  assert.deepEqual(bootCounts, [0]);
  assert.ok(calls.includes('details') && calls.includes('actors'), 'all detail stages prefetch without a user click');
  if (!early) message();
  const priority = sandbox.window.__traceEnsureTurn(1);
  turnGate.resolve({ sessions: [{ id: 's', turns: [{ number: 1, parameters: argumentsText }] }] });
  await priority;
  assert.equal(sandbox.window.__traceTurnReady(1), true);
  assert.equal(sandbox.window.__geistPayload.traceStage.details, 'loading');
  detailGate.resolve({ context: { requests: [], callFacts: {} } });
  actorGate.resolve({ context: { agentBranches: [] }, traceVersion: 'final' });
  await flush();
  assert.equal(sandbox.window.__geistPayload.context.requests.length, 1, 'later core/detail updates retain the official request records');
  assert.equal(sandbox.window.__geistPayload.traceVersion, 'final');
  assert.equal(announcements.at(-1).version, 'final');
  assert.equal(bootCounts.length, 1, 'enrichment never restarts the renderer');
}
console.log('PASS early/late official detail, cross-session isolation, eager prefetch, priority turns and single renderer boot');

// A restored old window must feed both the overview and action-step lookup.
// Retries in the same step keep the original first-request selection semantics.
const contextLayer = readFileSync(new URL('../../docs/demo/layout-review/context-layer.js', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../../docs/demo/layout-review/review-navigation.js', import.meta.url), 'utf8');
const indexFunction = contextLayer.slice(contextLayer.indexOf('  function reviewIndexContextSteps'), contextLayer.indexOf('  let reviewContextStepIndex'));
const stepFunction = navigation.slice(navigation.indexOf('  function reviewStepContext'), navigation.indexOf('  const reviewActionScales'));
const indexSteps = vm.runInNewContext(indexFunction + '\nreviewIndexContextSteps');
const indexedRows = [{ turn: 1, step: 1 }, { turn: 1, step: 1 }, { turn: 2, step: 1 }, { turn: 3, step: 1 }];
const stepSandbox = { reviewContextRequests: [{ seq: 0, turn: 1, step: 1, system: 10 }, { seq: 1, turn: 1, step: 1, system: 15 },
  { seq: 2, turn: 2, step: 1, system: 20 }, { seq: 3, turn: 3, step: 1, system: 30 }],
  reviewContextStepIndex: indexSteps(indexedRows), CONTEXT_CATEGORIES: [{ key: 'system' }] };
const readStep = vm.runInNewContext(stepFunction + '\nreviewStepContext', stepSandbox);
assert.equal(readStep({ number: 1 }, { number: 1 }).current.seq, 0);
assert.equal(readStep({ number: 2 }, { number: 1 }).amount, 5);
assert.equal(readStep({ number: 3 }, { number: 1 }).amount, 10);
assert.equal(readStep({ number: 4 }, { number: 1 }), null);
console.log('PASS restored history feeds action steps, preserving retry selection and cross-window deltas');
