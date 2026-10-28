// 「执行路径」页面的数据补充:上下文层、重试、文件操作、Skill 与子代理。
// 全部从已记录的事件里推导;不复制第三方实现,也不新增指标。
// 唯一的外部依赖是官方 surface 回放(判断某段 Skill 正文是否仍在模型可见历史里)。

import { buildTracePayload } from "./trace-build.js";
import { describeCall } from "./trace/models/step-insight.mjs";
import { collectToolResults } from "./trace/models/tool-result-model.mjs";
import { replaySkillEvidence } from "./trace-skill-evidence.js";

const READS = new Set(["read", "read_image", "read_file", "read_text_file"]);
const CHANGES = new Set(["edit", "write", "write_file", "multi_edit", "apply_patch"]);

const fullCall = (call, native, result) => {
  const args = native?.data?.arguments;
  const blocks = result?.data?.message?.content;
  return {
    ...call,
    args: args === undefined ? call.args : { text: typeof args === "string" ? args : JSON.stringify(args), omitted: 0 },
    result: Array.isArray(blocks)
      ? { text: blocks.filter(b => b?.type === "text").map(b => b.text || "").join("\n"), omitted: 0 }
      : call.result,
  };
};

const changeKind = (call, args) => {
  if (READS.has(call.name)) return "read";
  if (CHANGES.has(call.name)) return "change";
  if (call.name !== "str_replace_editor") return null;
  if (args?.command === "view") return "read";
  return ["str_replace", "insert", "create"].includes(args?.command) ? "change" : null;
};

/**
 * The installed context plugin's `contextTimeline` projection, read for a live session.
 * The Host is the only computation site, so this is the full value rather than the slim
 * broadcast head. Absent when that plugin is not mounted or the session is not live.
 */
export function readContextTimeline(ctx, sessionId) {
  try {
    const sessions = ctx.get("sessions"), projections = ctx.get("sessionProjections");
    const session = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : undefined;
    if (!session || !projections || typeof projections.snapshot !== "function") return undefined;
    const cut = projections.snapshot(session, ["contextTimeline"]);
    const value = cut && cut.values ? cut.values.contextTimeline : undefined;
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The layers the page can derive from recorded events alone. */
export function traceContext(events, payload, timeline) {
  const session = payload.sessions[0];
  const bySeq = new Map(events.filter(e => Number.isFinite(e.seq)).map(e => [e.seq, e]));
  const callBySeq = new Map(events.filter(e => e.type === "tool/call").map(e => [e.seq, e]));
  const callByCallId = new Map(events.filter(e => e.type === "tool/call").map(e => [e.data.callId, e]));

  const callFacts = {};
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    callFacts[call.seq] = describeCall(fullCall(call, bySeq.get(call.seq), bySeq.get(call.resultSeq)));
  }

  // 文件操作只取直接的文件工具,不从 shell 命令里猜读写。
  const fileOperations = [];
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    const native = bySeq.get(call.seq), result = bySeq.get(call.resultSeq);
    let args = native?.data?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
    const kind = changeKind(call, args);
    const path = result?.data?.meta?.path || call.target || args?.file_path || args?.path;
    if (!kind || typeof path !== "string" || !path) continue;
    fileOperations.push({
      turn: turn.number, step: step.number, seq: call.seq, resultSeq: call.resultSeq,
      time: call.end ?? call.start, kind, path, tool: call.name, status: call.status,
      recordedPath: typeof result?.data?.meta?.path === "string",
    });
  }

  // 压缩与裁短分开记:压缩是摘要替换,裁短是工具返回被就地替换。
  const prunes = new Map();
  for (const event of events) {
    const shadowed = event.data?.shadowedSeqs;
    if (!Array.isArray(shadowed) || !shadowed.length) continue;
    const replaced = shadowed.map(seq => {
      const source = bySeq.get(seq)?.data?.message?.source;
      const call = source?.kind === "tool" ? callByCallId.get(source.callId) : null;
      return { seq, turn: call?.data?.turn ?? null, step: call?.data?.step ?? null, tool: call?.data?.name ?? null };
    });
    prunes.set(event.seq, { seq: event.seq, time: event.time, kind: "prune",
      turn: event.data?.turn ?? null, step: event.data?.step ?? null,
      tools: [...new Set(replaced.map(r => r.tool).filter(Boolean))], replaced });
  }
  const boundaries = [];
  if (timeline && Array.isArray(timeline.events) && timeline.events.length) {
    for (const entry of timeline.events) {
      if (entry.kind !== "compaction" && entry.kind !== "prune") continue;
      const prune = entry.kind === "prune" ? prunes.get(entry.seq) : undefined;
      boundaries.push({ seq: entry.seq, time: entry.time, kind: entry.kind, turn: entry.turn ?? null,
        step: entry.step ?? null, tokens: entry.tokens ?? null, ...(prune ? { tools: prune.tools, replaced: prune.replaced } : {}) });
    }
  } else {
    for (const event of events) {
      if (event.type === "compaction/start") {
        boundaries.push({ seq: event.seq, time: event.time, kind: "compaction",
          turn: event.data?.turn ?? null, step: event.data?.step ?? null });
      }
    }
    boundaries.push(...prunes.values());
  }
  boundaries.sort((a, b) => a.seq - b.seq);

  // 重试:llm/retry 只表示安排重试,llm/retry-started 才确认开始。
  const retryStarted = events.filter(e => e.type === "llm/retry-started")
    .map(e => ({ seq: e.seq, time: e.time, ...e.data }));
  const retries = events.filter(e => e.type === "llm/retry").map(e => {
    const start = retryStarted.find(r => r.retryId === e.data.retryId && r.retry === e.data.retry && r.seq > e.seq);
    const responded = Boolean(start && events.some(r => r.type === "assistant/message" && typeof r.surfaceOp !== "object"
      && r.seq > start.seq && r.data?.turn === e.data.turn && r.data?.step === e.data.step));
    return { seq: e.seq, time: e.time, turn: e.data.turn, step: e.data.step, delayMs: e.data.delayMs || 0,
      failure: { code: e.data.failure?.code || "UNKNOWN" }, started: Boolean(start), responded, startedSeq: start?.seq ?? null };
  });

  const supplement = new Map();
  for (const event of events) {
    if (event.type !== "user/message" && event.type !== "developer/message") continue;
    const kind = (event.data.source || event.data.message?.source)?.kind;
    if (!kind || kind === "user" || kind === "skill-catalog" || kind === "skill-invocation") continue;
    supplement.set(kind, (supplement.get(kind) || 0) + 1);
  }
  const supplementSources = [...supplement].map(([kind, count]) => ({ kind, count }));

  const context = { callFacts, fileOperations, boundaries, retryStarted, retries, supplementSources,
    // 页面按数组直接遍历这份请求构成;没有 contextTimeline 时也必须给出空表。
    requests: Array.isArray(timeline?.requests) ? timeline.requests : [],
    skillEvents: skillEvents(events, session) };
  if (timeline) {
    if (timeline.current) context.current = timeline.current;
    if (timeline.provider || timeline.model) {
      context.route = { provider: timeline.provider, model: timeline.model, reasoningEffort: timeline.reasoningEffort };
    }
  }
  return context;
}

/** Skill 的读入记录:目录、显式引用,以及 skill 工具真实返回的正文。 */
export function skillEvents(events, session) {
  const locate = time => {
    const turn = session.turns.find(t => time <= (t.end ?? Infinity)) || session.turns.at(-1);
    const step = turn?.steps.find(s => time <= s.end) || turn?.steps.at(-1);
    return { turn: turn?.number, step: step?.number };
  };
  const records = [];
  for (const event of events) {
    const source = event.data?.source || event.data?.message?.source;
    if (!["skill-catalog", "skill-invocation"].includes(source?.kind)) continue;
    records.push({ id: "skill:" + event.seq, seq: event.seq, time: event.time, ...locate(event.time),
      source: "dsh-record", kind: source.kind === "skill-catalog" ? "catalog" : "explicit-skill-reference",
      name: source.name, entries: (source.entries || []).map(s => ({ name: s.name, description: s.description })) });
  }
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    if (call.name !== "skill" || call.status !== "returned") continue;
    const name = call.result?.text?.match(/<skill_content\s+name="([^"]+)"/)?.[1];
    if (!name) continue;
    records.push({ id: "skill-tool:" + call.seq, seq: call.seq, resultSeq: call.resultSeq,
      time: call.end ?? call.start, turn: turn.number, step: step.number, name, kind: "skill-tool-load",
      status: "returned", source: "dsh-skill-tool",
      baseDirectory: call.result.text.match(/Base directory for this skill:\s*([^\r\n]+)/)?.[1] || null });
  }
  records.sort((a, b) => a.time - b.time || a.seq - b.seq);
  return records;
}

/**
 * Skill 正文在模型可见历史里的存续区间,以及子代理支线。
 * Child sessions are read through the same Session query service as the main one.
 */
export async function traceActors(events, payload, skillRecords, readEvents) {
  const session = payload.sessions[0];
  const until = events.at(-1)?.time ?? Date.now();
  const requestSeqs = events.filter(e => e.type === "request/header").map(e => e.seq);
  let skillAnalysis = null;
  try {
    // 官方 surface 回放只在 Skill 层用到;拿不到安装目录时其余层照常工作。
    const { SurfaceManager } = await import("@deepseek-ai/dsh-session/surface");
    skillAnalysis = replaySkillEvidence(events, skillRecords.filter(e => e.kind === "skill-tool-load"), requestSeqs, SurfaceManager);
  } catch {
    skillAnalysis = null;
  }

  const agentBranches = [];
  for (const catalog of events.filter(e => e.type === "subagent/catalog")) {
    const id = catalog.data?.childId;
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]+$/.test(id)) continue;
    const reports = session.communications
      .filter(c => c.childId === id)
      .map(c => ({ time: c.time, kind: c.kind === "subagent-settled" ? "completed" : "report", text: (c.content.text || "").slice(0, 5000) }));
    let child = null;
    try {
      const childEvents = await readEvents(id);
      if (Array.isArray(childEvents) && childEvents.length) {
        child = buildTracePayload(childEvents.filter(e => e.time <= until), id).sessions[0];
      }
    } catch {
      child = null;
    }
    const childCalls = child ? child.turns.flatMap(t => t.steps.flatMap(s => s.calls)) : [];
    const childFacts = Object.fromEntries(childCalls.map(c => [c.seq, describeCall(c)]));
    const childFiles = childCalls.flatMap(c => {
      const kind = READS.has(c.name) ? "read" : CHANGES.has(c.name) ? "change" : null;
      return kind && childFacts[c.seq]?.target ? [{ seq: c.seq, kind, path: childFacts[c.seq].target }] : [];
    });
    const results = child ? collectToolResults(child, childFacts, childFiles) : [];
    const launch = session.turns.flatMap(t => t.steps.flatMap(s => s.calls.map(c => ({ t, s, c }))))
      .find(({ c }) => c.name === "subagent" && c.result?.text?.includes(id));
    // 没有匹配到委派调用时,按目录事件的时间落到最近的轮次,不能留一个定位不到的支线。
    const locate = time => {
      const turn = session.turns.find(t => time <= (t.end ?? Infinity)) || session.turns.at(-1);
      const step = turn?.steps.find(s => time <= s.end) || turn?.steps.at(-1);
      return { turn: turn?.number ?? null, step: step?.number ?? null };
    };
    const fallback = launch ? { turn: launch.t.number, step: launch.s.number } : locate(catalog.time);
    const steps = child ? child.turns.flatMap(t => t.steps.map(s => ({
      id: id + ":" + t.number + ":" + s.number, number: s.number, start: s.start, end: s.end,
      label: s.calls.length ? s.calls.map(c => describeCall(c).title).join(" · ") : "整理回复",
      kind: !s.calls.length ? "reply" : /read|grep|glob/.test(s.calls[0].name) ? "read" : /edit|write|patch/.test(s.calls[0].name) ? "write" : /search|query/.test(s.calls[0].name) ? "query" : "run",
      status: s.calls.some(c => c.status === "error") ? "error" : "returned",
      detail: s.calls.map(c => ({ seq: c.seq, name: c.name, target: c.target, status: c.status,
        outcome: describeCall(c).outcome, result: c.result?.text?.slice(0, 1500) })),
    }))) : [];
    agentBranches.push({
      id, name: catalog.data.label || "子代理", title: catalog.data.label || "子任务",
      start: catalog.data.childCreatedAt || catalog.time, end: child?.turns.at(-1)?.end ?? null,
      returnTime: reports.at(-1)?.time ?? null,
      turn: fallback.turn, step: fallback.step, seq: launch?.c.seq ?? catalog.seq,
      status: reports.some(r => r.kind === "completed") ? "completed" : "unknown",
      steps, results, reports, source: "dsh-record",
    });
  }
  return { skillAnalysis, agentBranches };
}
