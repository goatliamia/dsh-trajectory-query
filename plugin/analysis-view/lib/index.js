// dsh-analysis-view host half — computes incidents from the session's raw log and serves them
// over a read-only route so the client panel can render host-detected incidents (same-args repeat,
// no-op turn, harness response) instead of guessing from the client projection.
//
// The client panel only has the trajectory projection (no tool arguments, no state), so it marks
// those incident types as "needs host". This half provides them.

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
        const kind = (d.error && (d.error.name || d.error.code)) || "error";
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
        if (req.method !== "GET" || url.pathname !== ROUTE_PATH + "/digest") return send(404, { error: "not found" });
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return send(400, { error: "missing session" });
        const sessionQuery = ctx.get("sessionQuery");
        if (sessionQuery === undefined) return send(503, { error: "sessionQuery unavailable" });
        const snapshot = await sessionQuery.readSession(sessionId);
        return send(200, { sessionId, ...computeIncidents(snapshot.events) });
      } catch (error) {
        return send(500, { error: String((error && error.message) || error) });
      }
    }
  }), "analysis-view: digest route");
}
