// dsh-trajectory-tools — 面向模型的会话轨迹查询工具(host-only, 只读)。
//
// 为什么存在:DSH 已经把过去完整存进了 append-only 事件日志,但模型平时只看到投影后的
// 消息历史与工具结果。一旦内容被 compaction 覆盖、或事情发生在很久以前/别的会话/子代理,
// 模型只能靠记忆或让用户复述。本插件把日志本身变成模型可查的事实源:
//
//   trajectory_search  查事实与数字:会话清单 / 会话目录 / 事件命中 / token 成本(view 区分)
//   trajectory_read    按 (session, seq 区间) 逐字取原文
//   trajectory_graph   事件替换/引用/派生链 + 会话谱系
//
// 原则(与 skill/trajectory-query.md 一致):
//   1. 只读:不写入、不改写任何事件;返回文本逐字来自日志。
//   2. 事实与解释分离:工具只给"事实 + 指针",解释交给模型。
//   3. 空结果 = 可验证的"没有":查不到就是日志里没有,不做语义补全。
//   4. seq 只在同一份日志修订内稳定,引用必须带 logId。
//
// 数据来源优先级(不用 readSession:它会 replay 校验整份日志):
//   首选 → ctx.sessionQuery.observeSession(id)(官方路径;live 优先、冷启动可复用观察缓存;
//          DSH 0.1.6 起 Session 的同步读取 snapshotEvents()/eventAt() 已弃用,禁止新增调用)
//   退路 → ctx.sessionPersistence.open(id, "read") → handle.read() → close()
//   再退 → sessionPersistence.inspect()(旧版后端)
//   末选 → ctx.sessions.get(id).snapshotEvents()(仅当部署里没有 sessionQuery 时的兼容退路)

import { createHash } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SKILL_BODY, SKILL_DESCRIPTION, SKILL_NAME, SKILL_WHEN_TO_USE } from "./skill.js";

export const inject = ["tools"];

const MAX_WINDOW = 60;
const DEFAULT_ROWS = 10;
const MAX_ROWS = 100;
const TRACE_EDGE = 3;
const LOAD_TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------ *
 * 事件文本:与 DSH 语义文档一致的可检索文本(逐字,不改写)
 * ------------------------------------------------------------------ */

function contentText(content) {
  if (!Array.isArray(content)) return "";
  const out = [];
  for (const block of content) blockText(block, out);
  return joinParts(out);
}

function blockText(block, out) {
  if (!block || typeof block !== "object") return;
  switch (block.type) {
    case "text":
      if (typeof block.text === "string") out.push(block.text);
      break;
    case "reasoning":
      break;
    case "tool-call":
      out.push(block.name, typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments));
      break;
    case "tool-result":
      if (Array.isArray(block.content)) for (const nested of block.content) blockText(nested, out);
      break;
    default:
      break;
  }
}

function turnEndText(reason) {
  if (!reason) return "";
  switch (reason.kind) {
    case "error":
      return joinParts(["error", reason.error && reason.error.message]);
    case "aborted":
      return "aborted";
    case "max-tokens":
    case "interrupted":
      return reason.kind;
    default:
      return "";
  }
}

function joinParts(parts) {
  return (parts || [])
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
    .map((part) => String(part).trim())
    .join("\n");
}

/** 单个事件的可检索文本(空字符串表示该事件没有语义文本)。 */
export function eventText(event) {
  const data = event && event.data;
  if (!data) return "";
  switch (event.type) {
    case "user/message":
      return contentText(data.content);
    case "assistant/message":
      return contentText(data.message && data.message.content);
    case "tool/call":
      return joinParts([data.name, typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments)]);
    case "tool/result":
      return joinParts([
        contentText(data.message && data.message.content),
        data.error && data.error.name,
        data.error && data.error.code,
      ]);
    case "todo/write":
      return (data.todos || []).map((todo) => joinParts([todo && todo.status, todo && todo.content])).join("\n");
    case "turn/end":
      return turnEndText(data.reason);
    default:
      return "";
  }
}

function clip(value, max) {
  const text = String(value === undefined || value === null ? "" : value);
  return text.length <= max ? text : text.slice(0, max) + "…[+truncated]";
}

/**
 * 以命中点为中心截取片段:保证命中一定完整落在返回的 text 里。
 * 定位分两步:先按原文 indexOf(快路径),失败再用 needle 编译的正则找回原文里的真实位置
 * (空白弹性;normalize 时连续反斜杠与中英文引号也等价)。返回的 text 始终是原文 verbatim。
 * 查询词本身比预算还长时,窗口按查询词长度放宽,不截断查询词。
 */
export function clipAround(value, needle, budget = 400, normalize = true) {
  const source = String(value === undefined || value === null ? "" : value);
  const located = needle ? locateInText(source, needle, normalize) : null;
  if (located === null) return { text: clip(source, budget), matchAt: -1 };
  const needleLength = located.end - located.start;
  const window = Math.min(source.length, Math.max(budget, needleLength + 2));
  let start = Math.max(0, located.start - Math.max(0, Math.floor((window - needleLength) / 2)));
  let end = start + window;
  if (end > source.length) {
    end = source.length;
    start = Math.max(0, end - window);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return { text: prefix + source.slice(start, end) + suffix, matchAt: prefix.length + (located.start - start) };
}

/**
 * 把查询词编译成能匹配「原文」的正则源:
 * 空白串 → \s+,连续反斜杠 → 一个或多个(或字面),中英文引号互认,其余字符转义。
 */
function needlePattern(needle, normalize) {
  let out = "";
  for (let index = 0; index < needle.length; index++) {
    const char = needle[index];
    if (/\s/.test(char)) {
      while (index + 1 < needle.length && /\s/.test(needle[index + 1])) index++;
      out += "\\s+";
      continue;
    }
    if (char === "\\") {
      while (index + 1 < needle.length && needle[index + 1] === "\\") index++;
      out += normalize ? "\\\\+" : "\\\\";
      continue;
    }
    if (normalize && char === '"') {
      out += '["\u201C\u201D]';
      continue;
    }
    if (normalize && char === "'") {
      out += "['\u2018\u2019]";
      continue;
    }
    out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

function locateInText(source, needle, normalize) {
  const direct = source.toLowerCase().indexOf(needle.toLowerCase());
  if (direct >= 0) return { start: direct, end: direct + needle.length };
  const pattern = needlePattern(needle, normalize);
  if (pattern === "") return null;
  const found = new RegExp(pattern, "i").exec(source);
  if (found === null) return null;
  return { start: found.index, end: found.index + found[0].length };
}

/** 注入样板(workspace 指令等)的固定前缀。 */
const INJECTED_PREFIX = "<system-reminder>";

export function isInjectedText(text) {
  return String(text === undefined || text === null ? "" : text).trimStart().startsWith(INJECTED_PREFIX);
}

export function isTrajectoryTool(name) {
  return typeof name === "string" && name.startsWith("trajectory_");
}

/** 收集 trajectory_* 工具的 callId,用于把对应的 tool/result 一并排除。 */
export function buildSelfCallIds(events) {
  const ids = new Set();
  for (const event of events || []) {
    if (!event || event.type !== "tool/call") continue;
    const data = event.data || {};
    if (isTrajectoryTool(data.name) && data.callId !== undefined) ids.add(String(data.callId));
  }
  return ids;
}

/**
 * 是否由 trajectory_* 自己产生:工具调用、对应结果,以及「只含 trajectory_* 调用块、
 * 没有其它内容」的助手消息(模型只是在请求这次查询)。
 */
export function isSelfEvent(event, selfCallIds) {
  const data = (event && event.data) || {};
  if (event.type === "tool/call") return isTrajectoryTool(data.name);
  if (event.type === "tool/result") {
    const message = data.message || {};
    const callId = (message.source && message.source.callId) || firstToolResultCallId(message);
    return callId !== undefined && selfCallIds instanceof Set && selfCallIds.has(String(callId));
  }
  if (event.type === "assistant/message") {
    const blocks = (data.message && data.message.content) || [];
    let own = 0;
    let other = 0;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "reasoning") continue;
      if (block.type === "tool-call") {
        if (isTrajectoryTool(block.name)) own++;
        else other++;
      } else if (block.type === "text") {
        if (String(block.text || "").trim() !== "") other++;
      } else {
        other++;
      }
    }
    return own > 0 && other === 0;
  }
  return false;
}

function firstToolResultCallId(message) {
  for (const block of (message && message.content) || []) {
    if (block && block.type === "tool-result" && block.toolCallId !== undefined) return block.toolCallId;
  }
  return undefined;
}

/** 折叠空白,让换行/多空格与单空格等价(大小写不敏感)。 */
export function fold(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 归一化(issue #1):在 fold 之上再折叠连续反斜杠、统一中英文引号。
 * 只在「匹配」时使用,查询与事件文本两侧同时归一;返回给模型的引文仍是原文 verbatim。
 * 代价是 `\\` 与 `\` 等价 —— 对「找回过去的事实」可接受。
 */
export function norm(text) {
  return fold(text)
    .replace(/\\+/g, "\\")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

/** 关系链的有界渲染(issue #2):默认计数 + 首尾,full 时返回完整数组。 */
export function boundSeqs(values, full = false) {
  const list = Array.isArray(values) ? values : [];
  if (full) return { count: list.length, items: list };
  if (list.length <= TRACE_EDGE * 2) return { count: list.length, items: list, truncated: false };
  return { count: list.length, head: list.slice(0, TRACE_EDGE), tail: list.slice(-TRACE_EDGE), truncated: true };
}

/* ------------------------------------------------------------------ *
 * 日志身份:(session, seq) 只有配 logId 才能定位到唯一一份日志修订
 * ------------------------------------------------------------------ */

/**
 * 日志身份,append-stable:只取首事件(seq/type/time)。
 * 追加事件不改变它;整份日志被重写才可能改变。
 */
export function logIdOf(sessionId, first) {
  const parts = [sessionId, first ? first.seq : -1, first ? first.type : "", first ? first.time : 0].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 12);
}

function firstEventOf(events) {
  return (events || []).find((event) => event && typeof event.seq === "number") || null;
}

function lastEventOf(events) {
  const list = events || [];
  for (let index = list.length - 1; index >= 0; index--) {
    const event = list[index];
    if (event && typeof event.seq === "number") return event;
  }
  return null;
}

/** 完整日志身份(有全量事件时给出 seq 范围)。 */
export function logIdentity(sessionId, events) {
  const first = firstEventOf(events);
  const last = lastEventOf(events);
  return {
    id: logIdOf(sessionId, first),
    events: (events || []).length,
    minSeq: first ? first.seq : null,
    maxSeq: last ? last.seq : null,
  };
}

/* ------------------------------------------------------------------ *
 * 读取:存活会话走内存快照,已持久化会话走 read 句柄
 * ------------------------------------------------------------------ */

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ": 读取会话日志超时(" + ms + "ms)")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function liveSession(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  if (sessions === undefined || typeof sessions.get !== "function") return undefined;
  return sessions.get(sessionId);
}

/** 释放一次会话观察(SessionObservation 是 Disposable)。 */
function disposeObservation(observation) {
  if (observation === undefined || observation === null) return;
  const dispose = observation[Symbol.dispose] || observation.dispose;
  if (typeof dispose === "function") {
    try {
      dispose.call(observation);
    } catch {
      /* 释放尽力而为 */
    }
  }
}

/**
 * 读取整份事件日志。
 * 首选 ctx.sessionQuery.observeSession():官方路径(Session 的同步读取 `snapshotEvents()` /
 * `eventAt()` 自 DSH 0.1.6 起弃用、禁止新增调用),返回 live 优先、冷启动可复用的不可变快照。
 * 退路(按序):sessionPersistence 句柄 → 旧版 inspect() → 无 sessionQuery 时的内存快照。
 */
async function loadEvents(ctx, sessionId) {
  const query = ctx.get("sessionQuery");
  if (query !== undefined && typeof query.observeSession === "function") {
    const observation = await query.observeSession(sessionId);
    try {
      return {
        header: observation.header || null,
        events: observation.events || [],
        source: observation.source === "live" ? "live" : "persisted",
      };
    } finally {
      disposeObservation(observation);
    }
  }
  const persistence = ctx.get("sessionPersistence");
  // 兼容退路(仅当部署里没有 sessionQuery):存活会话以内存快照为准 —— 它比落盘副本新。
  const live = liveSession(ctx, sessionId);
  if (live !== undefined && typeof live.snapshotEvents === "function") {
    return { header: live.header || null, events: live.snapshotEvents() || [], source: "live" };
  }
  if (persistence !== undefined && typeof persistence.open === "function") {
    const handle = await persistence.open(sessionId, "read");
    try {
      const result = await handle.read();
      return { header: (handle && handle.header) || null, events: (result && result.events) || [], source: "persisted" };
    } finally {
      if (handle && typeof handle.close === "function") await handle.close();
    }
  }
  if (persistence !== undefined && typeof persistence.inspect === "function") {
    const inspected = await persistence.inspect(sessionId);
    return { header: (inspected && inspected.meta) || null, events: (inspected && inspected.events) || [], source: "persisted" };
  }
  throw new Error("没有可用的会话来源(sessionQuery / sessions / sessionPersistence)");
}

/**
 * 只读一段 seq 区间,另外补一个 seq 0 事件用于算 logId。
 * 冷会话(非存活)走 persistence 句柄切片读,不必整份物化;其余走 loadEvents 后截窗口。
 */
async function readWindow(ctx, sessionId, from, to) {
  const length = to - from + 1;
  const live = liveSession(ctx, sessionId);
  const persistence = ctx.get("sessionPersistence");
  if (live === undefined && persistence !== undefined && typeof persistence.open === "function") {
    const handle = await persistence.open(sessionId, "read");
    try {
      // 先读头部再读窗口:句柄的 read 不承诺可回退,顺序只向前。
      let first = null;
      if (from > 0) {
        const head = await handle.read(0, 1);
        first = firstEventOf((head && head.events) || []);
      }
      const slice = await handle.read(from, length);
      if (first === null) first = firstEventOf((slice && slice.events) || []);
      let eventCount = null;
      if (typeof persistence.stat === "function") {
        try {
          const snapshot = await persistence.stat(sessionId);
          if (snapshot && typeof snapshot.eventCount === "number") eventCount = snapshot.eventCount;
        } catch {
          /* 计数只是附加信息,拿不到就不给 */
        }
      }
      return {
        header: (handle && handle.header) || null,
        source: "persisted",
        events: (slice && slice.events) || [],
        first,
        total: eventCount,
      };
    } finally {
      if (handle && typeof handle.close === "function") await handle.close();
    }
  }
  const full = await loadEvents(ctx, sessionId);
  return {
    header: full.header,
    source: full.source,
    events: full.events.filter((event) => event && event.seq >= from && event.seq <= to),
    first: firstEventOf(full.events),
    total: full.events.length,
  };
}

/* ------------------------------------------------------------------ *
 * 会话清单
 * ------------------------------------------------------------------ */

function headerFields(header, live, persisted, current, lastEventTime) {
  const source = header || {};
  return {
    id: source.id || null,
    createdAt: source.createdAt === undefined ? null : source.createdAt,
    cwd: source.cwd || null,
    parentSession: source.parentSession || null,
    agentPreset: source.agentPreset || null,
    isSeeded: source.isSeeded === true,
    live,
    persisted,
    current: current === true,
    ...(lastEventTime === undefined || lastEventTime === null ? {} : { lastEventTime }),
  };
}

/** 当前会话 id:优先取工具执行上下文里的 agent,再退到 agents.currentInitiator()。 */
export function currentSessionId(ctx, exec) {
  const fromExec = exec && exec.agent && exec.agent.session && exec.agent.session.id;
  if (typeof fromExec === "string" && fromExec !== "") return fromExec;
  const agents = ctx.get("agents");
  const agent = agents !== undefined && typeof agents.currentInitiator === "function" ? agents.currentInitiator() : undefined;
  const id = agent && agent.session && agent.session.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * 会话清单,排序:当前会话 → live(最近事件时间降序)→ 已持久化(createdAt 降序)。
 * live 的 lastEventTime 走 observeSession(可复用观察缓存);已持久化会话没有便宜的最近活动信号,
 * 只能按 createdAt —— 这是已知局限,长会话请显式传 session。
 */
async function listSessions(ctx, currentId) {
  const query = ctx.get("sessionQuery");
  let records;
  if (query !== undefined && typeof query.listSessions === "function") {
    records = (await query.listSessions()).map((record) => ({
      header: record.header,
      live: record.live === true,
      persisted: record.persisted === true,
    }));
  } else {
    // 兜底:存活会话 + 持久化快照,按 id 合并(存活优先)。
    const byId = new Map();
    const persistence = ctx.get("sessionPersistence");
    if (persistence !== undefined && typeof persistence.list === "function") {
      for (const snapshot of (await persistence.list()) || []) {
        const header = (snapshot && snapshot.header) || null;
        if (header && header.id) byId.set(header.id, { header, live: false, persisted: true });
      }
    }
    const sessions = ctx.get("sessions");
    if (sessions !== undefined && typeof sessions.list === "function") {
      for (const session of sessions.list() || []) {
        const header = session.header || session;
        if (!header || !header.id) continue;
        const previous = byId.get(header.id);
        byId.set(header.id, { header, live: true, persisted: previous ? previous.persisted : false });
      }
    }
    records = [...byId.values()];
  }

  // live 会话的最近事件时间:走 observeSession(官方路径,可复用观察缓存)。
  // 拿不到就退化为 live 内部按 createdAt 排序,不阻塞列表。
  if (query !== undefined && typeof query.observeSession === "function") {
    for (const record of records) {
      if (!record.live) continue;
      try {
        const observation = await query.observeSession(record.header.id);
        try {
          const last = lastEventOf(observation.events);
          record.lastEventTime = last ? last.time : null;
        } finally {
          disposeObservation(observation);
        }
      } catch {
        /* 单个 live 会话取不到活动时间不影响列表 */
      }
    }
  }

  records.sort((a, b) => {
    const aCurrent = a.header.id === currentId;
    const bCurrent = b.header.id === currentId;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.live) {
      const delta = (b.lastEventTime || 0) - (a.lastEventTime || 0);
      if (delta !== 0) return delta;
    }
    return (b.header.createdAt || 0) - (a.header.createdAt || 0) || String(a.header.id).localeCompare(String(b.header.id));
  });

  return records.map((record) =>
    headerFields(record.header, record.live, record.persisted, record.header.id === currentId, record.lastEventTime),
  );
}

/**
 * 目录统计(issue #3):对一份事件日志做计数与范围统计,不返回任何内容。
 * 与 trajectory_search 的 events 视图共用同一套默认过滤(excludeInjected / excludeSelf)。
 */
export function indexEvents(events, options = {}) {
  const typeFilter = Array.isArray(options.typeFilter) ? options.typeFilter : [];
  const toolNeedle = String(options.toolNeedle === undefined || options.toolNeedle === null ? "" : options.toolNeedle).toLowerCase();
  const timeFrom = options.timeFrom === undefined || options.timeFrom === null ? null : Number(options.timeFrom);
  const timeTo = options.timeTo === undefined || options.timeTo === null ? null : Number(options.timeTo);

  const toolByCallId = new Map();
  for (const event of events || []) {
    if (event && event.type === "tool/call" && event.data && event.data.callId !== undefined) {
      toolByCallId.set(String(event.data.callId), String(event.data.name || ""));
    }
  }
  const selfCallIds = buildSelfCallIds(events);

  const byType = {};
  const byTool = {};
  let total = 0;
  let semantic = 0;
  let minSeq = null;
  let maxSeq = null;
  let minTime = null;
  let maxTime = null;

  for (const event of events || []) {
    if (!event || typeof event.seq !== "number") continue;
    if (typeFilter.length > 0 && !typeFilter.includes(event.type)) continue;
    if (timeFrom !== null && !(Number(event.time) >= timeFrom)) continue;
    if (timeTo !== null && !(Number(event.time) <= timeTo)) continue;
    if (isSelfEvent(event, selfCallIds)) continue;
    const text = eventText(event);
    if (isInjectedText(text)) continue;

    let toolName = null;
    if (event.type === "tool/call") {
      toolName = String((event.data && event.data.name) || "");
    } else if (event.type === "tool/result") {
      const message = (event.data && event.data.message) || {};
      const callId = (message.source && message.source.callId) || firstToolResultCallId(message);
      toolName = callId === undefined ? null : toolByCallId.get(String(callId)) || null;
    }
    if (toolNeedle !== "" && !(toolName !== null && toolName.toLowerCase().includes(toolNeedle))) continue;

    total++;
    if (text.trim() !== "") semantic++;
    byType[event.type] = (byType[event.type] || 0) + 1;
    if (event.type === "tool/call" && toolName) byTool[toolName] = (byTool[toolName] || 0) + 1;
    if (minSeq === null || event.seq < minSeq) minSeq = event.seq;
    if (maxSeq === null || event.seq > maxSeq) maxSeq = event.seq;
    const time = Number(event.time);
    if (Number.isFinite(time)) {
      if (minTime === null || time < minTime) minTime = time;
      if (maxTime === null || time > maxTime) maxTime = time;
    }
  }

  return {
    events: total,
    semanticEvents: semantic,
    byType,
    byTool,
    seqRange: minSeq === null ? null : [minSeq, maxSeq],
    timeRange: minTime === null ? null : [minTime, maxTime],
  };
}

/* ------------------------------------------------------------------ *
 * 成本:确定性地 fold assistant/message.usage(issue #5)
 *
 * 实测(真实 v3 会话 839 个 assistant/message):
 *   totalTokens === inputTokens + cacheReadTokens + outputTokens,837/837 全等;
 *   cacheWriteTokens 只有 26 条上报、reasoningTokens 811 条 —— 缺失是"没上报",不是 0。
 * 所以整个 usage 缺失的请求记 unknown,单字段缺失记 null,求和只加已上报的值。
 * 成本不套用 find 的自回显/样板过滤:那是"检索噪声"的概念,记账要记全量。
 * ------------------------------------------------------------------ */

function usageNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKnown(values) {
  let sum = null;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    sum = (sum || 0) + value;
  }
  return sum;
}

/** cache 效率 = cacheRead / (cacheRead + input);两侧都上报且分母 > 0 才给值。 */
export function cacheEfficiency(cacheRead, input) {
  if (cacheRead === null || input === null || cacheRead === undefined || input === undefined) return null;
  const denominator = cacheRead + input;
  return denominator > 0 ? cacheRead / denominator : null;
}

/** 逐请求抽取 usage;缺失即 unknown(不按 0)。 */
export function costRequests(events) {
  const requests = [];
  for (const event of events || []) {
    if (!event || event.type !== "assistant/message") continue;
    const data = event.data || {};
    const source = (data.message && data.message.source) || {};
    const usage = data.usage;
    const unknown = usage === undefined || usage === null || typeof usage !== "object";
    const row = {
      seq: event.seq,
      turn: typeof data.turn === "number" ? data.turn : null,
      step: typeof data.step === "number" ? data.step : null,
      provider: typeof source.provider === "string" ? source.provider : null,
      model: typeof source.model === "string" ? source.model : null,
      unknown,
      input: unknown ? null : usageNumber(usage.inputTokens),
      cacheRead: unknown ? null : usageNumber(usage.cacheReadTokens),
      cacheWrite: unknown ? null : usageNumber(usage.cacheWriteTokens),
      output: unknown ? null : usageNumber(usage.outputTokens),
      reasoning: unknown ? null : usageNumber(usage.reasoningTokens),
      total: unknown ? null : usageNumber(usage.totalTokens),
    };
    row.cacheEfficiency = cacheEfficiency(row.cacheRead, row.input);
    requests.push(row);
  }
  return requests;
}

/** 汇总一组请求:只加已上报的值;coverage 说明每个字段有多少请求报了。 */
export function costTotals(requests) {
  const rows = requests || [];
  const cacheRead = sumKnown(rows.map((row) => row.cacheRead));
  const input = sumKnown(rows.map((row) => row.input));
  return {
    requests: rows.length,
    unknownRequests: rows.filter((row) => row.unknown).length,
    input,
    cacheRead,
    cacheWrite: sumKnown(rows.map((row) => row.cacheWrite)),
    output: sumKnown(rows.map((row) => row.output)),
    reasoning: sumKnown(rows.map((row) => row.reasoning)),
    total: sumKnown(rows.map((row) => row.total)),
    cacheEfficiency: cacheEfficiency(cacheRead, input),
  };
}

export function costCoverage(requests) {
  const rows = requests || [];
  const reported = (field) => rows.filter((row) => row[field] !== null).length;
  return {
    input: reported("input"),
    cacheRead: reported("cacheRead"),
    cacheWrite: reported("cacheWrite"),
    output: reported("output"),
    reasoning: reported("reasoning"),
    total: reported("total"),
  };
}

/** 按 turn 汇总(没有 turn 的请求归到一个 turn:null 的桶)。 */
export function costByTurn(requests) {
  const groups = new Map();
  for (const row of requests || []) {
    const key = row.turn === null ? "null" : String(row.turn);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, list]) => ({
    turn: key === "null" ? null : Number(key),
    ...costTotals(list),
  }));
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const OUTPUT = {
  schema: { type: "json" },
  render(_args, value) {
    let text;
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
    return [{ type: "text", text }];
  },
};

const FAILED = (error) => ({ ok: false, error: String((error && error.message) || error) });

export function apply(ctx) {
  // 工具要么全注册、要么一个都不注册。重名会抛错(例如上一个进程里被 stop/undefine 的
  // 动态插件留下了同名注册),此时静默少注册会让模型拿到半个工具集,不如显式失败并给出重启提示。
  const disposers = [];
  const conflicts = [];
  const register = (spec) => {
    const tool = defineTool(spec); // 契约/语法错误属于代码 bug,直接抛
    try {
      const dispose = ctx.tools.register(tool);
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      conflicts.push(spec.name + " — " + String((error && error.message) || error));
    }
  };

  /* ------------------------------------------------------------------ *
   * 三个入口:search(查事实)/ read(取原文)/ graph(看关系)
   * 可选维度统一收进 filter 对象;键清单写在 filter 的描述里,未知键由这里报
   * (运行时只说 "not a declared property",不列可选项)。
   * ------------------------------------------------------------------ */

  const FILTER_KEYS = {
    events: ["types", "from", "to", "timeFrom", "timeTo", "sessionCount", "normalize", "excludeInjected", "excludeSelf"],
    catalog: ["cwd", "timeFrom", "timeTo", "type", "tool"],
    cost: ["from", "to", "groupBy"],
    sessions: ["liveOnly"],
  };

  function takeFilter(raw, view) {
    if (raw === undefined || raw === null) return { filter: {} };
    if (typeof raw !== "object" || Array.isArray(raw)) return { error: "filter 需要是对象;view=" + view + " 可用:" + FILTER_KEYS[view].join(", ") };
    const unknown = Object.keys(raw).filter((key) => !FILTER_KEYS[view].includes(key));
    if (unknown.length > 0) {
      const owners = Object.keys(FILTER_KEYS).filter((candidate) => candidate !== view && unknown.every((key) => FILTER_KEYS[candidate].includes(key)));
      const hint = owners.length === 1 ? ";这些键属于 view=" + owners[0] : "";
      return { error: "filter." + unknown.join(", filter.") + " 对 view=" + view + " 无效" + hint + ";view=" + view + " 可用:" + FILTER_KEYS[view].join(", ") };
    }
    return { filter: raw };
  }

  function rowLimit(args, fallback) {
    return Math.min(Math.max(Number(args.limit || fallback), 1), MAX_ROWS);
  }

  /* ---------------- view=events:字面检索 ---------------- */
  async function searchEvents(args, exec, filter) {
    const limit = rowLimit(args, DEFAULT_ROWS);
    const needle = typeof args.query === "string" ? args.query.trim() : "";
    const types = Array.isArray(filter.types) ? filter.types.map((type) => String(type)) : [];
    const hasRange = filter.from !== undefined || filter.to !== undefined || filter.timeFrom !== undefined || filter.timeTo !== undefined;
    if (!needle && types.length === 0 && !hasRange) {
      return { ok: false, error: "view=events 需要 query,或 filter 里的 types/from/to/timeFrom/timeTo" };
    }
    const excludeInjected = filter.excludeInjected !== false;
    const excludeSelf = filter.excludeSelf !== false;
    const normalize = filter.normalize !== false;
    const needleKey = needle ? (normalize ? norm(needle) : fold(needle)) : "";

    const scan = (events) => {
      const selfCallIds = excludeSelf ? buildSelfCallIds(events) : null;
      const hits = [];
      const filtered = { injected: 0, self: 0 };
      for (const event of events || []) {
        if (!event || typeof event.seq !== "number") continue;
        if (types.length > 0 && !types.includes(event.type)) continue;
        if (filter.from !== undefined && event.seq < Number(filter.from)) continue;
        if (filter.to !== undefined && event.seq > Number(filter.to)) continue;
        if (filter.timeFrom !== undefined && !(Number(event.time) >= Number(filter.timeFrom))) continue;
        if (filter.timeTo !== undefined && !(Number(event.time) <= Number(filter.timeTo))) continue;
        const text = eventText(event);
        if (needleKey && !(normalize ? norm(text) : fold(text)).includes(needleKey)) continue;
        if (excludeInjected && isInjectedText(text)) {
          filtered.injected++;
          continue;
        }
        if (excludeSelf && isSelfEvent(event, selfCallIds)) {
          filtered.self++;
          continue;
        }
        hits.push({ event, text });
      }
      return { hits, filtered };
    };

    const toItem = (sessionId, hit, logId) => {
      const snippet = clipAround(hit.text, needle, 400, normalize);
      return {
        session: sessionId,
        seq: hit.event.seq,
        type: hit.event.type,
        time: hit.event.time,
        log: logId,
        text: snippet.text,
        matchAt: snippet.matchAt,
      };
    };

    try {
      if (args.session) {
        const sessionId = String(args.session);
        const loaded = await withTimeout(loadEvents(ctx, sessionId), LOAD_TIMEOUT_MS, "trajectory_search");
        const { hits, filtered } = scan(loaded.events);
        const log = logIdentity(sessionId, loaded.events);
        return {
          ok: true,
          view: "events",
          session: sessionId,
          source: loaded.source,
          log,
          hitCount: hits.length,
          returned: Math.min(hits.length, limit),
          normalized: normalize,
          filtered,
          items: hits.slice(0, limit).map((hit) => toItem(sessionId, hit, log.id)),
        };
      }

      const currentId = currentSessionId(ctx, exec);
      const sessionCount = Math.min(Math.max(Number(filter.sessionCount || 3), 1), 10);
      const all = await listSessions(ctx, currentId);
      const always = all.filter((record) => record.current === true || record.live === true);
      const alwaysIds = new Set(always.map((record) => record.id));
      const extra = all.filter((record) => !alwaysIds.has(record.id)).slice(0, sessionCount);
      const targets = [...always, ...extra];

      const items = [];
      let scanned = 0;
      let failures = 0;
      const filteredTotal = { injected: 0, self: 0 };
      for (const target of targets) {
        if (items.length >= limit) break;
        scanned++;
        try {
          const loaded = await withTimeout(loadEvents(ctx, target.id), LOAD_TIMEOUT_MS, "trajectory_search");
          const log = logIdentity(target.id, loaded.events);
          const { hits, filtered } = scan(loaded.events);
          filteredTotal.injected += filtered.injected;
          filteredTotal.self += filtered.self;
          for (const hit of hits) {
            if (items.length >= limit) break;
            items.push(toItem(target.id, hit, log.id));
          }
        } catch {
          failures++;
        }
      }
      return {
        ok: true,
        view: "events",
        current: currentId || null,
        scanned,
        failed: failures,
        targets: targets.map((record) => record.id),
        returned: items.length,
        normalized: normalize,
        filtered: filteredTotal,
        items,
      };
    } catch (error) {
      return FAILED(error);
    }
  }

  /* ---------------- view=catalog:计数与范围 ---------------- */
  async function catalogView(args, exec, filter) {
    const limit = rowLimit(args, DEFAULT_ROWS);
    try {
      const currentId = currentSessionId(ctx, exec);
      const all = typeof args.session === "string" && args.session !== "" ? null : await listSessions(ctx, currentId);
      const typeFilter = Array.isArray(filter.type) ? filter.type.map((value) => String(value)) : [];
      const toolNeedle = typeof filter.tool === "string" ? filter.tool.trim().toLowerCase() : "";
      let candidates;
      if (all === null) {
        candidates = [{ id: String(args.session), cwd: null, current: false, live: undefined, persisted: undefined }];
      } else {
        const cwdNeedle = typeof filter.cwd === "string" ? filter.cwd.trim().toLowerCase() : "";
        candidates = cwdNeedle === "" ? all : all.filter((record) => String(record.cwd || "").toLowerCase().includes(cwdNeedle));
      }
      const sessions = [];
      let scanned = 0;
      let failed = 0;
      for (const record of candidates) {
        if (sessions.length >= limit) break;
        scanned++;
        try {
          const loaded = await withTimeout(loadEvents(ctx, record.id), LOAD_TIMEOUT_MS, "trajectory_search");
          const stats = indexEvents(loaded.events, {
            typeFilter,
            toolNeedle,
            timeFrom: filter.timeFrom,
            timeTo: filter.timeTo,
          });
          sessions.push({
            session: record.id,
            cwd: record.cwd,
            current: record.current === true,
            live: record.live,
            persisted: record.persisted,
            log: logIdentity(record.id, loaded.events).id,
            ...stats,
          });
        } catch {
          failed++;
        }
      }
      return { ok: true, view: "catalog", current: currentId || null, scanned, failed, returned: sessions.length, sessions };
    } catch (error) {
      return FAILED(error);
    }
  }

  /* ---------------- view=sessions:可查会话 ---------------- */
  async function sessionsView(args, exec, filter) {
    try {
      const limit = rowLimit(args, DEFAULT_ROWS);
      const currentId = currentSessionId(ctx, exec);
      const all = await listSessions(ctx, currentId);
      const filtered = filter.liveOnly === true ? all.filter((item) => item.live) : all;
      return {
        ok: true,
        view: "sessions",
        current: currentId || null,
        total: all.length,
        returned: Math.min(filtered.length, limit),
        items: filtered.slice(0, limit),
      };
    } catch (error) {
      return FAILED(error);
    }
  }

  /* ---------------- view=cost:token 成本 ---------------- */
  async function costView(args, exec, filter) {
    const limit = rowLimit(args, DEFAULT_ROWS);
    try {
      const groupBy = filter.groupBy === "turn" ? "turn" : "request";
      const sessionId = typeof args.session === "string" && args.session !== "" ? args.session : currentSessionId(ctx, exec);
      if (sessionId === undefined) return { ok: false, error: "需要 session(当前会话无法确定)" };
      const loaded = await withTimeout(loadEvents(ctx, sessionId), LOAD_TIMEOUT_MS, "trajectory_search");
      const scoped = filter.from === undefined && filter.to === undefined
        ? loaded.events
        : (loaded.events || []).filter((event) => {
            if (!event || typeof event.seq !== "number") return false;
            if (filter.from !== undefined && event.seq < Number(filter.from)) return false;
            if (filter.to !== undefined && event.seq > Number(filter.to)) return false;
            return true;
          });
      const requests = costRequests(scoped);
      const totals = costTotals(requests);
      const rows = groupBy === "turn" ? costByTurn(requests) : requests;
      return {
        ok: true,
        view: "cost",
        session: sessionId,
        log: logIdentity(sessionId, loaded.events),
        groupBy,
        requestCount: totals.requests,
        unknownRequests: totals.unknownRequests,
        coverage: costCoverage(requests),
        totals,
        rowCount: rows.length,
        returned: Math.min(rows.length, limit),
        truncated: rows.length > limit,
        rows: rows.slice(0, limit),
      };
    } catch (error) {
      return FAILED(error);
    }
  }

  async function runSearch(args, exec) {
    const view = args.view;
    const taken = takeFilter(args.filter, view);
    if (taken.error !== undefined) return { ok: false, error: taken.error };
    if (view === "events") return searchEvents(args, exec, taken.filter);
    if (view === "cost") return costView(args, exec, taken.filter);
    if (view === "sessions") return sessionsView(args, exec, taken.filter);
    return catalogView(args, exec, taken.filter);
  }

  /* ---------------- read:逐字取原文 ---------------- */
  async function runRead(args) {
    try {
      const sessionId = String(args.session);
      let from;
      let to;
      if (args.seq !== undefined && args.seq !== null) {
        const center = Number(args.seq);
        from = Math.max(0, center - 5);
        to = center + 5;
      } else {
        from = Number(args.from);
        to = Number(args.to);
        if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, error: "需要 from/to 或 seq" };
      }
      if (from > to) return { ok: false, error: "from 不能大于 to" };
      if (to - from + 1 > MAX_WINDOW) {
        return { ok: false, error: "窗口超过 " + MAX_WINDOW + " 事件上限,请缩小范围", window: { from, to } };
      }
      const window = await withTimeout(readWindow(ctx, sessionId, Math.max(from, 0), to), LOAD_TIMEOUT_MS, "trajectory_read");
      const rows = [];
      for (const event of window.events) {
        const text = eventText(event);
        if (args.raw === true || text) {
          rows.push({ seq: event.seq, type: event.type, time: event.time, text: clip(text, 4000) });
        }
      }
      return {
        ok: true,
        session: sessionId,
        source: window.source,
        log: { id: logIdOf(sessionId, window.first), eventCount: window.total === undefined ? null : window.total },
        requested: { from, to },
        returned: rows.length,
        events: rows,
      };
    } catch (error) {
      return FAILED(error);
    }
  }

  /* ---------------- graph:关系链 ---------------- */
  async function runGraph(args) {
    try {
      const query = ctx.get("sessionQuery");
      if (query === undefined) return { ok: false, error: "sessionQuery 服务不可用" };
      const sessionId = String(args.session);
      const full = args.full === true;
      if (args.seq !== undefined && args.seq !== null) {
        const traced = await query.traceEvent({ sessionId, seq: Number(args.seq) });
        const target = traced.target || {};
        return {
          ok: true,
          session: sessionId,
          target: { seq: target.seq, type: target.type, time: target.time, surface: target.surface },
          replacedBy: traced.replacedBy === undefined ? null : traced.replacedBy,
          replacementChain: boundSeqs(traced.replacementChain, full),
          replacedEventSeqs: boundSeqs(traced.replacedEventSeqs, full),
          sourceEventSeqs: boundSeqs(traced.sourceEventSeqs, full),
          derivedEventSeqs: boundSeqs(traced.derivedEventSeqs, full),
          full,
        };
      }
      const traced = await query.traceSession(sessionId);
      const node = (item) => ({
        id: item.session.header.id,
        live: item.session.live,
        persisted: item.session.persisted,
        descendants: (item.descendants || []).map(node),
      });
      return {
        ok: true,
        target: sessionId,
        complete: traced.complete,
        ancestors: (traced.ancestors || []).map((record) => record.header.id),
        descendants: (traced.descendants || []).map(node),
      };
    } catch (error) {
      return FAILED(error);
    }
  }

  register({
    name: "trajectory_search",
    description:
      "查会话日志里的事实与数字,不取完整原文。返回位置 (session, seq@logId) 与逐字片段;空结果=日志里没有,不要用常识补。",
    parameters: {
      view: { type: "string", required: true, enum: ["events", "catalog", "sessions", "cost"], description: "events=搜事件;catalog=计数与范围;cost=token 成本;sessions=会话列表" },
      session: { type: "string", description: "会话 id;省略时 events 覆盖当前会话+live+最近若干" },
      query: { type: "string", description: "字面词(view=events)" },
      filter: { type: "object", additionalProperties: true, description: "按 view 生效。events: types,from,to,timeFrom,timeTo,sessionCount,normalize,excludeInjected,excludeSelf;catalog: cwd,timeFrom,timeTo,type,tool;cost: from,to,groupBy;sessions: liveOnly" },
      limit: { type: "integer", description: "行数上限,默认 " + DEFAULT_ROWS },
    },
    output: OUTPUT,
    execute: (args, exec) => runSearch(args, exec),
  });

  register({
    name: "trajectory_read",
    description:
      "按 (session, seq 区间) 逐字取原文(消息/工具调用/结果),用于核实 search 命中或看上下文。默认只给有正文的事件;窗口上限 " + MAX_WINDOW + " 个事件。",
    parameters: {
      session: { type: "string", required: true, description: "会话 id" },
      seq: { type: "integer", description: "中心 seq,取前后各 5 个" },
      from: { type: "integer", description: "起始 seq(含)" },
      to: { type: "integer", description: "结束 seq(含)" },
      raw: { type: "boolean", description: "true=区间内全部事件" },
    },
    output: OUTPUT,
    execute: (args) => runRead(args),
  });

  register({
    name: "trajectory_graph",
    description:
      "事件或会话之间的关系:给 seq 看该事件的替换/引用/派生链,只给 session 看谱系(祖先/子会话/子代理)。链默认只给计数与首尾,full=true 给完整数组。",
    parameters: {
      session: { type: "string", required: true, description: "会话 id" },
      seq: { type: "integer", description: "事件 seq;缺省返回会话谱系" },
      full: { type: "boolean", description: "true=完整链" },
    },
    output: OUTPUT,
    execute: (args) => runGraph(args),
  });

  if (conflicts.length > 0) {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* 回滚尽力而为 */
      }
    }
    throw new Error(
      "dsh-trajectory-tools: 工具名已被占用,全部工具都不注册(" +
        conflicts.join("; ") +
        ")。常见原因:上一个进程里被 stop/undefine 的动态插件留下了同名注册。重启 dsh web 后即可恢复。",
    );
  }
  for (const dispose of disposers) ctx.effect(() => dispose, "trajectory-tools:tool");

  // 查询纪律随工具一起注册(runtime skill,无需改 agent preset);skills 服务缺失时不影响工具。
  const skills = ctx.get("skills");
  if (skills !== undefined && typeof skills.register === "function") {
    const disposeSkill = skills.register({
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      whenToUse: SKILL_WHEN_TO_USE,
      source: "runtime",
      content: SKILL_BODY,
    });
    if (typeof disposeSkill === "function") ctx.effect(() => disposeSkill, "trajectory-tools:skill");
  }
}
