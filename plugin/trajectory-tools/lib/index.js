// dsh-trajectory-tools — 面向模型的会话轨迹查询工具(host-only, 只读)。
//
// 为什么存在:DSH 已经把过去完整存进了 append-only 事件日志,但模型平时只看到投影后的
// 消息历史与工具结果。一旦内容被 compaction 覆盖、或事情发生在很久以前/别的会话/子代理,
// 模型只能靠记忆或让用户复述。本插件把日志本身变成模型可查的事实源:
//
//   trajectory_sessions  列出可查会话(先拿 session id)
//   trajectory_find      字面量子串检索事件 → (session, seq, type, time) + 逐字片段
//   trajectory_window    按 (session, seq 区间) 取原文窗口
//   trajectory_trace     事件替换/引用/派生链 + 会话谱系
//
// 原则(与 skill/trajectory-query.md 一致):
//   1. 只读:不写入、不改写任何事件;返回文本逐字来自日志。
//   2. 事实与解释分离:工具只给"事实 + 指针",解释交给模型。
//   3. 空结果 = 可验证的"没有":查不到就是日志里没有,不做语义补全。
//   4. seq 只在同一份日志修订内稳定,引用必须带 logId。
//
// 数据来源优先级(不依赖 sessionQuery,避免 readSession 的 replay 校验开销):
//   存活会话 → ctx.sessions.get(id).snapshotEvents()
//   已持久化 → ctx.sessionPersistence.open(id, "read") → handle.read() → close()
//   (旧版后端兜底:sessionPersistence.inspect())

import { createHash } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SKILL_BODY, SKILL_DESCRIPTION, SKILL_NAME, SKILL_WHEN_TO_USE } from "./skill.js";

export const inject = ["tools"];

const MAX_WINDOW = 60;
const MAX_FIND_LIMIT = 20;
const DEFAULT_FIND_LIMIT = 8;
const DEFAULT_SESSION_LIMIT = 30;
const MAX_SESSION_LIMIT = 100;
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

/** 折叠空白,让换行/多空格与单空格等价(大小写不敏感)。 */
export function fold(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

/** 读取整份事件日志(存活优先)。 */
async function loadEvents(ctx, sessionId) {
  const live = liveSession(ctx, sessionId);
  if (live !== undefined && typeof live.snapshotEvents === "function") {
    return { header: live.header || null, events: live.snapshotEvents() || [], source: "live" };
  }
  const persistence = ctx.get("sessionPersistence");
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
  throw new Error("没有可用的会话来源(sessions / sessionPersistence)");
}

/** 只读一段 seq 区间,另外补一个 seq 0 事件用于算 logId。 */
async function readWindow(ctx, sessionId, from, to) {
  const length = to - from + 1;
  const live = liveSession(ctx, sessionId);
  if (live !== undefined && typeof live.snapshotEvents === "function") {
    const all = live.snapshotEvents() || [];
    return {
      header: live.header || null,
      source: "live",
      events: all.filter((event) => event && event.seq >= from && event.seq <= to),
      first: firstEventOf(all),
      total: all.length,
    };
  }
  const persistence = ctx.get("sessionPersistence");
  if (persistence !== undefined && typeof persistence.open === "function") {
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

function headerFields(header, live, persisted) {
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
  };
}

async function listSessions(ctx) {
  const query = ctx.get("sessionQuery");
  if (query !== undefined && typeof query.listSessions === "function") {
    const records = await query.listSessions();
    return records.map((record) => headerFields(record.header, record.live === true, record.persisted === true));
  }
  // 兜底:存活会话 + 持久化快照,按 id 合并(存活优先)。
  const byId = new Map();
  const persistence = ctx.get("sessionPersistence");
  if (persistence !== undefined && typeof persistence.list === "function") {
    for (const snapshot of (await persistence.list()) || []) {
      const header = (snapshot && snapshot.header) || null;
      if (header && header.id) byId.set(header.id, headerFields(header, false, true));
    }
  }
  const sessions = ctx.get("sessions");
  if (sessions !== undefined && typeof sessions.list === "function") {
    for (const session of sessions.list() || []) {
      const header = session.header || session;
      if (!header || !header.id) continue;
      const previous = byId.get(header.id);
      byId.set(header.id, headerFields(header, true, previous ? previous.persisted : false));
    }
  }
  return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
  // 四个工具要么全注册、要么一个都不注册。重名会抛错(例如上一个进程里被 stop/undefine 的
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

  register({
    name: "trajectory_sessions",
    description:
      "列出可查询的会话(当前存活 + 已持久化),返回 id、创建时间、cwd、父会话、preset、live/persisted。先用它确定 session id,再传给其它 trajectory_* 工具。只读。",
    parameters: {
      limit: { type: "integer", description: "返回条数,默认 " + DEFAULT_SESSION_LIMIT + ",上限 " + MAX_SESSION_LIMIT },
      liveOnly: { type: "boolean", description: "只列当前存活会话(默认 false:存活 + 已持久化)" },
    },
    output: OUTPUT,
    async execute(args) {
      try {
        const limit = Math.min(Math.max(Number(args.limit || DEFAULT_SESSION_LIMIT), 1), MAX_SESSION_LIMIT);
        const all = await listSessions(ctx);
        const filtered = args.liveOnly === true ? all.filter((item) => item.live) : all;
        return { ok: true, total: all.length, returned: Math.min(filtered.length, limit), items: filtered.slice(0, limit) };
      } catch (error) {
        return FAILED(error);
      }
    },
  });

  register({
    name: "trajectory_find",
    description:
      "在会话事件日志里按字面量子串查找(大小写不敏感、空白灵活)。只给事实与位置:每条命中返回 (session, seq, type, time) 与逐字片段,不做语义改写。给 session 时在该会话内查;否则扫描最近若干会话。空结果 = 日志里确实没有,不要用常识补。",
    parameters: {
      session: { type: "string", description: "会话 id;缺省则跨最近若干会话搜索" },
      query: { type: "string", description: "查找词(按字面子串匹配)" },
      types: { type: "array", items: { type: "string" }, description: "事件类型过滤,如 user/message、tool/call、tool/result、assistant/message" },
      from: { type: "integer", description: "seq 下界(含)" },
      to: { type: "integer", description: "seq 上界(含)" },
      timeFrom: { type: "integer", description: "时间下界(毫秒时间戳,含)" },
      timeTo: { type: "integer", description: "时间上界(毫秒时间戳,含)" },
      sessionCount: { type: "integer", description: "缺省 session 时扫描的最近会话数,默认 3,上限 10" },
      limit: { type: "integer", description: "最大返回条数,默认 " + DEFAULT_FIND_LIMIT + ",上限 " + MAX_FIND_LIMIT },
    },
    output: OUTPUT,
    async execute(args) {
      try {
        const limit = Math.min(Math.max(Number(args.limit || DEFAULT_FIND_LIMIT), 1), MAX_FIND_LIMIT);
        const needle = typeof args.query === "string" ? args.query.trim() : "";
        const types = Array.isArray(args.types) ? args.types.map((type) => String(type)) : [];
        const hasRange = args.from !== undefined || args.to !== undefined || args.timeFrom !== undefined || args.timeTo !== undefined;
        if (!needle && types.length === 0 && !hasRange) {
          return { ok: false, error: "至少需要 query、types、from/to 或 timeFrom/timeTo 之一" };
        }
        const matches = (event) => {
          if (!event || typeof event.seq !== "number") return false;
          if (types.length > 0 && !types.includes(event.type)) return false;
          if (args.from !== undefined && event.seq < Number(args.from)) return false;
          if (args.to !== undefined && event.seq > Number(args.to)) return false;
          if (args.timeFrom !== undefined && !(Number(event.time) >= Number(args.timeFrom))) return false;
          if (args.timeTo !== undefined && !(Number(event.time) <= Number(args.timeTo))) return false;
          if (needle && !fold(eventText(event)).includes(fold(needle))) return false;
          return true;
        };

        if (args.session) {
          const loaded = await withTimeout(loadEvents(ctx, String(args.session)), LOAD_TIMEOUT_MS, "trajectory_find");
          const hits = loaded.events.filter(matches);
          return {
            ok: true,
            mode: "literal-in-session",
            session: String(args.session),
            source: loaded.source,
            log: logIdentity(String(args.session), loaded.events),
            hitCount: hits.length,
            returned: Math.min(hits.length, limit),
            items: hits.slice(0, limit).map((event) => ({
              session: String(args.session),
              seq: event.seq,
              type: event.type,
              time: event.time,
              text: clip(eventText(event), 400),
            })),
          };
        }

        const sessionCount = Math.min(Math.max(Number(args.sessionCount || 3), 1), 10);
        const targets = (await listSessions(ctx)).slice(0, sessionCount);
        const items = [];
        let scanned = 0;
        let failures = 0;
        for (const target of targets) {
          if (items.length >= limit) break;
          scanned++;
          try {
            const loaded = await withTimeout(loadEvents(ctx, target.id), LOAD_TIMEOUT_MS, "trajectory_find");
            const log = logIdentity(target.id, loaded.events);
            for (const event of loaded.events) {
              if (items.length >= limit) break;
              if (!matches(event)) continue;
              items.push({
                session: target.id,
                seq: event.seq,
                type: event.type,
                time: event.time,
                log: log.id,
                text: clip(eventText(event), 400),
              });
            }
          } catch {
            failures++;
          }
        }
        return { ok: true, mode: "literal-cross-session", scanned, failed: failures, returned: items.length, items };
      } catch (error) {
        return FAILED(error);
      }
    },
  });

  register({
    name: "trajectory_window",
    description:
      "按 (session, seq 区间) 取原文窗口,逐字返回事件文本(消息 / 工具调用 / 工具结果 / 错误)。用于核实 find 命中、看上下文。窗口上限 " + MAX_WINDOW + " 个事件;只给 seq 时取前后各 5 个。只读。",
    parameters: {
      session: { type: "string", required: true, description: "会话 id" },
      from: { type: "integer", description: "起始 seq(含)" },
      to: { type: "integer", description: "结束 seq(含)" },
      seq: { type: "integer", description: "只给 seq 时取其前后各 5 个事件" },
      mode: { type: "string", enum: ["surface", "raw"], description: "surface(默认)=只列有语义文本的事件;raw=区间内全部事件" },
    },
    output: OUTPUT,
    async execute(args) {
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
        const window = await withTimeout(readWindow(ctx, sessionId, Math.max(from, 0), to), LOAD_TIMEOUT_MS, "trajectory_window");
        const rows = [];
        for (const event of window.events) {
          const text = eventText(event);
          if (args.mode === "raw" || text) {
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
    },
  });

  register({
    name: "trajectory_trace",
    description:
      "关系链:给 (session, seq) 返回该事件的替换/引用/派生链;只给 session 返回谱系(祖先 / 子会话 / 子代理)。需要 sessionQuery 服务。只读。",
    parameters: {
      session: { type: "string", required: true, description: "会话 id" },
      seq: { type: "integer", description: "事件 seq;给定时返回事件关系,缺省返回会话谱系" },
    },
    output: OUTPUT,
    async execute(args) {
      try {
        const query = ctx.get("sessionQuery");
        if (query === undefined) return { ok: false, error: "sessionQuery 服务不可用" };
        const sessionId = String(args.session);
        if (args.seq !== undefined && args.seq !== null) {
          const traced = await query.traceEvent({ sessionId, seq: Number(args.seq) });
          const target = traced.target || {};
          return {
            ok: true,
            session: sessionId,
            target: { seq: target.seq, type: target.type, time: target.time, surface: target.surface },
            replacedBy: traced.replacedBy,
            replacementChain: traced.replacementChain,
            replacedEventSeqs: traced.replacedEventSeqs,
            sourceEventSeqs: traced.sourceEventSeqs,
            derivedEventSeqs: traced.derivedEventSeqs,
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
    },
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
      "dsh-trajectory-tools: 工具名已被占用,四个工具都不注册(" +
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
