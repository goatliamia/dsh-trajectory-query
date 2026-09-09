// dsh-trajectory-tools self-test — 不连真实会话:用假 ctx + 合成事件日志验证工具契约。
//
// 运行(必须能解析 @deepseek-ai/dsh-tools,即从安装后的包目录运行):
//   cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs
//
// 覆盖:注册 5 个工具、参数校验、字面量检索(大小写/空白/转义归一)、seq 区间与类型过滤、
// 存活/已持久化两条读取路径、窗口上限、trace 有界渲染、目录统计、logId append-stable,
// 以及曾经的缺陷回归:
//   1) 不给 session 时默认扫描集必须包含「当前会话 + 所有 live 会话」(哪怕它 createdAt 最老)
//   2) 命中片段以命中点为中心,必须包含查询词(1000 字符长事件用例)
//   3) 默认过滤注入样板(<system-reminder>)与 trajectory_* 自身的调用/结果
//   4) issue #1:转义路径(双反斜杠)能被单反斜杠查询命中;issue #2:trace 关系链有界
//   5) issue #3:trajectory_index 只给计数与范围

import {
  apply,
  boundSeqs,
  buildSelfCallIds,
  clipAround,
  currentSessionId,
  eventText,
  fold,
  indexEvents,
  isInjectedText,
  isSelfEvent,
  logIdOf,
  logIdentity,
  norm,
} from "./lib/index.js";

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

/* ---------------- 合成会话 ---------------- */
const LIVE_ID = "session-live-0001"; // live,不是当前会话
const PERSISTED_ID = "session-settled-0002"; // 已持久化
const CURRENT_ID = "session-current-0003"; // live 且是当前会话,createdAt 最老
const NEWER = ["session-newer-a", "session-newer-b", "session-newer-c"]; // 已持久化,createdAt 最新

// 主日志:9 条基础事件 + 注入样板 + trajectory_* 自回显 + 一条超长事件(命中点在第 800 字符)
const EVENTS = [
  { seq: 0, type: "turn/start", time: 1000, data: {} },
  { seq: 1, type: "user/message", time: 1001, data: { content: [{ type: "text", text: "Fix the SQL query" }] } },
  { seq: 2, type: "assistant/message", time: 1002, data: { message: { content: [{ type: "text", text: "Let me read the file" }] } } },
  { seq: 3, type: "tool/call", time: 1003, data: { name: "read", callId: "call-read-1", arguments: '{"file_path":"a.txt"}' } },
  { seq: 4, type: "tool/result", time: 1004, data: { error: { name: "FsError", code: "FS_NOT_OBSERVED" }, message: { source: { kind: "tool", callId: "call-read-1" }, content: [{ type: "text", text: "file not observed" }] } } },
  { seq: 5, type: "tool/call", time: 1005, data: { name: "read", callId: "call-read-2", arguments: '{"file_path":"a.txt"}' } },
  { seq: 6, type: "tool/result", time: 1006, data: { error: { name: "FsError", code: "FS_NOT_OBSERVED" }, message: { source: { kind: "tool", callId: "call-read-2" }, content: [{ type: "text", text: "file not observed" }] } } },
  { seq: 7, type: "turn/end", time: 1007, data: { reason: { kind: "error", error: { message: "turn failed" } } } },
  { seq: 8, type: "user/message", time: 1008, data: { content: [{ type: "text", text: "retry   now" }] } },
  // 注入样板:命中点在 workspace 指令里,默认应被过滤
  { seq: 9, type: "user/message", time: 1009, data: { content: [{ type: "text", text: "<system-reminder>\nworkspace instructions mention facade" }] } },
  // trajectory_* 自回显三连:助手只发了调用块 / 工具调用 / 工具结果,默认都应被过滤
  { seq: 10, type: "assistant/message", time: 1010, data: { message: { content: [{ type: "tool-call", id: "call-self-1", name: "trajectory_find", arguments: '{"query":"facade"}' }] } } },
  { seq: 11, type: "tool/call", time: 1011, data: { name: "trajectory_find", callId: "call-self-1", arguments: '{"query":"facade"}' } },
  { seq: 12, type: "tool/result", time: 1012, data: { message: { source: { kind: "tool", callId: "call-self-1" }, content: [{ type: "tool-result", toolCallId: "call-self-1", content: [{ type: "text", text: "trajectory_find result mentioning facade" }] }] } } },
  // 真实命中:默认保留
  { seq: 13, type: "user/message", time: 1013, data: { content: [{ type: "text", text: "the facade seam is the real topic" }] } },
  // 超长事件:查询词只在第 800 字符之后
  { seq: 14, type: "user/message", time: 1014, data: { content: [{ type: "text", text: "x".repeat(800) + " needle-at-the-end " + "y".repeat(200) }] } },
  // issue #1:日志里是转义过的双反斜杠路径,模型习惯用单反斜杠查
  { seq: 15, type: "user/message", time: 1015, data: { content: [{ type: "text", text: "open C:\\\\Users\\\\14100\\\\.dsh\\\\settings.yaml now" }] } },
];

const CURRENT_EVENTS = [
  { seq: 0, type: "turn/start", time: 100, data: {} },
  { seq: 1, type: "user/message", time: 101, data: { content: [{ type: "text", text: "zebra-marker lives only in the current session" }] } },
];

const newerEvents = (tag) => [
  { seq: 0, type: "turn/start", time: 9000, data: {} },
  { seq: 1, type: "user/message", time: 9001, data: { content: [{ type: "text", text: "newer session " + tag }] } },
];

const HEADERS = new Map([
  [LIVE_ID, { id: LIVE_ID, createdAt: 5000, cwd: "D:/work", isSeeded: false }],
  [PERSISTED_ID, { id: PERSISTED_ID, createdAt: 4000, cwd: "D:/work", isSeeded: false }],
  [CURRENT_ID, { id: CURRENT_ID, createdAt: 1000, cwd: "D:/work", isSeeded: false }],
  [NEWER[0], { id: NEWER[0], createdAt: 9000 }],
  [NEWER[1], { id: NEWER[1], createdAt: 8000 }],
  [NEWER[2], { id: NEWER[2], createdAt: 7000 }],
]);
const LOGS = new Map([
  [LIVE_ID, EVENTS],
  [PERSISTED_ID, EVENTS],
  [CURRENT_ID, CURRENT_EVENTS],
  [NEWER[0], newerEvents("a")],
  [NEWER[1], newerEvents("b")],
  [NEWER[2], newerEvents("c")],
]);
const LIVE_IDS = new Set([LIVE_ID, CURRENT_ID]);

const fakePersistence = {
  async open(id) {
    const events = LOGS.get(id);
    if (events === undefined) throw new Error('session "' + id + '" not found');
    let closed = false;
    return {
      id,
      access: "read",
      header: HEADERS.get(id),
      async read(offset = 0, length) {
        if (closed) throw new Error("handle closed");
        return { eventState: "shared-frozen", events: length === undefined ? events.slice(offset) : events.slice(offset, offset + length) };
      },
      async close() {
        closed = true;
      },
    };
  },
  async list() {
    return [...HEADERS.keys()].map((id) => ({ header: HEADERS.get(id) }));
  },
  async stat(id) {
    const events = LOGS.get(id);
    return events === undefined ? undefined : { header: HEADERS.get(id), eventCount: events.length };
  },
};

const traceCalls = [];
const fakeQuery = {
  async listSessions() {
    // 故意按 createdAt 降序返回(真实服务的顺序),排序应由插件自己负责。
    return [
      { header: HEADERS.get(NEWER[0]), live: false, persisted: true },
      { header: HEADERS.get(NEWER[1]), live: false, persisted: true },
      { header: HEADERS.get(NEWER[2]), live: false, persisted: true },
      { header: HEADERS.get(LIVE_ID), live: true, persisted: true },
      { header: HEADERS.get(PERSISTED_ID), live: false, persisted: true },
      { header: HEADERS.get(CURRENT_ID), live: true, persisted: true },
    ];
  },
  async traceEvent(request) {
    traceCalls.push(request);
    return {
      target: { seq: request.seq, type: "tool/result", time: 1004, surface: "current" },
      replacedBy: 530395,
      replacementChain: [530395, 1066440],
      replacedEventSeqs: [11, 12],
      // issue #2:真实会话里 sourceEventSeqs 可达上千项
      sourceEventSeqs: Array.from({ length: 10 }, (_, index) => 22404 + index),
      derivedEventSeqs: [7],
    };
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
      return LIVE_IDS.has(id) ? { id, header: HEADERS.get(id), snapshotEvents: () => (LOGS.get(id) || []).slice() } : undefined;
    },
    list() {
      return [...LIVE_IDS].map((id) => ({ id, header: HEADERS.get(id) }));
    },
  },
  sessionPersistence: fakePersistence,
  sessionQuery: fakeQuery,
  agents: {
    currentInitiator() {
      return { session: { id: CURRENT_ID } };
    },
  },
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
eq("registers 5 tools", [...registered.keys()].sort(), ["trajectory_find", "trajectory_index", "trajectory_sessions", "trajectory_trace", "trajectory_window"]);
eq("registers one disposer per tool + one for the skill", disposed.filter((label) => label.startsWith("trajectory-tools:")).length, 6);
eq("registers the runtime skill", [...skillsRegistered.keys()], ["trajectory-query"]);
const skill = skillsRegistered.get("trajectory-query");
check("skill carries a description", typeof skill.description === "string" && skill.description.length > 0);
check(
  "skill body names every tool",
  ["trajectory_sessions", "trajectory_index", "trajectory_find", "trajectory_window", "trajectory_trace"].every((name) => skill.content.includes(name)),
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
eq("tools register without the skills service", toolOnly.size, 5);

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

const EXEC = { agent: { session: { id: CURRENT_ID } } };
const call = (name, args) => registered.get(name).execute(args, EXEC);

/* ---------------- 纯函数 ---------------- */
check("eventText: tool/call carries name+args", eventText(EVENTS[3]).includes("read") && eventText(EVENTS[3]).includes("a.txt"), eventText(EVENTS[3]));
check("eventText: tool/result carries error name+code", eventText(EVENTS[4]).includes("FsError") && eventText(EVENTS[4]).includes("FS_NOT_OBSERVED"), eventText(EVENTS[4]));
eq("fold: case + whitespace insensitive", fold("Retry\n   Now"), "retry now");

// issue #1:归一化(转义反斜杠 + 中英文引号)
eq("norm: folds a backslash run", norm("C:\\\\Users\\\\14100"), "c:\\users\\14100");
eq("norm: unifies smart quotes", norm("\u201Cx\u201D \u2018y\u2019"), '"x" \'y\'');
eq("norm: keeps ordinary text", norm("Retry\n   Now"), "retry now");

// 片段居中:命中点在 1000 字符事件的第 800 位
const longText = "a".repeat(800) + "NEEDLE-token" + "b".repeat(200);
const centred = clipAround(longText, "needle-token", 400);
check("clipAround: snippet contains the needle", centred.text.includes("NEEDLE-token"), centred.text.slice(0, 60));
check("clipAround: matchAt points at the needle", centred.text.slice(centred.matchAt, centred.matchAt + 12) === "NEEDLE-token", "matchAt=" + centred.matchAt);
check("clipAround: stays within budget", centred.text.length <= 402, "len=" + centred.text.length);
const foldedClip = clipAround("prefix retry\n   now suffix", "retry now", 400);
check("clipAround: whitespace-folded match keeps both tokens", foldedClip.text.includes("retry") && foldedClip.text.includes("now") && foldedClip.matchAt >= 0, JSON.stringify(foldedClip));
eq("clipAround: no match reports -1", clipAround("short text", "absent").matchAt, -1);
const longNeedle = "q".repeat(500);
const longNeedleClip = clipAround("head " + longNeedle + " tail", longNeedle, 400);
check("clipAround: a needle longer than the budget is never truncated", longNeedleClip.text.includes(longNeedle), "len=" + longNeedleClip.text.length);
// issue #1:原文是双反斜杠、查询是单反斜杠,片段必须命中且仍是原文
const escapedClip = clipAround("path is C:\\\\Users\\\\14100\\\\.dsh", "C:\\Users\\14100", 400, true);
check("clipAround: normalized match finds the escaped path verbatim", escapedClip.matchAt >= 0 && escapedClip.text.includes("C:\\\\Users\\\\14100"), JSON.stringify(escapedClip));
eq("clipAround: normalization can be disabled", clipAround("path is C:\\\\Users\\\\14100", "C:\\Users\\14100", 400, false).matchAt, -1);

// issue #2:关系链有界渲染
const bounded = boundSeqs([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq("boundSeqs: default is count + head/tail", bounded, { count: 10, head: [1, 2, 3], tail: [8, 9, 10], truncated: true });
eq("boundSeqs: short arrays stay whole", boundSeqs([1, 2]), { count: 2, items: [1, 2], truncated: false });
eq("boundSeqs: full returns the complete array", boundSeqs([1, 2, 3, 4, 5, 6, 7], true), { count: 7, items: [1, 2, 3, 4, 5, 6, 7] });

// 过滤谓词
check("isInjectedText: system-reminder prefix", isInjectedText("  <system-reminder>\n...") && !isInjectedText("plain user text"));
const selfIds = buildSelfCallIds(EVENTS);
eq("buildSelfCallIds: only trajectory_* calls", [...selfIds], ["call-self-1"]);
check("isSelfEvent: trajectory_* tool/call", isSelfEvent(EVENTS[11], selfIds));
check("isSelfEvent: linked tool/result", isSelfEvent(EVENTS[12], selfIds));
check("isSelfEvent: assistant message that only requests the tool", isSelfEvent(EVENTS[10], selfIds));
check("isSelfEvent: ordinary read result is not self", !isSelfEvent(EVENTS[4], selfIds));
eq("currentSessionId: reads exec.agent.session.id", currentSessionId(ctx, EXEC), CURRENT_ID);

const idBefore = logIdOf(LIVE_ID, EVENTS[0]);
const idAfterAppend = logIdOf(LIVE_ID, EVENTS[0]);
eq("logId: append-stable", idAfterAppend, idBefore);
check("logId: differs when the first event differs", logIdOf(LIVE_ID, { seq: 0, type: "turn/start", time: 999 }) !== idBefore);
eq("logIdentity: range from full log", logIdentity(LIVE_ID, EVENTS), { id: idBefore, events: 16, minSeq: 0, maxSeq: 15 });

/* ---------------- trajectory_sessions ---------------- */
const sessions = await call("trajectory_sessions", { limit: 10 });
eq("sessions: lists every source", sessions.total, 6);
eq("sessions: reports the current session", sessions.current, CURRENT_ID);
eq("sessions: current first, then live, then persisted by createdAt", sessions.items.map((item) => item.id), [
  CURRENT_ID,
  LIVE_ID,
  NEWER[0],
  NEWER[1],
  NEWER[2],
  PERSISTED_ID,
]);
eq("sessions: marks the current session", sessions.items[0].current, true);
eq("sessions: marks live", sessions.items[1].live, true);
const liveOnly = await call("trajectory_sessions", { liveOnly: true });
eq("sessions: liveOnly filter", liveOnly.items.map((item) => item.id), [CURRENT_ID, LIVE_ID]);

/* ---------------- trajectory_find ---------------- */
const found = await call("trajectory_find", { session: LIVE_ID, query: "fs_not_observed" });
eq("find: case-insensitive literal hits", found.hitCount, 2);
eq("find: hit seqs", found.items.map((item) => item.seq), [4, 6]);
eq("find: carries log id", found.log.id, idBefore);
check("find: snippet is verbatim", found.items[0].text.includes("FS_NOT_OBSERVED"), found.items[0].text);

const folded = await call("trajectory_find", { session: LIVE_ID, query: "retry now" });
eq("find: whitespace-folded hit", folded.items.map((item) => item.seq), [8]);

const typed = await call("trajectory_find", { session: LIVE_ID, types: ["tool/call"] });
eq("find: type filter drops the tool's own call", typed.items.map((item) => item.seq), [3, 5]);

const ranged = await call("trajectory_find", { session: LIVE_ID, query: "file", from: 5, to: 6 });
eq("find: seq range filter", ranged.items.map((item) => item.seq), [5, 6]);

const missing = await call("trajectory_find", { session: LIVE_ID, query: "zzz-not-in-log" });
eq("find: empty is a verifiable absence", missing.hitCount, 0);
eq("find: still reports the log", missing.log.id, idBefore);

const noFilter = await call("trajectory_find", { session: LIVE_ID });
eq("find: rejects an empty filter set", noFilter.ok, false);

// 长事件:查询词只在第 800 字符之后,片段必须仍然包含它
const longHit = await call("trajectory_find", { session: LIVE_ID, query: "needle-at-the-end" });
eq("find: long event is a hit", longHit.items.map((item) => item.seq), [14]);
check("find: long-event snippet contains the needle", longHit.items[0].text.includes("needle-at-the-end"), longHit.items[0].text.slice(0, 80));
check("find: long-event matchAt points at the needle", longHit.items[0].text.slice(longHit.items[0].matchAt, longHit.items[0].matchAt + 17) === "needle-at-the-end", "matchAt=" + longHit.items[0].matchAt);

// issue #1:模型写单反斜杠,日志里是双反斜杠 —— 归一化默认开,可关
const escaped = await call("trajectory_find", { session: LIVE_ID, query: "C:\\Users\\14100\\.dsh" });
eq("find: escaped path is found with a single-backslash query", escaped.items.map((item) => item.seq), [15]);
eq("find: reports normalized: true", escaped.normalized, true);
check("find: escaped hit keeps verbatim text", escaped.items[0].text.includes("C:\\\\Users\\\\14100"), escaped.items[0].text.slice(0, 80));
const escapedOff = await call("trajectory_find", { session: LIVE_ID, query: "C:\\Users\\14100\\.dsh", normalize: false });
eq("find: normalize=false restores strict matching", escapedOff.hitCount, 0);
eq("find: reports normalized: false", escapedOff.normalized, false);

// 注入样板 + 自回显:默认过滤,只留真实命中
const facade = await call("trajectory_find", { session: LIVE_ID, query: "facade" });
eq("find: default filters leave only the real hit", facade.items.map((item) => item.seq), [13]);
eq("find: reports filtered injected", facade.filtered.injected, 1);
eq("find: reports filtered self", facade.filtered.self, 3);
const facadeRaw = await call("trajectory_find", { session: LIVE_ID, query: "facade", excludeInjected: false, excludeSelf: false });
eq("find: filters can be turned off", facadeRaw.items.map((item) => item.seq), [9, 10, 11, 12, 13]);
eq("find: unfiltered run reports nothing filtered", facadeRaw.filtered, { injected: 0, self: 0 });

/* ---------------- 默认扫描集:当前会话 + live 会话 ---------------- */
const scope = await call("trajectory_find", { query: "zebra-marker", sessionCount: 1, limit: 10 });
eq("find: default scope resolves the current session", scope.current, CURRENT_ID);
eq("find: default scope hits a word only the current session has", scope.items.map((item) => item.session), [CURRENT_ID]);
check("find: default scope always includes current + live", scope.targets.includes(CURRENT_ID) && scope.targets.includes(LIVE_ID), JSON.stringify(scope.targets));
eq("find: sessionCount only caps the extra persisted sessions", scope.scanned, 3);

const scopeViaAgents = await registered.get("trajectory_find").execute({ query: "zebra-marker", sessionCount: 1 });
eq("find: current session resolves via agents.currentInitiator", scopeViaAgents.items[0] && scopeViaAgents.items[0].session, CURRENT_ID);

const cross = await call("trajectory_find", { query: "fs_not_observed", sessionCount: 10, limit: 10 });
eq("find: cross-session scans the whole set", cross.scanned, 6);
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
eq("window: settled event count from stat", settledWindow.log.eventCount, 16);

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
// issue #2:关系链默认有界
eq("trace: sourceEventSeqs is bounded", traced.sourceEventSeqs, { count: 10, head: [22404, 22405, 22406], tail: [22411, 22412, 22413], truncated: true });
eq("trace: short chains stay whole", traced.replacementChain, { count: 2, items: [530395, 1066440], truncated: false });
eq("trace: full=true returns the complete array", (await call("trajectory_trace", { session: LIVE_ID, seq: 4, full: true })).sourceEventSeqs.items.length, 10);
const lineage = await call("trajectory_trace", { session: LIVE_ID });
eq("trace: session branch", lineage.complete, true);

/* ---------------- trajectory_index(issue #3:目录,不是搜索) ---------------- */
const index = await call("trajectory_index", { limit: 10 });
eq("index: current session first", index.sessions[0].session, CURRENT_ID);
eq("index: current is marked", index.sessions[0].current, true);
const liveRow = index.sessions.find((row) => row.session === LIVE_ID);
check("index: counts events after the default filters", liveRow.events === 12, JSON.stringify(liveRow));
eq("index: semantic event count", liveRow.semanticEvents, 11);
eq("index: byType", liveRow.byType["tool/call"], 2);
eq("index: byTool counts calls", liveRow.byTool.read, 2);
eq("index: seq range", liveRow.seqRange, [0, 15]);
eq("index: time range", liveRow.timeRange, [1000, 1015]);
check("index: returns no content", !("text" in liveRow) && !("items" in liveRow), JSON.stringify(liveRow));

const indexTool = await call("trajectory_index", { tool: "read", limit: 10 });
const toolRow = indexTool.sessions.find((row) => row.session === LIVE_ID);
eq("index: tool filter keeps calls + linked results", toolRow.events, 4);
eq("index: tool filter narrows byType", toolRow.byType["tool/result"], 2);

const indexType = await call("trajectory_index", { type: ["tool/call"], limit: 10 });
eq("index: type filter", indexType.sessions.find((row) => row.session === LIVE_ID).events, 2);

const indexTime = await call("trajectory_index", { timeFrom: 1004, timeTo: 1006, limit: 10 });
eq("index: time window", indexTime.sessions.find((row) => row.session === LIVE_ID).events, 3);

const indexCwd = await call("trajectory_index", { cwd: "work", limit: 10 });
check("index: cwd filter keeps only matching sessions", indexCwd.sessions.every((row) => String(row.cwd).includes("work")), JSON.stringify(indexCwd.sessions.map((row) => row.cwd)));
eq("index: cwd filter drops the others", indexCwd.sessions.some((row) => row.session === NEWER[0]), false);

// 纯函数直测:indexEvents 与工具同源
const direct = indexEvents(EVENTS, { toolNeedle: "trajectory_find" });
eq("indexEvents: tool filter on the tool's own call", direct.events, 0);

/* ---------------- 结果 ---------------- */
if (failures.length === 0) {
  console.log("ALL PASS (" + passed + " checks)");
} else {
  console.error("FAILED " + failures.length + "/" + (passed + failures.length) + ":");
  for (const failure of failures) console.error("  - " + failure);
  process.exitCode = 1;
}
