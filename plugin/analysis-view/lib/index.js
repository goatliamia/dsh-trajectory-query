// dsh-analysis-view host half — 把一次会话折成面板要的事实(incidents / cost / 每轮与每工具的统计),
// 通过 /analysis-view 的只读路由给出。

import { createHash } from "node:crypto";
import { incident } from "./incident-shape.js";

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
      const err = d.error || (d.message && d.message.isError) || (Array.isArray(content) && content[0] && content[0].isError);
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
      incidents.push(incident({
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
      }));
    }
    i = j;
  }

  if (errors > 0) {
    const kinds = {};
    for (const f of errFirst) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    incidents.push(incident({
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
    }));
  }

  if (emptyTurns > 0) {
    incidents.push(incident({
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
    }));
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

/**
 * Deterministic token-usage fold over `assistant/message.usage` (mirror of analyzers/cost.mjs).
 * A request whose adapter reported no usage is `unknown`, never zero; a single missing
 * field is null and is excluded from the sums.
 */
/** DeepSeek 官方 API 价目(元 / 百万 tokens):[空闲时段, 高峰时段],见 api-docs.deepseek.com 的模型与价格页。 */
const DEEPSEEK_PRICES = {
  "deepseek-flash": { cacheHit: [0.02, 0.04], cacheMiss: [1, 2], output: [4, 8] },
  "deepseek-v4-pro": { cacheHit: [0.15, 0.3], cacheMiss: [4.5, 9], output: [13.5, 27] },
};

/** 高峰是北京时间周一至周五 9:00–12:00、14:00–18:00;其余(含周末)按空闲时段算。 */
function isPeakTime(time) {
  if (typeof time !== "number") return false;
  const beijing = new Date(time + 8 * 3600 * 1000);
  const day = beijing.getUTCDay();
  const hour = beijing.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

/** 只给"官方 API + 已知模型"的请求计价,其余计数不猜价。 */
function computePricing(requests) {
  const models = new Set();
  const cost = { miss: 0, hit: 0, output: 0 };
  const tokens = { miss: 0, hit: 0, output: 0 };
  let priced = 0;
  let unpriced = 0;
  let peakRequests = 0;
  for (const row of requests) {
    const provider = typeof row.provider === "string" ? row.provider : null;
    const model = typeof row.model === "string" ? row.model : null;
    if (provider === null || model === null || !provider.startsWith("deepseek")) {
      unpriced += 1;
      continue;
    }
    models.add(model);
    const table = DEEPSEEK_PRICES[model];
    if (table === undefined) {
      unpriced += 1;
      continue;
    }
    const peak = isPeakTime(row.time);
    if (peak) peakRequests += 1;
    const slot = peak ? 1 : 0;
    const miss = row.input || 0;
    const hit = row.cacheRead || 0;
    const out = row.output || 0;
    cost.miss += (miss / 1e6) * table.cacheMiss[slot];
    cost.hit += (hit / 1e6) * table.cacheHit[slot];
    cost.output += (out / 1e6) * table.output[slot];
    tokens.miss += miss;
    tokens.hit += hit;
    tokens.output += out;
    priced += 1;
  }
  const perM = (value, count) => (count === 0 ? null : (value / count) * 1e6);
  return {
    currency: "CNY",
    models: [...models],
    priced,
    unpriced,
    peakRequests,
    total: cost.miss + cost.hit + cost.output,
    cost,
    perM: { miss: perM(cost.miss, tokens.miss), hit: perM(cost.hit, tokens.hit), output: perM(cost.output, tokens.output) },
  };
}

export function computeCost(events) {
  const requests = [];
  for (const e of events || []) {
    if (!e || e.type !== "assistant/message") continue;
    const d = e.data || {};
    const u = d.usage;
    const unknown = u === undefined || u === null || typeof u !== "object";
    const pick = (field) => (unknown || typeof u[field] !== "number" ? null : u[field]);
    const source = d.message && d.message.source;
    const row = {
      seq: e.seq,
      time: typeof e.time === "number" ? e.time : null,
      turn: typeof d.turn === "number" ? d.turn : null,
      model: source && typeof source.model === "string" ? source.model : null,
      provider: source && typeof source.provider === "string" ? source.provider : null,
      unknown,
      input: pick("inputTokens"),
      cacheRead: pick("cacheReadTokens"),
      cacheWrite: pick("cacheWriteTokens"),
      output: pick("outputTokens"),
      reasoning: pick("reasoningTokens"),
      total: pick("totalTokens"),
    };
    row.cacheEfficiency = row.cacheRead === null || row.input === null || row.cacheRead + row.input === 0 ? null : row.cacheRead / (row.cacheRead + row.input);
    requests.push(row);
  }
  const sum = (field) => {
    let value = null;
    for (const row of requests) if (row[field] !== null) value = (value || 0) + row[field];
    return value;
  };
  const input = sum("input");
  const cacheRead = sum("cacheRead");
  const turns = new Map();
  for (const row of requests) {
    const key = row.turn === null ? "null" : String(row.turn);
    if (!turns.has(key)) turns.set(key, []);
    turns.get(key).push(row);
  }
  const byTurn = [...turns.entries()].map(([key, list]) => {
    const turnInput = list.reduce((acc, row) => (row.input === null ? acc : (acc || 0) + row.input), null);
    const turnCacheRead = list.reduce((acc, row) => (row.cacheRead === null ? acc : (acc || 0) + row.cacheRead), null);
    const turnOutput = list.reduce((acc, row) => (row.output === null ? acc : (acc || 0) + row.output), null);
    return {
      turn: key === "null" ? null : Number(key),
      requests: list.length,
      input: turnInput,
      cacheRead: turnCacheRead,
      output: turnOutput,
      cacheEfficiency: turnCacheRead === null || turnInput === null || turnCacheRead + turnInput === 0 ? null : turnCacheRead / (turnCacheRead + turnInput),
    };
  });
  return {
    requestCount: requests.length,
    unknownRequests: requests.filter((row) => row.unknown).length,
    input,
    cacheRead,
    cacheWrite: sum("cacheWrite"),
    output: sum("output"),
    reasoning: sum("reasoning"),
    total: sum("total"),
    cacheEfficiency: cacheRead === null || input === null || cacheRead + input === 0 ? null : cacheRead / (cacheRead + input),
    pricing: priced(requests) ? computePricing(requests) : null,
    byTurn,
  };
}

function priced(requests) {
  return requests.some((row) => typeof row.provider === "string" && row.provider.startsWith("deepseek") && DEEPSEEK_PRICES[row.model] !== undefined);
}

export const TOOL_CATEGORY_LABELS = Object.freeze({ file: "文件", run: "执行", web: "网络", context: "上下文", coop: "协作", plugin: "插件", other: "其他" });

/**
 * 工具类别:先看声明里的参数(工具自己说它操作什么),再看名字与描述,最后落到"其他"。
 * 规则按"碰到哪个系统表面"排,不依赖具体工具名——用户自己的工具也走同一套。
 * @param definition - ctx.tools.get(name) 返回的定义(含 JSON Schema 参数与描述)。
 * @param name - 工具名,用作关键词兜底。
 */
export function classifyTool(definition, name = "") {
  const properties = (definition && definition.parameters && definition.parameters.properties) || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(properties, key);
  if (has("file_path") || has("path")) return "file";
  if (has("command")) return "run";
  if (has("url") || has("queries")) return "web";
  if (has("session") || has("session_id") || has("session_ids") || has("seq")) return "context";
  if (has("todos") || has("objective") || has("max_rounds") || has("after_seconds") || has("every_seconds") || has("cron") || has("daily") || has("weekly")) return "coop";
  if (has("questions") || has("prompt") || has("script") || has("agent") || has("agent_id") || has("message")) return "coop";
  if (has("provider") || has("service") || has("entry") || has("event")) return "plugin";
  const text = (String(name) + " " + String((definition && definition.description) || "")).toLowerCase();
  if (/skill|instruction/.test(text)) return "context";
  if (/plugin|provider|inspect|cordis|mcp/.test(text)) return "plugin";
  if (/goal|schedule|reminder|todo|subagent|agent|workflow|ralph|message|question|plan/.test(text)) return "coop";
  if (/session|trajectory|history|transcript/.test(text)) return "context";
  if (/file|read|write|edit|glob|grep|patch/.test(text)) return "file";
  if (/command|shell|terminal|bash|pwsh|process/.test(text)) return "run";
  if (/web|http|fetch|search/.test(text)) return "web";
  return "other";
}

/**
 * 一次遍历算出每个 turn 的起止/耗时/调用/token,以及按工具名汇总的调用、失败与耗时。
 * @param events - SessionEvent[]
 * @returns {{turns: object[], tools: object[], eventCount: number}}
 */
export function computeWorkPath(events, options = {}) {
  const classify = typeof options.classify === "function" ? options.classify : () => "other";
  const turns = [];
  const tools = new Map();
  const calls = new Map();
  let current = null;

  const bucket = (name) => {
    let tool = tools.get(name);
    if (tool === undefined) {
      tool = { name, calls: 0, errors: 0, totalMs: 0, timed: 0, maxMs: 0, lastSeq: 0, turnCounts: new Map() };
      tools.set(name, tool);
    }
    return tool;
  };
  const addUsage = (turn, usage) => {
    if (!usage || typeof usage !== "object") return;
    const add = (field, value) => {
      if (typeof value !== "number") return;
      turn[field] = (turn[field] === null ? 0 : turn[field]) + value;
    };
    add("input", usage.inputTokens);
    add("cacheRead", usage.cacheReadTokens);
    add("output", usage.outputTokens);
  };

  for (const e of events || []) {
    if (!e || typeof e.seq !== "number") continue;
    const d = e.data || {};
    if (e.type === "turn/start") {
      current = {
        turn: turns.length + 1,
        startSeq: e.seq,
        endSeq: null,
        startTime: typeof e.time === "number" ? e.time : null,
        endTime: null,
        durationMs: null,
        endReason: null,
        toolCalls: 0,
        errors: 0,
        requests: 0,
        input: null,
        cacheRead: null,
        output: null,
        firstErrorSeq: null,
        firstErrorCallId: null,
        firstCallId: null,
      };
      turns.push(current);
      continue;
    }
    if (e.type === "tool/call") {
      const name = d.name || "(tool)";
      const tool = bucket(name);
      tool.calls += 1;
      tool.lastSeq = e.seq;
      if (d.callId !== undefined) calls.set(String(d.callId), { name, time: e.time });
      if (current !== null) {
        current.toolCalls += 1;
        // 这一轮的第一条调用:任何一轮都能在轨迹里定位,不用等失败。
        if (current.firstCallId === null && d.callId !== undefined) current.firstCallId = String(d.callId);
        tool.turnCounts.set(current.turn, (tool.turnCounts.get(current.turn) || 0) + 1);
      }
      continue;
    }
    if (e.type === "tool/result") {
      const content = d.message && d.message.content;
      const failed = Boolean(d.error) || Boolean(d.message && d.message.isError) || Boolean(Array.isArray(content) && content[0] && content[0].isError);
      // v4 把 callId 放在 message 上(toolCallId / source.callId),v3 放在 data.callId;两种都认。
      const message = d.message;
      const callId = d.callId !== undefined
        ? d.callId
        : message && message.toolCallId !== undefined
          ? message.toolCallId
          : message && message.source
            ? message.source.callId
            : undefined;
      const call = callId === undefined || callId === null ? undefined : calls.get(String(callId));
      const tool = call === undefined ? undefined : bucket(call.name);
      if (failed) {
        if (tool !== undefined) tool.errors += 1;
        if (current !== null) {
          current.errors += 1;
          if (current.firstErrorSeq === null) {
            current.firstErrorSeq = e.seq;
            // 面板拿它去开轨迹;给了这个,红色轮次点不点得中就不再取决于投影有没有加载到那段。
            current.firstErrorCallId = callId === undefined || callId === null ? null : String(callId);
          }
        }
      }
      if (tool !== undefined && typeof call.time === "number" && typeof e.time === "number") {
        const ms = Math.max(0, e.time - call.time);
        tool.totalMs += ms;
        tool.timed += 1;
        if (ms > tool.maxMs) tool.maxMs = ms;
      }
      continue;
    }
    if (e.type === "assistant/message") {
      if (current !== null) {
        current.requests += 1;
        addUsage(current, d.usage);
      }
      continue;
    }
    if (e.type === "turn/end") {
      if (current !== null) {
        current.endSeq = e.seq;
        current.endTime = typeof e.time === "number" ? e.time : null;
        current.durationMs = current.startTime !== null && current.endTime !== null ? Math.max(0, current.endTime - current.startTime) : null;
        current.endReason = d.reason && d.reason.kind ? String(d.reason.kind) : null;
      }
      current = null;
    }
  }

  const toolStats = [...tools.values()]
    .map((tool) => ({
      name: tool.name,
      category: classify(tool.name),
      calls: tool.calls,
      errors: tool.errors,
      avgMs: tool.timed === 0 ? null : Math.round(tool.totalMs / tool.timed),
      maxMs: tool.timed === 0 ? null : Math.round(tool.maxMs),
      totalMs: tool.timed === 0 ? null : Math.round(tool.totalMs),
      // 这个工具集中在哪几轮用:第三张环要它。
      byTurn: [...tool.turnCounts.entries()]
        .map(([turn, calls]) => ({ turn, calls }))
        .sort((a, b) => (b.calls - a.calls) || (a.turn - b.turn))
        .slice(0, 8),
      lastSeq: tool.lastSeq,
    }))
    .sort((a, b) => (b.calls - a.calls) || a.name.localeCompare(b.name));

  return { turns, tools: toolStats, eventCount: (events || []).length };
}

/** Bounded one-line cost evidence for the interpretation prompt. */
export function costEvidenceLine(cost) {
  if (!cost || cost.requestCount === 0) return "cost: 无 usage 记录";
  const compact = (value) => {
    if (value === null || value === undefined) return "n/a";
    if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
    if (value >= 1000) return (value / 1000).toFixed(1) + "k";
    return String(value);
  };
  const expensive = [...(cost.byTurn || [])]
    .filter((turn) => typeof turn.input === "number")
    .sort((a, b) => b.input - a.input)
    .slice(0, 3)
    .map((turn) => "turn " + turn.turn + "(in " + compact(turn.input) + ")");
  return "cost: " + cost.requestCount + " requests" + (cost.unknownRequests > 0 ? " (+" + cost.unknownRequests + " unknown)" : "") +
    ", in " + compact(cost.input) + " / cached " + compact(cost.cacheRead) + " / out " + compact(cost.output) +
    ", cache " + (cost.cacheEfficiency === null ? "n/a" : (cost.cacheEfficiency * 100).toFixed(1) + "%") +
    (expensive.length > 0 ? "; 最贵输入:" + expensive.join(", ") : "");
}


/** Release one session observation (SessionObservation is Disposable). */
function disposeObservation(observation) {
  if (observation === undefined || observation === null) return;
  const dispose = observation[Symbol.dispose] || observation.dispose;
  if (typeof dispose === "function") {
    try {
      dispose.call(observation);
    } catch {
      /* best-effort release */
    }
  }
}

/**
 * Read a session's events without sessionQuery.readSession (which replay-validates the whole log).
 * Preferred: sessionQuery.observeSession — the sanctioned path since DSH 0.1.6 deprecated the
 * synchronous Session readers (snapshotEvents/eventAt/ownEvents). Fallbacks keep older deployments
 * working: in-memory snapshot, persistence handle, legacy inspect().
 */
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
  throw new Error("no session source available (sessionQuery/sessions/sessionPersistence)");
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

/** Bounded evidence block handed to the model: facts + incident lines + cost + verbatim excerpts. */
export function buildEvidence(sessionId, events, facts, log, cost) {
  const lines = ["session: " + sessionId];
  if (log) lines.push("log: " + log.id + " (events=" + log.events + ", seq " + log.minSeq + "–" + log.maxSeq + ")");
  lines.push("facts: turns=" + facts.turns + " toolCalls=" + facts.toolCalls + " errors=" + facts.errors + " emptyTurns=" + facts.emptyTurns);
  if (cost !== undefined) lines.push(costEvidenceLine(cost));
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
async function interpret(ctx, sessionId, events, facts, log, cost) {
  const llm = ctx.get("llm");
  if (llm === undefined || typeof llm.stream !== "function") return { error: "llm service unavailable" };
  const defaultModel = ctx.get("agentDefaultModel");
  const selection = defaultModel && typeof defaultModel.currentSelection === "function" ? defaultModel.currentSelection() : void 0;
  if (!selection || !selection.provider || !selection.model) return { error: "no default model selection" };
  const system = "你是轨迹分析助手。只依据给定的确定性 incident 事实与逐字证据片段作答;每条事实性陈述必须引用 (session, seq@" + (log ? log.id : "log") + "),不得编造 seq。输出中文,四段(发生了什么 / 原因 / Harness 是否响应 / 影响)合计不超过 200 字,写完即停,不要复述证据。";
  const messages = [{
    id: "analysis-view-interpret",
    role: "user",
    content: [{ type: "text", text: "会话:" + sessionId + "\n\n" + buildEvidence(sessionId, events, facts, log, cost) }],
    source: { kind: "plugin:dsh-analysis-view" }
  }];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let text = "";
  let usage = null;
  let failure = null;
  let finish = null;
  try {
    for await (const chunk of llm.stream({ provider: selection.provider, model: selection.model, messages, system, maxTokens: 1000, signal: ctl.signal, sessionId })) {
      if (chunk.type === "text-delta") text += chunk.text;
      else if (chunk.type === "usage") usage = chunk.usage;
      else if (chunk.type === "finish" && chunk.reason) {
        finish = chunk.reason;
        if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") failure = chunk.reason;
      }
    }
  } catch (error) {
    failure = { kind: "error", message: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
  if (failure !== null) return { error: "model call failed: " + ((failure.failure && failure.failure.message) || failure.message || failure.kind) };
  return { text, model: { provider: selection.provider, model: selection.model }, usage, ...(finish !== null && finish.kind === "max-tokens" ? { truncated: true } : {}) };
}

export const inject = ["webServer"];

/** 面板要的全部事实,一次算齐(同一份 events 上三次线性遍历)。 */
export function buildDigest(sessionId, events, options = {}) {
  const facts = computeIncidents(events);
  const cost = computeCost(events);
  const work = computeWorkPath(events, options);
  const log = logIdentity(sessionId, events);
  return { sessionId, log, ...facts, cost, turnStats: work.turns, toolStats: work.tools, eventCount: work.eventCount };
}

/** 把工具名解析成类别:读它自己声明里的参数与描述;拿不到定义就当"其他"。 */
function classifyByName(ctx) {
  return (name) => {
    let definition;
    try {
      const tools = ctx.get("tools");
      definition = tools && typeof tools.get === "function" ? tools.get(name) : undefined;
    } catch {
      definition = undefined;
    }
    return classifyTool(definition, name);
  };
}

export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) return;
  // 面板每次切回「分析」都会拉一次;同一会话 2 秒内的重复请求复用上一次结果。
  const digestCache = new Map();
  const DIGEST_TTL_MS = 2000;
  const CACHE_MAX = 32;
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
        if (url.pathname === ROUTE_PATH + "/digest") {
          const fresh = url.searchParams.get("fresh") === "1";
          const hit = digestCache.get(sessionId);
          if (!fresh && hit !== undefined && Date.now() - hit.at < DIGEST_TTL_MS) return send(200, hit.payload);
          const events = await withTimeout(loadEvents(ctx, sessionId), 5000);
          const payload = buildDigest(sessionId, events, { classify: classifyByName(ctx) });
          digestCache.delete(sessionId);
          digestCache.set(sessionId, { at: Date.now(), payload });
          if (digestCache.size > CACHE_MAX) digestCache.delete(digestCache.keys().next().value);
          return send(200, payload);
        }
        if (url.pathname === ROUTE_PATH + "/interpret") {
          const events = await withTimeout(loadEvents(ctx, sessionId), 5000);
          const facts = computeIncidents(events);
          const cost = computeCost(events);
          const log = logIdentity(sessionId, events);
          return send(200, { sessionId, log, ...(await interpret(ctx, sessionId, events, facts, log, cost)) });
        }
        return send(404, { error: "not found" });
      } catch (error) {
        return send(500, { error: String((error && error.message) || error) });
      }
    }
  }), "analysis-view: digest route");
}
