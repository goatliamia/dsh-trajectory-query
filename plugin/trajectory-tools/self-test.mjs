// dsh-trajectory-tools self-test — 不连真实会话:用假 ctx + 合成事件日志验证工具契约。
//
// 运行(必须能解析 @deepseek-ai/dsh-tools,即从安装后的包目录运行):
//   cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs
//
// 覆盖:注册 4 个工具、参数校验、字面量检索(大小写/空白)、seq 区间与类型过滤、
// 存活会话与已持久化会话两条读取路径、窗口上限、trace 两条分支、logId append-stable。

import { apply, eventText, fold, logIdOf, logIdentity } from "./lib/index.js";

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    return;
  }
  failures.push(name + (detail === undefined ? "" : " → " + detail));
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}

/* ---------------- 合成日志 ---------------- */
const LIVE_ID = "session-live-0001";
const PERSISTED_ID = "session-settled-0002";

const EVENTS = [
  { seq: 0, type: "turn/start", time: 1000, data: {} },
  { seq: 1, type: "user/message", time: 1001, data: { content: [{ type: "text", text: "Fix the SQL query" }] } },
  { seq: 2, type: "assistant/message", time: 1002, data: { message: { content: [{ type: "text", text: "Let me read the file" }] } } },
  { seq: 3, type: "tool/call", time: 1003, data: { name: "read", arguments: '{"file_path":"a.txt"}' } },
  { seq: 4, type: "tool/result", time: 1004, data: { error: { name: "FsError", code: "FS_NOT_OBSERVED" }, message: { content: [{ type: "text", text: "file not observed" }] } } },
  { seq: 5, type: "tool/call", time: 1005, data: { name: "read", arguments: '{"file_path":"a.txt"}' } },
  { seq: 6, type: "tool/result", time: 1006, data: { error: { name: "FsError", code: "FS_NOT_OBSERVED" }, message: { content: [{ type: "text", text: "file not observed" }] } } },
  { seq: 7, type: "turn/end", time: 1007, data: { reason: { kind: "error", error: { message: "turn failed" } } } },
  { seq: 8, type: "user/message", time: 1008, data: { content: [{ type: "text", text: "retry   now" }] } },
];

const header = { id: LIVE_ID, createdAt: 1000, cwd: "D:/work", isSeeded: false };

const fakePersistence = {
  async open(id, access) {
    if (id !== PERSISTED_ID) throw new Error('session "' + id + '" not found');
    let closed = false;
    return {
      id,
      access,
      header: { id: PERSISTED_ID, createdAt: 2000, cwd: "D:/work", isSeeded: false },
      async read(offset = 0, length) {
        if (closed) throw new Error("handle closed");
        return { eventState: "shared-frozen", events: length === undefined ? EVENTS.slice(offset) : EVENTS.slice(offset, offset + length) };
      },
      async close() {
        closed = true;
      },
    };
  },
  async list() {
    return [{ header: { id: PERSISTED_ID, createdAt: 2000 } }];
  },
  async stat(id) {
    return id === PERSISTED_ID ? { header: { id }, eventCount: EVENTS.length } : undefined;
  },
};

const traceCalls = [];
const fakeQuery = {
  async listSessions() {
    return [
      { header: { id: LIVE_ID, createdAt: 1000, cwd: "D:/work" }, live: true, persisted: true },
      { header: { id: PERSISTED_ID, createdAt: 2000 }, live: false, persisted: true },
    ];
  },
  async traceEvent(request) {
    traceCalls.push(request);
    return { target: { seq: request.seq, type: "tool/result", time: 1004, surface: "current" }, replacedBy: null, replacementChain: [], replacedEventSeqs: [], sourceEventSeqs: [], derivedEventSeqs: [] };
  },
  async traceSession(sessionId) {
    traceCalls.push(sessionId);
    return { complete: true, ancestors: [], descendants: [] };
  },
};

const skillsRegistered = new Map();
const services = {
  sessions: {
    get(id) {
      return id === LIVE_ID ? { id, header, snapshotEvents: () => EVENTS.slice() } : undefined;
    },
    list() {
      return [{ id: LIVE_ID, header }];
    },
  },
  sessionPersistence: fakePersistence,
  sessionQuery: fakeQuery,
  skills: {
    register(skill) {
      if (skillsRegistered.has(skill.name)) return () => {};
      skillsRegistered.set(skill.name, skill);
      return () => skillsRegistered.delete(skill.name);
    },
  },
};

/* ---------------- 假 ctx + apply ---------------- */
const registered = new Map();
const disposed = [];
const ctx = {
  tools: {
    register(tool) {
      registered.set(tool.name, tool);
      return () => registered.delete(tool.name);
    },
  },
  effect(callback, label) {
    const dispose = callback();
    if (typeof dispose !== "function") throw new Error("effect must return a disposer: " + label);
    disposed.push(label);
    return dispose;
  },
  get(name) {
    return services[name];
  },
};

apply(ctx);

/* ---------------- 注册 ---------------- */
eq("registers 4 tools", [...registered.keys()].sort(), ["trajectory_find", "trajectory_sessions", "trajectory_trace", "trajectory_window"]);
eq("registers one disposer per tool + one for the skill", disposed.filter((label) => label.startsWith("trajectory-tools:")).length, 5);
eq("registers the runtime skill", [...skillsRegistered.keys()], ["trajectory-query"]);
const skill = skillsRegistered.get("trajectory-query");
check("skill carries a description", typeof skill.description === "string" && skill.description.length > 0);
check(
  "skill body names all four tools",
  ["trajectory_sessions", "trajectory_find", "trajectory_window", "trajectory_trace"].every((name) => skill.content.includes(name)),
);
check("skill body pins the citation convention", skill.content.includes("(session, seq@logId)"));

// skills 服务缺失时,工具仍必须注册(硬依赖只有 tools)。
const toolOnly = new Map();
apply({
  tools: {
    register(tool) {
      toolOnly.set(tool.name, tool);
      return () => {};
    },
  },
  effect(callback) {
    return callback();
  },
  get(name) {
    return name === "skills" ? undefined : services[name];
  },
});
eq("tools register without the skills service", toolOnly.size, 4);

// 重名(常见于上一个进程遗留的动态插件注册)必须显式失败,而不是静默注册一半。
let conflictError = null;
try {
  apply({
    tools: {
      register() {
        throw new Error('tool "trajectory_find" is already registered');
      },
    },
    effect(callback) {
      return callback();
    },
    get(name) {
      return name === "skills" ? undefined : services[name];
    },
  });
} catch (error) {
  conflictError = String((error && error.message) || error);
}
check("duplicate tool names fail loudly", conflictError !== null && conflictError.includes("工具名已被占用"), conflictError);

const call = (name, args) => registered.get(name).execute(args);

/* ---------------- 纯函数 ---------------- */
check("eventText: tool/call carries name+args", eventText(EVENTS[3]).includes("read") && eventText(EVENTS[3]).includes("a.txt"), eventText(EVENTS[3]));
check("eventText: tool/result carries error name+code", eventText(EVENTS[4]).includes("FsError") && eventText(EVENTS[4]).includes("FS_NOT_OBSERVED"), eventText(EVENTS[4]));
eq("fold: case + whitespace insensitive", fold("Retry\n   Now"), "retry now");

const idBefore = logIdOf(LIVE_ID, EVENTS[0]);
const idAfterAppend = logIdOf(LIVE_ID, EVENTS[0]);
eq("logId: append-stable", idAfterAppend, idBefore);
check("logId: differs when the first event differs", logIdOf(LIVE_ID, { seq: 0, type: "turn/start", time: 999 }) !== idBefore);
eq("logIdentity: range from full log", logIdentity(LIVE_ID, EVENTS), { id: idBefore, events: 9, minSeq: 0, maxSeq: 8 });

/* ---------------- trajectory_sessions ---------------- */
const sessions = await call("trajectory_sessions", {});
eq("sessions: lists both sources", sessions.total, 2);
eq("sessions: marks live", sessions.items[0].live, true);
const liveOnly = await call("trajectory_sessions", { liveOnly: true });
eq("sessions: liveOnly filter", liveOnly.returned, 1);

/* ---------------- trajectory_find ---------------- */
const found = await call("trajectory_find", { session: LIVE_ID, query: "fs_not_observed" });
eq("find: case-insensitive literal hits", found.hitCount, 2);
eq("find: hit seqs", found.items.map((item) => item.seq), [4, 6]);
eq("find: carries log id", found.log.id, idBefore);
check("find: snippet is verbatim", found.items[0].text.includes("FS_NOT_OBSERVED"), found.items[0].text);

const folded = await call("trajectory_find", { session: LIVE_ID, query: "retry now" });
eq("find: whitespace-folded hit", folded.items.map((item) => item.seq), [8]);

const typed = await call("trajectory_find", { session: LIVE_ID, types: ["tool/call"] });
eq("find: type filter", typed.items.map((item) => item.seq), [3, 5]);

const ranged = await call("trajectory_find", { session: LIVE_ID, query: "file", from: 5, to: 6 });
eq("find: seq range filter", ranged.items.map((item) => item.seq), [5, 6]);

const missing = await call("trajectory_find", { session: LIVE_ID, query: "zzz-not-in-log" });
eq("find: empty is a verifiable absence", missing.hitCount, 0);
eq("find: still reports the log", missing.log.id, idBefore);

const noFilter = await call("trajectory_find", { session: LIVE_ID });
eq("find: rejects an empty filter set", noFilter.ok, false);

const cross = await call("trajectory_find", { query: "fs_not_observed", sessionCount: 2, limit: 10 });
eq("find: cross-session scans both", cross.scanned, 2);
eq("find: cross-session items carry their own log", cross.items.length, 4);

/* ---------------- 已持久化(非存活)会话走 persistence ---------------- */
const persistedLogId = logIdOf(PERSISTED_ID, EVENTS[0]);
check("logId: different session id yields a different log id", persistedLogId !== idBefore);

const settledFind = await call("trajectory_find", { session: PERSISTED_ID, query: "FsError" });
eq("find: settled session via persistence", settledFind.hitCount, 2);
eq("find: settled source", settledFind.source, "persisted");
eq("find: settled log id", settledFind.log.id, persistedLogId);

const settledWindow = await call("trajectory_window", { session: PERSISTED_ID, from: 3, to: 5, mode: "raw" });
eq("window: settled slice", settledWindow.events.map((row) => row.seq), [3, 4, 5]);
eq("window: settled log id", settledWindow.log.id, persistedLogId);
eq("window: settled event count from stat", settledWindow.log.eventCount, 9);

/* ---------------- trajectory_window ---------------- */
const around = await call("trajectory_window", { session: LIVE_ID, seq: 4 });
eq("window: seq centres ±5", [around.requested.from, around.requested.to], [0, 9]);
eq("window: surface mode drops text-less events", around.events.some((row) => row.seq === 0), false);
check("window: returns verbatim text", around.events.find((row) => row.seq === 4).text.includes("FS_NOT_OBSERVED"));

const raw = await call("trajectory_window", { session: LIVE_ID, from: 0, to: 2, mode: "raw" });
eq("window: raw mode keeps every event", raw.events.map((row) => row.seq), [0, 1, 2]);

const tooWide = await call("trajectory_window", { session: LIVE_ID, from: 0, to: 100 });
eq("window: rejects >60 events", tooWide.ok, false);
const noBounds = await call("trajectory_window", { session: LIVE_ID });
eq("window: rejects missing bounds", noBounds.ok, false);

let requiredThrew = false;
try {
  await call("trajectory_window", {});
} catch (error) {
  requiredThrew = /invalid arguments/.test(String(error && error.message));
}
check("window: DSL enforces required session", requiredThrew);

/* ---------------- trajectory_trace ---------------- */
const traced = await call("trajectory_trace", { session: LIVE_ID, seq: 4 });
eq("trace: event branch", traced.target.seq, 4);
eq("trace: surface field", traced.target.surface, "current");
const lineage = await call("trajectory_trace", { session: LIVE_ID });
eq("trace: session branch", lineage.complete, true);

/* ---------------- 结果 ---------------- */
if (failures.length === 0) {
  console.log("ALL PASS (" + passed + " checks)");
} else {
  console.error("FAILED " + failures.length + "/" + (passed + failures.length) + ":");
  for (const failure of failures) console.error("  - " + failure);
  process.exitCode = 1;
}
