// Regression checks for cache freshness, shared work, lease lifetime, partial
// child failures and unchanged Skill evidence. No live DSH server is required.
import assert from "node:assert/strict";
import http from "node:http";
import { apply } from "./lib/index.js";
import { TraceCache, traceSource, observationSource } from "./lib/trace-cache.js";
import { buildTracePayload } from "./lib/trace-build.js";
import { traceActors } from "./lib/trace-context.js";
import { replaySkillEvidence } from "./lib/trace-skill-evidence.js";
import { replaySkillEvidence as referenceReplay } from "../../analyzers/dsh-skill-evidence.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const sessions = new Map(), revisions = new Map([["main", "r1"], ["child", "c1"]]);
let persistence = { async stat(id) { return revisions.has(id) ? { revision: revisions.get(id) } : undefined; } };
const ctx = { get: name => name === "sessions" ? sessions : name === "sessionPersistence" ? persistence : undefined };
const source = await traceSource(ctx, "main");
const child = await traceSource(ctx, "child");
const entry = () => ({ source, assets: "assets1", children: new Map([["child", child]]), retryAt: Infinity });
const cache = new TraceCache(ctx, 2);
await cache.build("main", source, "assets1", async () => entry());
assert.ok(await cache.get("main", source, "assets1"));
assert.equal(await cache.get("main", source, "assets2"), undefined, "renderer changes invalidate cached HTML");
revisions.set("child", "c2");
assert.equal(await cache.get("main", source, "assets1"), undefined, "child-only changes invalidate the parent page");
revisions.set("child", "c1");
const oldPersistence = persistence;
persistence = { ...persistence };
assert.equal(await cache.get("main", await traceSource(ctx, "main"), "assets1"), undefined, "backend replacement invalidates revisions");
persistence = oldPersistence;
sessions.set("main", { seq: 9 });
const live = await traceSource(ctx, "main");
assert.equal(live.revision, "live:9");
assert.equal(observationSource(ctx, { source: "live", cursor: 7 }, live).revision, "live:8", "version the captured cut, not a later live seq");
sessions.clear();
const gate = deferred();
let builds = 0;
const build = () => { builds++; return gate.promise; };
const first = cache.build("shared", source, "assets1", build);
const second = cache.build("shared", source, "assets1", build);
gate.resolve(entry());
assert.equal(await first, await second);
assert.equal(builds, 1, "simultaneous requests share one build");
const older = deferred(), newer = { ...source, revision: "r2" };
const oldJob = cache.build("racing", source, "assets1", () => older.promise);
const newest = { ...entry(), source: newer };
await cache.build("racing", newer, "assets1", async () => newest);
older.resolve(entry()); await oldJob;
assert.equal(await cache.get("racing", newer, "assets1"), newest, "late old builds cannot overwrite a newer cut");
console.log("PASS revision, assets, child freshness, backend identity, coalescing and out-of-order cache builds");

const rawServices = { sessions, sessionPersistence: persistence };
const boundContext = { get(name) {
  const original = rawServices[name];
  return original && new Proxy(original, { get(target, key) {
    if (key === Symbol.for("cordis.original")) return target;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
} };
const boundCache = new TraceCache(boundContext);
const boundSource = await traceSource(boundContext, "main");
await boundCache.build("main", boundSource, "a", async () => ({
  source: observationSource(boundContext, { source: "prepared", revision: "r1" }, null),
  assets: "a", retryAt: Infinity,
  children: new Map([["child", await traceSource(boundContext, "child")]]),
}));
assert.ok(await boundCache.get("main", await traceSource(boundContext, "main"), "a"), "fresh Cordis proxies must identify the same parent and child backend");
console.log("PASS Cordis context-bound service proxies preserve cache identity");

const event = (type, seq, data = {}, surfaceOp) => ({ type, seq, time: 1000 + seq, data, ...(surfaceOp ? { surfaceOp } : {}) });
const body = "Use read for evidence.";
const skillEvents = [
  event("request/header", 0, { header: { tools: [{ name: "read" }] } }),
  event("tool/result", 1, { turn: 1, message: { content: [{ type: "text", text: body }] } }, "append"),
  event("request/header", 2),
  event("assistant/message", 3, { turn: 1, step: 1, message: { content: [{ type: "text", text: "testing demo-skill" }] } }, "append"),
  event("test/project", 4, { target: 1, text: "body removed" }),
  event("test/project", 5, { target: 1, text: body }),
  event("request/header", 6),
  event("tool/result", 7, { turn: 1, message: { content: [{ type: "text", text: "summary" }] } }, { op: "replace" }),
];
class Surface {
  constructor(log) { this.log = log; this.seen = 0; this.rows = []; this.replaceGeneration = 0; this.contentGeneration = 0; this.messages = new Map(); }
  get nodes() {
    while (this.seen < this.log.length) {
      const e = this.log[this.seen++];
      if (e.surfaceOp === "append") this.rows.push(e.seq);
      else if (e.surfaceOp?.op === "replace") { this.rows = [e.seq]; this.replaceGeneration++; }
      if (e.type === "test/project") { this.messages.set(e.data.target, { content: [{ type: "text", text: e.data.text }] }); this.contentGeneration++; }
    }
    return this.rows;
  }
  deriveEventMessage(e) { return this.messages.get(e.seq) || e.data.message; }
}
const loads = [{ id: "skill-1", name: "demo-skill", seq: 1, resultSeq: 1, turn: 1 }];
assert.deepEqual(replaySkillEvidence(skillEvents, loads, [0, 2, 6], Surface), referenceReplay(skillEvents, loads, [0, 2, 6], Surface));
assert.deepEqual(replaySkillEvidence(skillEvents, [], [], class { constructor() { throw new Error("unneeded replay"); } }).records, []);
console.log("PASS Skill body load, request counts, content projections, restoration and replacement match the full replay");

const base = [
  event("turn/start", 0, { turn: 1 }), event("step/start", 1, { turn: 1, step: 1 }),
  event("assistant/message", 2, { turn: 1, step: 1, message: { content: [{ type: "text", text: "done" }] } }),
  event("step/end", 3, { turn: 1, step: 1 }), event("turn/end", 4, { turn: 1 }),
];
const catalogs = Array.from({ length: 7 }, (_, i) => event("subagent/catalog", 10 + i, { childId: "child-" + i }));
const mainEvents = [...base, ...catalogs];
const payload = buildTracePayload(mainEvents, "main");
const gates = Array.from({ length: 7 }, deferred);
let active = 0, maximum = 0, started = 0;
const actorJob = traceActors(mainEvents, payload, [], async id => {
  const index = Number(id.slice(6)); started++; active++; maximum = Math.max(maximum, active);
  await gates[index].promise; active--;
  if (index === 1) throw new Error("one unavailable child");
  return base;
});
await new Promise(r => setImmediate(r));
assert.equal(started, 3);
gates[2].resolve(); gates[1].resolve(); gates[0].resolve();
await new Promise(r => setImmediate(r));
for (const gate of gates) gate.resolve();
const actors = await actorJob;
assert.equal(maximum, 3);
assert.deepEqual(actors.agentBranches.map(b => b.id), catalogs.map(e => e.data.childId));
assert.equal(actors.agentBranches[1].steps.length, 0);
assert.equal(actors.agentBranches[6].steps.length, 1, "one read failure preserves other branches");
console.log("PASS bounded child concurrency, stable branch order and isolated failures");

let handler, reads = 0, pins = 0, disposed = 0;
const routeSessions = new Map();
const routeRevisions = new Map([["main", "r1"], ["child-0", "c1"]]);
const routeEvents = new Map([["main", [...base, catalogs[0]]], ["child-0", base]]);
const services = {
  sessions: routeSessions,
  sessionPersistence: { async stat(id) { return routeRevisions.has(id) ? { revision: routeRevisions.get(id) } : undefined; } },
  sessionQuery: { async observeSession(id) {
    reads++;
    if (id !== "main") assert.ok(pins > 0, "parent lease remains pinned while observing children");
    if (id === "main") pins++;
    return { source: "prepared", revision: routeRevisions.get(id), events: routeEvents.get(id), [Symbol.dispose]() { if (id === "main") pins--; disposed++; } };
  } },
  webServer: { register(route) { handler = route.handler; return () => {}; } },
};
apply({ get: name => services[name], effect: fn => fn() });
const server = http.createServer((req, res) => handler(req, res));
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  const get = (suffix = "trace", headers) => fetch(origin + "/analysis-view/" + suffix + "?session=main", { headers });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const etag = a.headers.get("etag");
  assert.equal(b.headers.get("etag"), etag);
  assert.equal(reads, 2, "one parent and one child observation serve both requests");
  const html = await a.text(); await b.arrayBuffer();
  const embedded = JSON.parse(html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal((await (await get("trace-version")).json()).version, embedded.traceVersion);
  assert.equal((await get("trace", { "if-none-match": etag })).status, 304);
  assert.equal(reads, 2, "conditional hits only stat metadata");
  assert.equal(pins, 0); assert.equal(disposed, 2);
  routeRevisions.set("child-0", "c2");
  assert.equal((await (await get("trace-version")).json()).version, null);
  const changed = await get("trace", { "if-none-match": etag });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get("etag"), etag); await changed.arrayBuffer();
  routeRevisions.delete("child-0");
  const before = reads;
  const missing = await get(); await missing.arrayBuffer();
  assert.equal(reads, before + 1, "a missing child is detected without a full observation");
  assert.equal(pins, 0);
  console.log("PASS HTTP ETag/304, concurrent gzip responses, metadata revalidation, pinned parent and missing child reads");
  routeRevisions.set("main", "r-timeout");
  routeRevisions.set("child-0", "c3");
  routeRevisions.set("child-slow", "s1");
  routeEvents.set("main", [...base, catalogs[0], event("subagent/catalog", 11, { childId: "child-slow" })]);
  const observe = services.sessionQuery.observeSession;
  let slowDisposed = false, aborted = false;
  services.sessionQuery.observeSession = async (id, options) => {
    if (id !== "child-slow") return observe(id, options);
    await new Promise(r => setTimeout(r, 1300)); // Deliberately ignores cancellation.
    aborted = options.signal.aborted;
    return { source: "prepared", revision: "s1", events: base, [Symbol.dispose]() { slowDisposed = true; } };
  };
  const partial = await (await get()).text();
  const partialData = JSON.parse(partial.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(partialData.context.agentBranches.length, 2);
  assert.equal(partialData.context.agentBranches[0].steps.length, 1);
  assert.equal(partialData.context.agentBranches[1].steps.length, 0);
  await new Promise(r => setTimeout(r, 180));
  assert.equal(aborted, true);
  assert.equal(slowDisposed, true, "even a late, non-cooperative observation must release its lease");
  assert.equal(pins, 0);
  console.log("PASS child timeout preserves completed branches, aborts the read and disposes late observations");
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
