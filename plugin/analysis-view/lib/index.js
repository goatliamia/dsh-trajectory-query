// dsh-analysis-view host half — computes incidents from the session's raw log and serves them
// over a read-only route so the client panel can render host-detected incidents (same-args repeat,
// no-op turn, harness response) instead of guessing from the client projection.
//
// The client panel only has the trajectory projection (no tool arguments, no state), so it marks
// those incident types as "needs host". This half provides them.

import { createHash } from "node:crypto";

const ROUTE_PATH = "/analysis-view";

/**
 * Deterministic incident detection over raw session events (mirror of analyzers/incidents.mjs).
 * @param events - SessionEvent[] from ctx.sessionQuery.readSession().
 * @returns structured facts + incidents (each with evidence seqs).
 */
export function computeIncidents(events) {
  let turns = 0, currentTurn = 0, toolCalls = 0, errors = 0;
  const turnTools = new Map();
  const turnAssistant = new Set();
  const nameSeq = [];
  const errFirst = [];

  for (const e of events || []) {
    if (!e || typeof e.seq !== "number") continue;
    if (e.type === "turn/start") { turns++; currentTurn++; continue; }
    if (e.type === "assistant/message" && currentTurn) turnAssistant.add(currentTurn);
    if (e.type === "tool/call") {
      toolCalls++;
      const d = e.data || {};
      const args = typeof d.arguments === "string" ? d.arguments : JSON.stringify(d.arguments);
      nameSeq.push({ name: d.name || "(tool)", args, seq: e.seq, turn: currentTurn });
      turnTools.set(currentTurn, (turnTools.get(currentTurn) || 0) + 1);
    } else if (e.type === "tool/result") {
      const d = e.data || {};
      const content = d.message && d.message.content;
      const err = d.error || (Array.isArray(content) && content[0] && content[0].isError);
      if (err) {
        errors++;
        const er = d.error; const kind = er ? (er.name && er.code ? er.name + ":" + er.code : (er.name || er.code || "error")) : "error";
        if (errFirst.length < 12) errFirst.push({ kind, seq: e.seq, turn: currentTurn });
      }
    }
  }

  let emptyTurns = 0;
  for (let t = 1; t <= turns; t++) if (!(turnTools.get(t) > 0) && !turnAssistant.has(t)) emptyTurns++;

  const incidents = [];

  // retry-loop v1: same tool + same arguments, consecutive
  let i = 0;
  while (i < nameSeq.length) {
    let j = i;
    while (j < nameSeq.length && nameSeq[j].name === nameSeq[i].name && nameSeq[j].args === nameSeq[i].args) j++;
    if (j - i >= 2) {
      const run = nameSeq.slice(i, j);
      const hasErr = run.some((x) => errFirst.some((f) => f.seq >= x.seq && f.seq <= x.seq + 3));
      incidents.push({
        type: "retry-loop",
        severity: (j - i) + (hasErr ? 2 : 0),
        title: "重复调用循环",
        detail: "连续 " + (j - i) + ' 次对 "' + run[0].name + '" 的重复调用(同参)',
        cause: run[0].name + " 同签名工具连续重复调用" + (hasErr ? "; 且 seq 区间含失败结果" : ""),
        runtimeKnew: hasErr ? "上一次调用失败,重复状态已累积" : "重复调用状态已累积",
        modelKnew: "仅收到各次 tool result,无重复/失败聚合状态",
        harness: "未检测到主动打断",
        impact: (j - i) + " 次冗余调用",
        seqs: run.map((x) => x.seq)
      });
    }
    i = j;
  }

  if (errors > 0) {
    const kinds = {};
    for (const f of errFirst) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    incidents.push({
      type: "error",
      severity: errors,
      title: "调用失败",
      detail: errors + " 个工具调用返回错误(" + Object.keys(kinds).join(", ") + ")",
      cause: "工具调用返回了错误结果",
      runtimeKnew: "错误码/失败状态已在事件中",
      modelKnew: "收到 tool result(可能已含错误)",
      harness: deriveHarnessResponse(kinds),
      impact: "该部分目标未达成",
      seqs: errFirst.map((f) => f.seq)
    });
  }

  if (emptyTurns > 0) {
    incidents.push({
      type: "noop",
      severity: 1,
      title: "空转 turn",
      detail: emptyTurns + " 个 turn 既无工具调用、也无助手产出",
      cause: "该 turn 未产生任何动作或产出",
      runtimeKnew: "-",
      modelKnew: "-",
      harness: "-",
      impact: "该 turn 未推进",
      seqs: []
    });
  }

  incidents.sort((a, b) => b.severity - a.severity);
  return { turns, toolCalls, errors, emptyTurns, incidentCount: incidents.length, incidents };
}

/** Derive the harness response from the observed error codes (evidence, not a template). */
export function deriveHarnessResponse(kinds) {
  const keys = Object.keys(kinds || {});
  const guards = keys.filter((k) => /NOT_OBSERVED|BLOCKED|DENIED|GUARD/.test(k));
  const unknownTool = keys.filter((k) => /UNKNOWN_TOOL/.test(k));
  if (guards.length > 0 && unknownTool.length === 0) return "guard 已拦截(" + guards.join(", ") + ")";
  if (guards.length > 0) return "部分 guard 已拦截(" + guards.join(", ") + ");其余需模型自纠";
  if (unknownTool.length > 0) return "无 guard;需模型自纠";
  return "未检测到针对性处理";
}


/** Read a session's events without sessionQuery.readSession (which can block on live sessions). */
async function loadEvents(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  const live = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : void 0;
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
  if (persistence && typeof persistence.inspect === "function") {
    const loaded = await persistence.inspect(sessionId);
    return (loaded && loaded.events) || [];
  }
  throw new Error("no session source available (sessions/sessionPersistence)");
}

/** Fail fast instead of letting an HTTP request hang forever. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("analysis-view: session load timed out")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function clipText(value, max) {
  const text = String(value == null ? "" : value);
  return text.length <= max ? text : text.slice(0, max) + "…";
}

function blocksText(content) {
  if (!Array.isArray(content)) return "";
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") out.push(b.text);
      else if (b.type === "tool-call") out.push(String(b.name || ""), String(b.arguments || ""));
      else if (b.type === "tool-result") walk(b.content);
    }
  };
  walk(content);
  return out.filter(Boolean).join("\n");
}

/** One verbatim, bounded evidence line per event. */
function evidenceLine(e) {
  const d = (e && e.data) || {};
  if (e.type === "tool/call") return "tool/call " + (d.name || "?") + " " + clipText(d.arguments, 220);
  if (e.type === "tool/result") return "tool/result" + (d.error ? " error=" + (d.error.name || "") + ":" + (d.error.code || "") : "") + " " + clipText(blocksText(d.message && d.message.content), 220);
  if (e.type === "assistant/message") return "assistant/message " + clipText(blocksText(d.message && d.message.content), 220);
  if (e.type === "user/message") return "user/message " + clipText(blocksText(d.content), 160);
  if (e.type === "turn/end") return "turn/end " + clipText(JSON.stringify(d.reason || {}), 120);
  return e.type;
}

/** A log identity so a (session, seq) citation can be resolved to one exact log revision. */
export function logIdentity(sessionId, events) {
  const first = (events || []).find((e) => e && typeof e.seq === "number");
  const last = [...(events || [])].reverse().find((e) => e && typeof e.seq === "number");
  const parts = [sessionId, first ? first.seq : -1, first ? first.type : "", first ? first.time : 0].join("|");
  return { id: createHash("sha256").update(parts).digest("hex").slice(0, 12), events: (events || []).length, minSeq: first ? first.seq : null, maxSeq: last ? last.seq : null };
}

/** Bounded evidence block handed to the model: facts + incident lines + verbatim excerpts. */
export function buildEvidence(sessionId, events, facts, log) {
  const lines = ["session: " + sessionId];
  if (log) lines.push("log: " + log.id + " (events=" + log.events + ", seq " + log.minSeq + "–" + log.maxSeq + ")");
  lines.push("facts: turns=" + facts.turns + " toolCalls=" + facts.toolCalls + " errors=" + facts.errors + " emptyTurns=" + facts.emptyTurns);
  for (const inc of facts.incidents) {
    lines.push("- incident[" + inc.type + "] " + inc.detail + " | cause: " + inc.cause + " | harness: " + inc.harness + " | impact: " + inc.impact + " | seqs: " + (inc.seqs || []).join(","));
  }
  const bySeq = new Map();
  for (const e of events || []) if (e && typeof e.seq === "number") bySeq.set(e.seq, e);
  const wanted = [];
  for (const inc of facts.incidents) for (const s of inc.seqs || []) if (!wanted.includes(s) && wanted.length < 8) wanted.push(s);
  for (const s of wanted) {
    const e = bySeq.get(s);
    if (e) lines.push("evidence (seq " + s + "): " + evidenceLine(e));
  }
  return lines.join("\n");
}

/** Ask the configured model to interpret the incidents; every claim must cite (session, seq). */
async function interpret(ctx, sessionId, events, facts, log) {
  const llm = ctx.get("llm");
  if (llm === undefined || typeof llm.stream !== "function") return { error: "llm service unavailable" };
  const defaultModel = ctx.get("agentDefaultModel");
  const selection = defaultModel && typeof defaultModel.currentSelection === "function" ? defaultModel.currentSelection() : void 0;
  if (!selection || !selection.provider || !selection.model) return { error: "no default model selection" };
  const system = "你是轨迹分析助手。只依据给定的确定性 incident 事实与逐字证据片段作答;每条事实性陈述必须引用 (session, seq@" + (log ? log.id : "log") + "),不得编造 seq。输出中文,不超过 200 字,分四段:发生了什么 / 原因 / Harness 是否响应 / 影响。";
  const messages = [{
    id: "analysis-view-interpret",
    role: "user",
    content: [{ type: "text", text: "会话:" + sessionId + "\n\n" + buildEvidence(sessionId, events, facts, log) }],
    source: { kind: "plugin", plugin: "dsh-analysis-view", form: "notice" }
  }];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let text = "";
  let usage = null;
  let failure = null;
  try {
    for await (const chunk of llm.stream({ provider: selection.provider, model: selection.model, messages, system, maxTokens: 600, signal: ctl.signal, sessionId })) {
      if (chunk.type === "text-delta") text += chunk.text;
      else if (chunk.type === "usage") usage = chunk.usage;
      else if (chunk.type === "finish" && chunk.reason && (chunk.reason.kind === "error" || chunk.reason.kind === "aborted")) failure = chunk.reason;
    }
  } catch (error) {
    failure = { kind: "error", message: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
  if (failure !== null) return { error: "model call failed: " + ((failure.failure && failure.failure.message) || failure.message || failure.kind) };
  return { text, model: { provider: selection.provider, model: selection.model }, usage };
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
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return send(400, { error: "missing session" });
        const events = await withTimeout(loadEvents(ctx, sessionId), 5000);
        const facts = computeIncidents(events);
        const log = logIdentity(sessionId, events);
        if (url.pathname === ROUTE_PATH + "/digest") return send(200, { sessionId, log, ...facts });
        if (url.pathname === ROUTE_PATH + "/interpret") return send(200, { sessionId, log, ...(await interpret(ctx, sessionId, events, facts, log)) });
        return send(404, { error: "not found" });
      } catch (error) {
        return send(500, { error: String((error && error.message) || error) });
      }
    }
  }), "analysis-view: digest route");
}
