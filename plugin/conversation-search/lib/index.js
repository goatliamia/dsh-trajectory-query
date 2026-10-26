// dsh-conversation-search host half — 在当前会话的事件日志里做字面检索,只回位置与片段。
// 客户端半边把它画成右侧栏的一个 tab;点击后的跳转是客户端的事(DOM 锚点在 chat 那边)。

import { createHash } from "node:crypto";

const ROUTE_PATH = "/conversation-search";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 140;

/** 一段 content 里的可见文字(工具调用/结果也算,因为用户常搜的是路径或命令)。 */
function blocksText(content) {
  if (!Array.isArray(content)) return "";
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") out.push(block.text);
    else if (block.type === "reasoning" && typeof block.text === "string") out.push(block.text);
    else if (block.type === "tool-call") out.push(String(block.name || ""), String(block.arguments || ""));
    else if (block.type === "tool-result") out.push(blocksText(block.content));
  }
  return out.filter(Boolean).join("\n");
}

/** 一条事件里可检索的文字。没有文字的事件(step 起止之类)不参与。 */
export function eventText(event) {
  const data = (event && event.data) || {};
  switch (event.type) {
    case "user/message":
      return blocksText(data.content || (data.message && data.message.content));
    case "assistant/message":
      return blocksText(data.message && data.message.content);
    case "tool/call": {
      const args = typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments === undefined ? "" : data.arguments);
      return [data.name || "", args].filter(Boolean).join(" ");
    }
    case "tool/result": {
      const error = data.error;
      const head = error ? String(error.name || "") + (error.code ? ":" + error.code : "") : "";
      return [head, blocksText(data.message && data.message.content)].filter(Boolean).join(" ");
    }
    case "turn/end":
      return data.reason ? JSON.stringify(data.reason) : "";
    case "session/title":
      return typeof data.title === "string" ? data.title : "";
    default:
      return "";
  }
}

/**
 * 字面检索(大小写不敏感),返回片段与命中位置。
 * @param events - SessionEvent[]
 * @param needle - 非空查询词
 * @param limit - 最多返回多少条
 */
export function searchEvents(events, needle, limit) {
  const lower = needle.toLowerCase();
  const hits = [];
  let turn = 0;
  let total = 0;
  for (const event of events || []) {
    if (!event || typeof event.seq !== "number") continue;
    if (event.type === "turn/start") {
      turn += 1;
      continue;
    }
    const text = eventText(event);
    if (text === "") continue;
    const at = text.toLowerCase().indexOf(lower);
    if (at < 0) continue;
    total += 1;
    if (hits.length >= limit) continue;
    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(text.length, at + needle.length + SNIPPET_AFTER);
    const lead = start > 0 ? 1 : 0;
    const data = event.data || {};
    hits.push({
      seq: event.seq,
      turn: typeof data.turn === "number" ? data.turn : turn,
      type: event.type,
      time: event.time,
      text: (lead ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
      matchAt: at - start + lead,
    });
  }
  return { total, hits };
}

export function logIdentity(sessionId, events) {
  const first = (events || []).find((event) => event && typeof event.seq === "number");
  const parts = [sessionId, first ? first.seq : -1, first ? first.type : "", first ? first.time : 0].join("|");
  return { id: createHash("sha256").update(parts).digest("hex").slice(0, 12), events: (events || []).length };
}

function disposeObservation(observation) {
  const dispose = observation && (observation[Symbol.dispose] || observation.dispose);
  if (typeof dispose === "function") {
    try {
      dispose.call(observation);
    } catch {
      /* 释放失败不影响这次读取 */
    }
  }
}

/** 读会话事件:observeSession → 内存快照 → persistence handle。 */
async function loadEvents(ctx, sessionId) {
  const query = ctx.get("sessionQuery");
  if (query && typeof query.observeSession === "function") {
    const observation = await query.observeSession(sessionId);
    try {
      return observation.events || [];
    } finally {
      disposeObservation(observation);
    }
  }
  const sessions = ctx.get("sessions");
  const live = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : undefined;
  if (live && typeof live.snapshotEvents === "function") return live.snapshotEvents();
  const persistence = ctx.get("sessionPersistence");
  if (persistence && typeof persistence.open === "function") {
    const handle = await persistence.open(sessionId, "read");
    try {
      const result = await handle.read();
      return (result && result.events) || [];
    } finally {
      if (handle && typeof handle.close === "function") await handle.close();
    }
  }
  throw new Error("no session source available (sessionQuery/sessions/sessionPersistence)");
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ": session load timed out")), ms);
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

export const inject = ["webServer"];

export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) return;
  ctx.effect(() => webServer.register({
    kind: "prefix",
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      try {
        const url = new URL(req.url || "/", "http://localhost");
        if (req.method !== "GET") return send(404, { error: "not found" });
        if (url.pathname !== ROUTE_PATH + "/search") return send(404, { error: "not found" });
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return send(400, { error: "missing session" });
        const query = (url.searchParams.get("q") || "").trim();
        if (query === "") return send(400, { error: "missing q" });
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || DEFAULT_LIMIT), 1), MAX_LIMIT);
        const events = await withTimeout(loadEvents(ctx, sessionId), 5000, "conversation-search");
        const log = logIdentity(sessionId, events);
        const found = searchEvents(events, query, limit);
        return send(200, {
          ok: true,
          session: sessionId,
          log,
          query,
          total: found.total,
          returned: found.hits.length,
          truncated: found.total > found.hits.length,
          hits: found.hits,
        });
      } catch (error) {
        return send(500, { error: String((error && error.message) || error) });
      }
    },
  }), "conversation-search: search route");
}
