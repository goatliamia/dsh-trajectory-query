// dsh-trajectory-tools self-test — 不连真实会话:用假 ctx + 合成事件日志验证工具契约。
//
// 运行(必须能解析 @deepseek-ai/dsh-tools,即从安装后的包目录运行):
//   cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs
//
// 覆盖:注册 3 个入口(search/read/graph)、参数校验、字面量检索(大小写/空白/转义归一)、
// seq 区间与类型过滤、filter 契约(未知键给出可用键)、
// 存活/已持久化两条读取路径、窗口上限、trace 有界渲染、目录统计、成本 fold、logId append-stable、
// 可选功能「压缩后对账」(压缩才说话 / 一次压缩只对一次账 / 子会话跳过 / 自定义句子 / 可关闭 /
// 注入抛错不冒泡 / notice 默认不算人的事实),
// 以及曾经的缺陷回归:
//   1) 不给 session 时默认扫描集必须包含「当前会话 + 所有 live 会话」(哪怕它 createdAt 最老)
//   2) 命中片段以命中点为中心,必须包含查询词(1000 字符长事件用例)
//   3) 默认过滤注入样板(<system-reminder>)与 trajectory_* 自身的调用/结果
//   4) issue #1:转义路径(双反斜杠)能被单反斜杠查询命中;issue #2:trace 关系链有界
//   5) issue #3:trajectory_index 只给计数与范围;issue #5:trajectory_cost 的 usage 缺失记 unknown

import { readFileSync } from "node:fs";

import {
  DEFAULT_RECONCILE_SENTENCE,
  apply,
  boundSeqs,
  buildSelfCallIds,
  cacheEfficiency,
  clipAround,
  costByTurn,
  costRequests,
  costTotals,
  currentSessionId,
  eventText,
  fold,
  indexEvents,
  isInjectedText,
  isPluginContext,
  isSelfEvent,
  logIdOf,
  logIdentity,
  norm,
  reconcileMessage,
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

/**
 * 工具输出里第一个会被 JSON 丢掉/改写的值(undefined / 非有限数 / 函数 / BigInt / Symbol)。
 * 运行时会拒绝"非 lossless JSON"的输出,而且是整个调用失败 —— 所以这是硬契约,不是风格问题。
 * 返回 null 表示干净;否则返回出问题的路径。
 */
function lossless(value, path = "(root)") {
  if (value === undefined) return path;
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "function" || kind === "symbol" || kind === "bigint") return path;
  if (kind === "number") return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const hit = lossless(value[index], path + "[" + index + "]");
      if (hit !== null) return hit;
    }
    return null;
  }
  if (kind === "object") {
    for (const key of Object.keys(value)) {
      const hit = lossless(value[key], path + "." + key);
      if (hit !== null) return hit;
    }
    return null;
  }
  return null;
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

// 成本夹具(issue #5):刻意不出现在 listSessions 的返回里,只用于 trajectory_cost 的单元验证。
const COST_ID = "session-cost-0004";
const COST_EVENTS = [
  { seq: 0, type: "assistant/message", time: 1, data: { turn: 1, step: 1, message: { source: { provider: "deepseek-official", model: "m1" } }, usage: { inputTokens: 604, outputTokens: 63, totalTokens: 7835, cacheReadTokens: 7168, cacheWriteTokens: 0, reasoningTokens: 0 } } },
  { seq: 1, type: "assistant/message", time: 2, data: { turn: 1, step: 2, message: { source: { provider: "deepseek-official", model: "m1" } }, usage: { inputTokens: 215, outputTokens: 316, totalTokens: 8211, cacheReadTokens: 7680, reasoningTokens: 150 } } },
  { seq: 2, type: "assistant/message", time: 3, data: { turn: 2, step: 1, message: { source: { provider: "deepseek-official", model: "m2" } } } },
  { seq: 3, type: "user/message", time: 4, data: { content: [{ type: "text", text: "not a request" }] } },
];

const HEADERS = new Map([
  [LIVE_ID, { id: LIVE_ID, createdAt: 5000, cwd: "D:/work", isSeeded: false }],
  [PERSISTED_ID, { id: PERSISTED_ID, createdAt: 4000, cwd: "D:/work", isSeeded: false }],
  [CURRENT_ID, { id: CURRENT_ID, createdAt: 1000, cwd: "D:/work", isSeeded: false }],
  [NEWER[0], { id: NEWER[0], createdAt: 9000 }],
  [NEWER[1], { id: NEWER[1], createdAt: 8000 }],
  [NEWER[2], { id: NEWER[2], createdAt: 7000 }],
  [COST_ID, { id: COST_ID, createdAt: 300, cwd: "D:/work", isSeeded: false }],
]);
const LOGS = new Map([
  [LIVE_ID, EVENTS],
  [PERSISTED_ID, EVENTS],
  [CURRENT_ID, CURRENT_EVENTS],
  [NEWER[0], newerEvents("a")],
  [NEWER[1], newerEvents("b")],
  [NEWER[2], newerEvents("c")],
  [COST_ID, COST_EVENTS],
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
const observations = { opened: 0, disposed: 0 };
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
  // DSH 0.1.6 起的官方读取路径;Observation 是 Disposable,必须由调用方释放
  async observeSession(sessionId) {
    const events = LOGS.get(sessionId);
    if (events === undefined) throw new Error('session "' + sessionId + '" not found');
    observations.opened++;
    return {
      source: LIVE_IDS.has(sessionId) ? "live" : "prepared",
      header: HEADERS.get(sessionId),
      events,
      [Symbol.dispose]() {
        observations.disposed++;
      },
    };
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

/**
 * 假 ctx 必须和真实 cordis 一样严格(0.1.6-alpha.2 起上下文是 Proxy):
 * 没在 inject 里声明、也不是自有属性的键,**读取即抛**
 * `cannot get property "X" without inject`。
 * 宽松的假 ctx 会让人以为代码是对的 —— 这个坑真踩过:配置读了 ctx.config,
 * 自检全绿,真实启动时插件树加载失败(正确写法是 apply 的第二参 config)。
 */
function strictCtx(target) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol" || String(prop).startsWith("_") || prop === "then") return Reflect.get(t, prop, receiver);
      if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver);
      throw new Error('cannot get property "' + String(prop) + '" without inject');
    },
  });
}

/** 只用来满足契约的空监听器:真实运行时 ctx.on 总是存在。 */
const noopOn = () => () => {};

const registered = new Map();
const disposed = [];
const listeners = new Map();
const rawCtx = {
  tools: {
    register(tool) {
      registered.set(tool.name, tool);
      return () => registered.delete(tool.name);
    },
  },
  on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
    return () => {
      const list = listeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
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

const ctx = strictCtx(rawCtx);

apply(ctx, {});

/* ---------------- 注册 ---------------- */
eq("registers 3 tools", [...registered.keys()].sort(), ["trajectory_graph", "trajectory_read", "trajectory_search"]);

/* 运行时契约(0.1.6-alpha.2 起 cordis 强制):配置只能从 apply 第二参拿。
   ctx.config 会抛 `cannot get property "config" without inject` —— 插件树加载失败,
   而且自检全绿(假 ctx 当时太宽松)。这两条检查就是为了不再发生。 */
check("apply 签名收第二参 config(运行时约定)", /export function apply\(ctx,\s*config/.test(readFileSync(new URL("./lib/index.js", import.meta.url), "utf8")), "配置入口必须是 apply 的第二参");
check("假 ctx 与真实 cordis 一样严格", (() => {
  try {
    void ctx.config;
    return false;
  } catch (error) {
    return /without inject/.test(error.message);
  }
})(), "假 ctx 必须对未声明属性抛错");
const pluginSource = readFileSync(new URL("./lib/index.js", import.meta.url), "utf8");
const ctxConfigLines = pluginSource
  .split("\n")
  .map((line, index) => [index + 1, line])
  .filter(([, line]) => /ctx\.config/.test(line) && !/^\s*(\/\/|\*)/.test(line));
check("源码里不得出现 ctx.config(配置走第二参)", ctxConfigLines.length === 0, JSON.stringify(ctxConfigLines.slice(0, 3)));

eq("registers one disposer per tool + one for the skill", disposed.filter((label) => label === "trajectory-tools:tool" || label === "trajectory-tools:skill").length, 4);
eq("reconcile 默认挂 3 个监听", [...listeners.keys()].sort(), ["agent/turn-stopping", "session/disposed", "session/event"]);
eq("reconcile 的监听各自登记 disposer", disposed.filter((label) => label === "trajectory-tools:reconcile").length, 3);
eq("registers the runtime skill", [...skillsRegistered.keys()], ["trajectory-query"]);
const skill = skillsRegistered.get("trajectory-query");
check("skill carries a description", typeof skill.description === "string" && skill.description.length > 0);
check(
  "skill body names every tool",
  ["trajectory_search", "trajectory_read", "trajectory_graph"].every((name) => skill.content.includes(name)),
);
check("skill body pins the citation convention", skill.content.includes("(session, seq@logId)"));

// skills 服务缺失时,工具仍必须注册(硬依赖只有 tools)。
const toolOnly = new Map();
apply(strictCtx({
  tools: {
    register(tool) {
      toolOnly.set(tool.name, tool);
      return () => {};
    },
  },
  on: noopOn,
  effect(callback) {
    return callback();
  },
  get(name) {
    return name === "skills" ? undefined : services[name];
  },
}), {});
eq("tools register without the skills service", toolOnly.size, 3);

// 重名(常见于上一个进程遗留的动态插件注册)必须显式失败,而不是静默注册一半。
let conflictError = null;
try {
  apply(strictCtx({
    tools: {
      register() {
        throw new Error('tool "trajectory_find" is already registered');
      },
    },
    on: noopOn,
    effect(callback) {
      return callback();
    },
    get(name) {
      return name === "skills" ? undefined : services[name];
    },
  }), {});
} catch (error) {
  conflictError = String((error && error.message) || error);
}
check("duplicate tool names fail loudly", conflictError !== null && conflictError.includes("工具名已被占用"), conflictError);

const EXEC = { agent: { session: { id: CURRENT_ID } } };

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

/* ---------------- trajectory_search ---------------- */
const search = (args) => registered.get("trajectory_search").execute(args, EXEC);
const read = (args) => registered.get("trajectory_read").execute(args, EXEC);
const graph = (args) => registered.get("trajectory_graph").execute(args, EXEC);

const sessions = await search({ view: "sessions" });
eq("sessions: 列出全部来源", sessions.total, 6);
eq("sessions: 报出当前会话", sessions.current, CURRENT_ID);
eq("sessions: 排序 当前→live→已持久化", sessions.items.map((item) => item.id), [CURRENT_ID, LIVE_ID, NEWER[0], NEWER[1], NEWER[2], PERSISTED_ID]);
eq("sessions: 标记当前会话", sessions.items[0].current, true);
eq("sessions: filter.liveOnly", (await search({ view: "sessions", filter: { liveOnly: true } })).items.map((item) => item.id), [CURRENT_ID, LIVE_ID]);

const found = await search({ view: "events", session: LIVE_ID, query: "fs_not_observed" });
eq("events: 大小写不敏感命中", found.hitCount, 2);
eq("events: 命中 seq", found.items.map((item) => item.seq), [4, 6]);
eq("events: 带 logId", found.log.id, idBefore);
check("events: 片段逐字", found.items[0].text.includes("FS_NOT_OBSERVED"), found.items[0].text);
eq("events: 空白折叠", (await search({ view: "events", session: LIVE_ID, query: "retry now" })).items.map((item) => item.seq), [8]);
eq("events: filter.types", (await search({ view: "events", session: LIVE_ID, filter: { types: ["tool/call"] } })).items.map((item) => item.seq), [3, 5]);
eq("events: filter.from/to", (await search({ view: "events", session: LIVE_ID, query: "file", filter: { from: 5, to: 6 } })).items.map((item) => item.seq), [5, 6]);
eq("events: 空结果 = 可验证的没有", (await search({ view: "events", session: LIVE_ID, query: "zzz-not-in-log" })).hitCount, 0);
eq("events: 没有任何条件时拒绝", (await search({ view: "events", session: LIVE_ID })).ok, false);

// 长事件:命中点在第 800 字符之后,片段必须仍然带它
const longHit = await search({ view: "events", session: LIVE_ID, query: "needle-at-the-end" });
eq("events: 长事件命中", longHit.items.map((item) => item.seq), [14]);
check("events: 长事件片段含命中词", longHit.items[0].text.includes("needle-at-the-end"), longHit.items[0].text.slice(0, 80));
check("events: matchAt 指向命中词", longHit.items[0].text.slice(longHit.items[0].matchAt, longHit.items[0].matchAt + 17) === "needle-at-the-end");

// issue #1:转义路径 + normalize 开关
const escaped = await search({ view: "events", session: LIVE_ID, query: "C:\\Users\\14100\\.dsh" });
eq("events: 单反斜杠查到转义路径", escaped.items.map((item) => item.seq), [15]);
eq("events: normalized=true", escaped.normalized, true);
check("events: 转义命中仍是原文", escaped.items[0].text.includes("C:\\\\Users\\\\14100"), escaped.items[0].text.slice(0, 60));
eq("events: normalize=false 回到严格匹配", (await search({ view: "events", session: LIVE_ID, query: "C:\\Users\\14100\\.dsh", filter: { normalize: false } })).hitCount, 0);

// 注入样板 + 自回显
const facade = await search({ view: "events", session: LIVE_ID, query: "facade" });
eq("events: 默认过滤后只剩真实命中", facade.items.map((item) => item.seq), [13]);
eq("events: 报出过滤数量", facade.filtered, { injected: 1, self: 3 });
eq("events: 过滤可关", (await search({ view: "events", session: LIVE_ID, query: "facade", filter: { excludeInjected: false, excludeSelf: false } })).items.map((item) => item.seq), [9, 10, 11, 12, 13]);

// 默认扫描集:当前会话 + 所有 live
const scope = await search({ view: "events", query: "zebra-marker", filter: { sessionCount: 1 } });
eq("events: 默认范围解析当前会话", scope.current, CURRENT_ID);
eq("events: 命中只在当前会话里的词", scope.items.map((item) => item.session), [CURRENT_ID]);
eq("events: 当前会话与 live 总在扫描集内", scope.scanned, 3);
const viaAgents = await registered.get("trajectory_search").execute({ view: "events", query: "zebra-marker", filter: { sessionCount: 1 } });
eq("events: 当前会话可从 agents 解析", viaAgents.items[0].session, CURRENT_ID);
eq("events: 跨会话扫描整个集合", (await search({ view: "events", query: "fs_not_observed", filter: { sessionCount: 10 } })).scanned, 6);

// 已持久化会话(非 live):走观察/句柄而不是内存快照
const persistedLogId = logIdOf(PERSISTED_ID, EVENTS[0]);
check("logId: 不同会话得到不同身份", persistedLogId !== idBefore);
const settledFind = await search({ view: "events", session: PERSISTED_ID, query: "FsError" });
eq("events: 已持久化会话命中", settledFind.hitCount, 2);
eq("events: 已持久化会话的 log 身份", settledFind.log.id, persistedLogId);
const settledRead = await read({ session: PERSISTED_ID, from: 3, to: 5, raw: true });
eq("read: 已持久化会话切片", settledRead.events.map((row) => row.seq), [3, 4, 5]);
eq("read: 已持久化会话的 log 身份", settledRead.log.id, persistedLogId);
eq("read: 事件数取自 stat", settledRead.log.eventCount, 16);

/* ---------------- view=catalog / cost ---------------- */
const catalog = await search({ view: "catalog" });
eq("catalog: 当前会话第一", catalog.sessions[0].session, CURRENT_ID);
const liveRow = catalog.sessions.find((row) => row.session === LIVE_ID);
check("catalog: 默认过滤后计数", liveRow.events === 12, JSON.stringify(liveRow));
eq("catalog: semanticEvents", liveRow.semanticEvents, 11);
eq("catalog: byType", liveRow.byType["tool/call"], 2);
eq("catalog: byTool 计调用", liveRow.byTool.read, 2);
eq("catalog: seq 区间", liveRow.seqRange, [0, 15]);
eq("catalog: 时间区间", liveRow.timeRange, [1000, 1015]);
check("catalog: 只给计数不给内容", !("text" in liveRow) && !("items" in liveRow), JSON.stringify(liveRow));
eq("catalog: 单会话", (await search({ view: "catalog", session: COST_ID })).sessions.length, 1);
eq("catalog: filter.tool", (await search({ view: "catalog", filter: { tool: "read" } })).sessions.find((row) => row.session === LIVE_ID).events, 4);
eq("catalog: filter.type", (await search({ view: "catalog", filter: { type: ["tool/call"] } })).sessions.find((row) => row.session === LIVE_ID).events, 2);
eq("catalog: filter.timeFrom/timeTo", (await search({ view: "catalog", filter: { timeFrom: 1004, timeTo: 1006 } })).sessions.find((row) => row.session === LIVE_ID).events, 3);
check("catalog: filter.cwd", (await search({ view: "catalog", filter: { cwd: "work" } })).sessions.every((row) => String(row.cwd).includes("work")));
check("catalog: filter.cwd 会丢掉不匹配的会话", (await search({ view: "catalog", filter: { cwd: "work" } })).sessions.some((row) => row.session === NEWER[0]) === false);

// 纯函数直测:目录与工具同源
const direct = indexEvents(EVENTS, { toolNeedle: "trajectory_search" });
eq("indexEvents: 过滤掉工具自己的调用", direct.events, 0);

// 显式给 session 的目录(曾经的缺陷:合成记录里 live/persisted 是 undefined,
// 运行时判整个工具输出为非法 JSON —— 按 skill 说的用法查目录就是硬报错)。
const scopedCatalog = await search({ view: "catalog", session: LIVE_ID });
eq("catalog: 显式 session 不再报错", scopedCatalog.ok, true);
eq("catalog: 显式 session 只给这一个会话", scopedCatalog.sessions.map((row) => row.session), [LIVE_ID]);
eq("catalog: 显式 session 的 live 由读取来源决定", scopedCatalog.sessions[0].live, true);
eq("catalog: 显式 session 的 persisted 是 null(这次没查证)", scopedCatalog.sessions[0].persisted, null);
eq("catalog: 显式 session 从 header 补 cwd", scopedCatalog.sessions[0].cwd, HEADERS.get(LIVE_ID).cwd);
const settledCatalog = await search({ view: "catalog", session: PERSISTED_ID });
eq("catalog: 已持久化会话的 live 是 false", settledCatalog.sessions[0].live, false);

const costRows = costRequests(COST_EVENTS);
eq("cost(fold): 每个 assistant/message 一行", costRows.length, 3);
eq("cost(fold): totals 只加已上报的值", costTotals(costRows), {
  requests: 3,
  unknownRequests: 1,
  input: 819,
  cacheRead: 14848,
  cacheWrite: 0,
  output: 379,
  reasoning: 150,
  total: 16046,
  cacheEfficiency: 14848 / 15667,
});
eq("cost(fold): 缺 usage 保持 null", [costRows[2].input, costRows[2].total, costRows[2].cacheEfficiency], [null, null, null]);
eq("cost(fold): 单字段缺失记 null 且不按 0 求和", [costRows[1].cacheWrite, costTotals(costRows).cacheWrite], [null, 0]);
check("cost(fold): cache 效率 = cacheRead/(cacheRead+input)", Math.abs(costRows[0].cacheEfficiency - 7168 / 7772) < 1e-12);
eq("cost(fold): 都没有上报时效率为 null", cacheEfficiency(null, 100), null);
eq("cost(fold): 按 turn 分组保留 unknown 桶", costByTurn(costRows).map((group) => [group.turn, group.requests]), [[1, 2], [2, 1]]);

const costTool = await search({ view: "cost", session: COST_ID });
eq("cost: 请求数", costTool.requestCount, 3);
eq("cost: unknown 计数", costTool.unknownRequests, 1);
eq("cost: coverage 计已上报字段", costTool.coverage.cacheWrite, 1);
eq("cost: 带 log 身份", costTool.log.id, logIdOf(COST_ID, COST_EVENTS[0]));
check("cost: 行保留 seq/turn/step/model", costTool.rows[0].seq === 0 && costTool.rows[0].turn === 1 && costTool.rows[0].step === 1 && costTool.rows[0].model === "m1", JSON.stringify(costTool.rows[0]));
eq("cost: groupBy=turn", (await search({ view: "cost", session: COST_ID, filter: { groupBy: "turn" } })).rows.length, 2);
eq("cost: filter.from/to", (await search({ view: "cost", session: COST_ID, filter: { from: 1, to: 1 } })).requestCount, 1);
eq("cost: limit 截断标记", (await search({ view: "cost", session: COST_ID, limit: 1 })).truncated, true);
eq("cost: 缺省用当前会话", (await search({ view: "cost" })).session, CURRENT_ID);

/* ---------------- filter 契约:未知键要给出可用的键 ---------------- */
const badKey = await search({ view: "catalog", session: LIVE_ID, filter: { nope: 1 } });
eq("filter: 未知键被拒", badKey.ok, false);
check("filter: 错误里列出该 view 可用的键", badKey.error.includes("cwd") && badKey.error.includes("view=catalog"), badKey.error);
const crossKey = await search({ view: "catalog", filter: { types: ["tool/call"] } });
check("filter: 键属于别的 view 时给出提示", crossKey.ok === false && crossKey.error.includes("view=events"), crossKey.error);
let filterTypeThrew = false;
try {
  await search({ view: "catalog", filter: "types=user" });
} catch (error) {
  filterTypeThrew = /must be an object/.test(String(error && error.message));
}
check("filter: 非对象由 DSL 拦下", filterTypeThrew);
let viewRequired = false;
try {
  await registered.get("trajectory_search").execute({ query: "x" }, EXEC);
} catch (error) {
  viewRequired = /invalid arguments/.test(String(error && error.message));
}
check("search: DSL 强制 view", viewRequired);

/* ---------------- trajectory_read ---------------- */
const around = await read({ session: LIVE_ID, seq: 4 });
eq("read: seq 中心 ±5", [around.requested.from, around.requested.to], [0, 9]);
eq("read: 默认只给有正文的事件", around.events.some((row) => row.seq === 0), false);
check("read: 逐字文本", around.events.find((row) => row.seq === 4).text.includes("FS_NOT_OBSERVED"));
eq("read: raw 给区间内全部", (await read({ session: LIVE_ID, from: 0, to: 2, raw: true })).events.map((row) => row.seq), [0, 1, 2]);
eq("read: 拒绝超窗", (await read({ session: LIVE_ID, from: 0, to: 100 })).ok, false);
eq("read: 拒绝缺失边界", (await read({ session: LIVE_ID })).ok, false);
let readSessionRequired = false;
try {
  await registered.get("trajectory_read").execute({}, EXEC);
} catch (error) {
  readSessionRequired = /invalid arguments/.test(String(error && error.message));
}
check("read: DSL 强制 session", readSessionRequired);

/* ---------------- trajectory_graph ---------------- */
const traced = await graph({ session: LIVE_ID, seq: 4 });
eq("graph: 事件分支", traced.target.seq, 4);
eq("graph: surface", traced.target.surface, "current");
eq("graph: 长链有界", traced.sourceEventSeqs, { count: 10, head: [22404, 22405, 22406], tail: [22411, 22412, 22413], truncated: true });
eq("graph: 短链给全", traced.replacementChain, { count: 2, items: [530395, 1066440], truncated: false });
eq("graph: full=true 给完整数组", (await graph({ session: LIVE_ID, seq: 4, full: true })).sourceEventSeqs.items.length, 10);
eq("graph: 只给 session 给谱系", (await graph({ session: LIVE_ID })).complete, true);

/* ---------------- 读取路径:observeSession(0.1.6 官方路径)与兼容退路 ---------------- */
check("reads go through sessionQuery.observeSession", observations.opened > 0, JSON.stringify(observations));
eq("every observation is disposed", observations.disposed, observations.opened);

// 没有 sessionQuery.observeSession 的老部署:退回内存快照 / persistence 句柄
const fallbackRegistered = new Map();
apply(strictCtx({
  tools: {
    register(tool) {
      fallbackRegistered.set(tool.name, tool);
      return () => {};
    },
  },
  on: noopOn,
  effect(callback) {
    return callback();
  },
  get(name) {
    if (name === "sessionQuery") return { async listSessions() { return fakeQuery.listSessions(); } };
    return services[name];
  },
}), {});
const fallbackFind = await fallbackRegistered.get("trajectory_search").execute({ view: "events", session: LIVE_ID, query: "fs_not_observed" }, EXEC);
eq("events: 没有 observeSession 时退回内存快照", fallbackFind.hitCount, 2);
eq("events: 报出读取来源", fallbackFind.source, "live");

/* ---------------- 可选功能:压缩后对账 ---------------- */

// 每个用例起一份干净的 ctx:只关心「压缩 → 收尾点 → 注入」这条线。
function reconcileHarness(config) {
  const seen = new Map();
  const steers = [];
  const logs = [];
  const harnessCtx = {
    tools: {
      register() {
        return () => {};
      },
    },
    on(type, handler) {
      if (!seen.has(type)) seen.set(type, []);
      seen.get(type).push(handler);
      return () => {};
    },
    effect(callback) {
      return callback();
    },
    get(name) {
      return name === "skills" ? undefined : services[name];
    },
    logger: {
      info: (message) => logs.push(["info", message]),
      warn: (message) => logs.push(["warn", message]),
    },
  };
  apply(strictCtx(harnessCtx), config);
  return {
    seen,
    steers,
    logs,
    fire(type, ...args) {
      for (const handler of (seen.get(type) || []).slice()) handler(...args);
    },
  };
}

const RECONCILE_SESSION = { id: "session-reconcile-1", header: { id: "session-reconcile-1" } };
const CHILD_SESSION = { id: "session-reconcile-child", header: { id: "session-reconcile-child", origin: "subagent" } };
const forkSession = { id: "session-reconcile-fork", header: { id: "session-reconcile-fork", parentSession: "session-reconcile-1" } };
const agentFor = (session, sink) => ({ session, steer: (message) => sink.push(message) });
const compactionEnd = (data) => ({ seq: 9, type: "compaction/end", time: 9000, data: data || {} });

// 没压缩过就不说话:收尾点每轮都会触发,沉默是常态。
const quiet = reconcileHarness(undefined);
quiet.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, quiet.steers) });
eq("reconcile: 没压缩过不注入", quiet.steers.length, 0);

// 压缩成功后,这一轮收尾时注入一句,形态是 plugin notice。
const base = reconcileHarness(undefined);
base.fire("session/event", RECONCILE_SESSION, compactionEnd());
base.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, base.steers) });
eq("reconcile: 压缩后收尾点注入一句", base.steers.length, 1);
const notice = base.steers[0] || {};
eq("reconcile: 是 user 角色", notice.role, "user");
eq("reconcile: 正文是默认那句话", notice.content && notice.content[0] && notice.content[0].text, DEFAULT_RECONCILE_SENTENCE);
eq("reconcile: 声明来源是插件", notice.source && notice.source.plugin, "dsh-trajectory-tools");
eq("reconcile: 形态是 notice(人读 summary)", notice.source && notice.source.form, "notice");
check("reconcile: 带一句给人看的 summary", typeof (notice.source || {}).summary === "string" && notice.source.summary.length > 0);
check("reconcile: 消息 id 非空", typeof notice.id === "string" && notice.id.length > 0);
check("reconcile: 消息冻结(与 DSH createUserMessage 同形)", Object.isFrozen(notice) && Object.isFrozen(notice.content));
check("reconcile: 正文提到回查工具", DEFAULT_RECONCILE_SENTENCE.includes("trajectory_search"));
eq("reconcile: 注入时留一行 info", base.logs.length, 1);

// 一次压缩只对一次账:收尾点此后每轮都触发,记号已清。
base.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, base.steers) });
eq("reconcile: 同一次压缩不重复注入", base.steers.length, 1);

// 再压缩一次 = 再对一次账,且 id 不与上一条相同。
base.fire("session/event", RECONCILE_SESSION, compactionEnd());
base.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, base.steers) });
eq("reconcile: 新一次压缩再注入", base.steers.length, 2);
check("reconcile: 两次注入 id 不同", base.steers[0].id !== base.steers[1].id);

// 失败的压缩(带 error)没有换掉投影,不对账。
base.fire("session/event", RECONCILE_SESSION, compactionEnd({ error: { message: "no route" } }));
base.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, base.steers) });
eq("reconcile: 压缩失败不注入", base.steers.length, 2);

// 子代理会话:没有"跟我说一句"的对象。
const child = reconcileHarness(undefined);
child.fire("session/event", CHILD_SESSION, compactionEnd());
child.fire("session/event", forkSession, compactionEnd());
child.fire("agent/turn-stopping", { agent: agentFor(CHILD_SESSION, child.steers) });
child.fire("agent/turn-stopping", { agent: agentFor(forkSession, child.steers) });
eq("reconcile: 子会话不注入", child.steers.length, 0);

// 换一句话 / 关掉整个功能。
const custom = reconcileHarness({ reconcile: { sentence: "自定义一句" } });
custom.fire("session/event", RECONCILE_SESSION, compactionEnd());
custom.fire("agent/turn-stopping", { agent: agentFor(RECONCILE_SESSION, custom.steers) });
eq("reconcile: config.sentence 可换", custom.steers[0] && custom.steers[0].content[0].text, "自定义一句");
const off = reconcileHarness({ reconcile: false });
eq("reconcile: false 时不挂监听", off.seen.size, 0);
const offByObject = reconcileHarness({ reconcile: { enabled: false } });
eq("reconcile: enabled:false 时不挂监听", offByObject.seen.size, 0);

// 注入抛错不能冒泡:收尾点抛错会让这一轮以 error 收场。
const brittle = reconcileHarness(undefined);
brittle.fire("session/event", RECONCILE_SESSION, compactionEnd());
let escapedError = null;
try {
  brittle.fire("agent/turn-stopping", {
    agent: {
      session: RECONCILE_SESSION,
      steer() {
        throw new Error("inbox unavailable");
      },
    },
  });
} catch (error) {
  escapedError = error;
}
check("reconcile: steer 抛错被吞掉", escapedError === null);
check("reconcile: 抛错时留下 warn", brittle.logs.some(([level]) => level === "warn"));

// 缺 agent / 缺 steer 的旧内核:不抛,也不注入。
const bare = reconcileHarness(undefined);
bare.fire("session/event", RECONCILE_SESSION, compactionEnd());
bare.fire("agent/turn-stopping", {});
bare.fire("agent/turn-stopping", { agent: { session: RECONCILE_SESSION } });
eq("reconcile: 没有 steer 的内核不注入", bare.steers.length, 0);

// plugin notice 是"机器说的话",默认检索与目录统计都不该把它当人的事实。
check("isPluginContext: 认 plugin 来源", isPluginContext({ data: { source: { kind: "plugin", plugin: "x" } } }) === true);
check("isPluginContext: 不认人的消息", isPluginContext({ data: { source: { kind: "user" } } }) === false);
check("isPluginContext: 认 tool/result 里的 message.source", isPluginContext({ data: { message: { source: { kind: "plugin" } } } }) === true);
const noticeEvents = [
  { seq: 0, type: "user/message", time: 1, data: reconcileMessage("reconcile-marker", "notice-1") },
  { seq: 1, type: "user/message", time: 2, data: { id: "human-1", role: "user", content: [{ type: "text", text: "reconcile-marker 是人说的" }], source: { kind: "user" } } },
];
eq("对账通知不计入目录统计,人说的同一句话计入", indexEvents(noticeEvents).semanticEvents, 1);
const NOTICE_ID = "session-notice-0005";
HEADERS.set(NOTICE_ID, { id: NOTICE_ID, createdAt: 9000, cwd: "C:/notice" });
LOGS.set(NOTICE_ID, noticeEvents);
LIVE_IDS.add(NOTICE_ID);
const noticeSearch = await registered.get("trajectory_search").execute({ view: "events", session: NOTICE_ID, query: "reconcile-marker" });
eq("对账通知默认检索不到,只命中人说的那条", noticeSearch.hitCount, 1);
eq("对账通知默认不计入注入过滤之外", noticeSearch.filtered.injected, 1);
const noticeAll = await registered.get("trajectory_search").execute({ view: "events", session: NOTICE_ID, query: "reconcile-marker", filter: { excludeInjected: false } });
eq("excludeInjected:false 时通知查得到(可核实是哪一轮)", noticeAll.hitCount, 2);

/* ---------------- 输出契约:必须是 lossless JSON ---------------- */

// 每个入口的返回值都过一遍;一旦哪个字段是 undefined,运行时会拒收整个输出。
const outputs = {
  "events(带 query)": await search({ view: "events", query: "facade" }),
  "events(带 session)": await search({ view: "events", session: LIVE_ID, query: "fs_not_observed" }),
  "events(空结果)": await search({ view: "events", query: "nothing-matches-this" }),
  "events(报错路径)": await search({ view: "events", filter: { nope: 1 } }),
  catalog: await search({ view: "catalog" }),
  "catalog(显式 session)": scopedCatalog,
  sessions: sessions,
  "sessions(liveOnly)": await search({ view: "sessions", filter: { liveOnly: true } }),
  cost: await search({ view: "cost", session: COST_ID }),
  read: await read({ session: LIVE_ID, seq: 4 }),
  graph: await graph({ session: LIVE_ID, seq: 4 }),
  "graph(会话谱系)": await graph({ session: LIVE_ID }),
};
for (const [name, value] of Object.entries(outputs)) {
  const hit = lossless(value);
  check("lossless JSON: " + name, hit === null, hit === null ? "" : "undefined/非有限数在 " + hit);
}

/* ---------------- 结果 ---------------- */
if (failures.length === 0) {
  console.log("ALL PASS (" + passed + " checks)");
} else {
  console.error("FAILED " + failures.length + "/" + (passed + failures.length) + ":");
  for (const failure of failures) console.error("  - " + failure);
  process.exitCode = 1;
}
