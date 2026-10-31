import { createHash } from 'node:crypto';
import { projectSession } from './inspect-models/session.js';
import { describeOperation } from './inspect-models/operations.mjs';
import { replayOfficialStats, estimateToolsTokens } from './official-stats.js';
import { costRequests, costTotals, costCoverage } from './usage.js';
import { buildRelations } from './linked-read.js';

export const INSPECT_VIEWS = ['overview', 'latency', 'cost', 'repeats', 'io', 'context'];
const replacement = e => e.surfaceOp && typeof e.surfaceOp === 'object';
const text = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const hash = value => createHash('sha256').update(value).digest('base64url');
const clip = (value, max = 180) => { const s = String(value || ''); return { text: Buffer.from(s.slice(0, max), 'utf16le').toString('utf16le'), omitted: Math.max(0, s.length - max) }; };
const inRange = (n, range) => !range || n >= range.from && n <= range.to;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sum = values => { const known = values.filter(v => v != null); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const pathKey = value => { const p = value.replace(/\\+/g, '/').replace(/\/+/g, '/'); return /^[a-z]:\//i.test(p) ? p.toLowerCase() : p; };
const METRICS = ['wall', 'ttft', 'model', 'decode', 'tool', 'toolWall', 'retries', 'toolErrors', 'output'];
const outsideStep = s => finite(s.official.toolWall) !== null && finite(s.official.wall) !== null && s.official.toolWall > s.official.wall + 1;
const sumSteps = steps => {
  const totals = Object.fromEntries(METRICS.map(k => [k, sum(steps.map(s => s.official[k]))]));
  // Preserve official per-step readings. A call spanning beyond a step cannot
  // decompose that step's active time (including later copies/background work).
  if (steps.some(outsideStep)) totals.toolWall = null;
  return totals;
};

export async function readOfficialProjections(ctx, loaded, signal) {
  const registry = ctx.get('sessionProjections');
  if (!registry?.restore || !loaded.header) return { values: {}, source: 'unavailable' };
  let checkpoint = {}, snapshot;
  const deadline = performance.now() + 8000;
  for (let i = 0; i < loaded.events.length; i += 1000) {
    signal?.throwIfAborted();
    if (performance.now() > deadline) throw Error('Official projection replay exceeded its time budget');
    const batch = loaded.events.slice(i, i + 1000);
    const restored = registry.restore(checkpoint, batch, batch[0].seq, loaded.header, loaded.inherited || 0);
    checkpoint = restored.checkpoint; snapshot = restored.snapshot;
    await new Promise(resolve => setImmediate(resolve));
  }
  return { values: snapshot?.values || {}, source: 'sessionProjections.restore', asOfSeq: snapshot?.asOfSeq ?? null };
}

function schemaInventory(events) {
  const definitions = new Map(), uses = new Map(), roots = new Map(), seen = new Set(), estimates = new Map();
  let turn = null, headerChanges = 0, metadataChanges = 0, metadataChangesWithoutHeader = 0, knownHeader = false;
  let active = new Set();
  for (const event of events) {
    if (replacement(event)) continue;
    const d = event.data || {};
    if (event.type === 'turn/start') turn = d.turn;
    if (event.type === 'tool/call') roots.set(d.callId, d.turn ?? turn);
    if (event.type === 'request/header') {
      headerChanges++; knownHeader = true;
      const next = new Set((d.header?.tools || []).map(s => s.name).filter(Boolean));
      for (const name of active) if (!next.has(name)) definitions.get(name).intervals.at(-1).toSeq = event.seq - 1;
      for (const schema of d.header?.tools || []) {
        if (!schema.name) continue;
        const version = hash(JSON.stringify(schema));
        if (!estimates.has(version)) estimates.set(version, estimateToolsTokens({ tools: [schema] }));
        let item = definitions.get(schema.name);
        if (!item) {
          item = { name: schema.name, owner: null, versions: new Set(), standaloneEstimatedTokens: 0, deferredRequested: false,
            firstHeaderSeq: event.seq, lastHeaderSeq: event.seq, intervals: [] };
          definitions.set(schema.name, item);
        }
        item.versions.add(version); item.lastHeaderSeq = event.seq;
        item.standaloneEstimatedTokens = Math.max(item.standaloneEstimatedTokens, estimates.get(version));
        item.deferredRequested ||= schema.deferLoading === true;
        if (!active.has(schema.name)) item.intervals.push({ fromSeq: event.seq, toSeq: null });
      }
      active = next;
    }
    if (event.type === 'request/context') { metadataChanges++; if (!knownHeader) metadataChangesWithoutHeader++; }
    if (['tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start'].includes(event.type)) {
      const key = event.type === 'tool/call' ? 'root:' + d.callId : JSON.stringify([d.rootCallId, d.subCallId]);
      const id = d.callId || d.subCallId ? key : 'seq:' + event.seq;
      if (d.name && !seen.has(id)) {
        seen.add(id);
        const t = d.turn ?? roots.get(d.rootCallId) ?? turn, k = JSON.stringify([d.name, t]);
        if (!uses.has(k)) uses.set(k, { name: d.name, turn: t, count: 0 });
        uses.get(k).count++;
      }
    }
  }
  return { source: '@deepseek-ai/dsh-token-meter/estimate', basis: 'official-standalone-estimate',
    headerChanges, metadataChanges, metadataChangesWithoutHeader,
    definitions: [...definitions.values()].map(d => ({ ...d, versions: d.versions.size })),
    invocations: [...uses.values()],
    coverage: { owners: 'not recorded in tool schemas', embeddedCatalogs: 'not separated from system text',
      measurement: 'Definition sizes are estimates; metadata changes are not requests/exposures. Invocation counts do not establish necessity.' } };
}

export function buildInspection(loaded, sessionId, { turns = null, projections = { values: {} }, statsReader = replayOfficialStats } = {}) {
  const events = loaded.events, bySeq = new Map(events.map(e => [e.seq, e]));
  const scope = { session: sessionId, turns, fromSeq: events[0]?.seq ?? null, toSeq: events.at(-1)?.seq ?? null };
  const anchors = Object.fromEntries(events.map(e => [e.seq, hash(JSON.stringify(e))]));
  const coverage = {}, views = Object.fromEntries(INSPECT_VIEWS.map(v => [v, []])), stepEntries = [];
  const relations = buildRelations(events), usageRows = costRequests(events);
  let native;
  try { native = projectSession([{ type: 'session', id: sessionId, version: 4 }, ...events], { cwd: loaded.header?.cwd }); }
  catch (error) { native = { turns: [] }; coverage.native = { status: 'unavailable', reason: error.message }; }
  const nativeSteps = new Map(), calls = [], callsByStep = new Map();
  for (const t of native.turns) for (const s of t.steps) {
    if (!inRange(t.number, turns)) continue;
    nativeSteps.set(t.number + ':' + s.number, { seq: s.seq, assistantSeq: s.assistantSeq, start: s.start, end: s.end, following: clip(s.reply?.text, 220) });
    for (const call of s.calls) {
      const raw = bySeq.get(call.seq)?.data || {}, result = bySeq.get(call.resultSeq)?.data || {};
      const output = text(result.message?.content || result.content), args = json(raw.arguments);
      const detail = describeOperation(call, args, output, result.meta, loaded.header?.cwd);
      calls.push({ seq: call.seq, resultSeq: call.resultSeq, startSeq: call.startSeq ?? call.seq, rootSeq: call.rootSeq ?? null,
        name: call.name, turn: t.number, step: s.number, signature: call.signature, status: call.status, start: call.start, end: call.end,
        args: clip(typeof raw.arguments === 'string' ? raw.arguments : JSON.stringify(raw.arguments || {})), result: clip(output),
        resultHash: call.resultSeq == null ? null : hash(output), outputCharacters: output.length,
        family: detail.family, files: detail.files.slice(0, 8).map(f => ({ path: f.path, access: f.access, matchedLines: f.lines?.length || 0 })),
        omittedFiles: Math.max(0, detail.files.length - 8), search: detail.search ? { total: detail.search.total, shown: detail.search.shown, truncated: detail.search.truncated } : null });
    }
  }
  let official;
  for (const c of calls) { const k = c.turn + ':' + c.step; if (!callsByStep.has(k)) callsByStep.set(k, []); callsByStep.get(k).push(c); }
  try { official = statsReader(events); coverage.statistics = { status: 'available', source: official.source, hash: official.hash }; }
  catch (error) { official = { snapshot: { turns: [] } }; coverage.statistics = { status: 'unavailable', reason: error.message }; }
  for (const s of official.snapshot.turns.filter(t => inRange(t.turn, turns)).flatMap(t => t.steps)) {
    const own = callsByStep.get(s.turn + ':' + s.step) || [];
    const entry = { turn: s.turn, step: s.step,
      official: Object.fromEntries([...METRICS, 'cacheRead', 'cacheWrite', 'cacheHit', 'context'].map(k => [k, finite(s[k])])),
      tools: s.tools, evidence: { ...nativeSteps.get(s.turn + ':' + s.step),
        callSeqs: own.slice(0, 3).map(c => c.seq), omittedCalls: Math.max(0, own.length - 3) } };
    const key = stepEntries.push(entry) - 1; views.latency.push(key); views.cost.push(key);
  }
  views.latency.sort((a, b) => (stepEntries[b].official.wall ?? -1) - (stepEntries[a].official.wall ?? -1));
  views.cost.sort((a, b) => ((stepEntries[b].official.context ?? 0) + (stepEntries[b].official.output ?? 0)) - ((stepEntries[a].official.context ?? 0) + (stepEntries[a].official.output ?? 0)));
  const groups = new Map();
  for (const c of calls) {
    const { signature, resultHash, ...proof } = c;
    views.io.push({ ...proof, callSeq: c.seq, stepSeq: nativeSteps.get(c.turn + ':' + c.step)?.seq ?? null });
    if (!signature) continue;
    const key = c.turn + ':' + signature; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c);
  }
  for (const own of groups.values()) if (own.length >= 2) views.repeats.push({
    name: own[0].name, turn: own[0].turn, count: own.length, seq: own[0].seq,
    sameReturnedText: own.every(c => c.resultHash !== null && c.resultHash === own[0].resultHash),
    classification: own[0].family === 'process' ? 'polling-or-task-operation' : 'repeat-candidate',
    evidenceSeqs: [own[0].seq, own.at(-1).seq], omittedCalls: Math.max(0, own.length - 2),
    files: [...new Set(own.flatMap(c => c.files.map(f => f.path)))].slice(0, 8) });
  views.repeats.sort((a, b) => b.count - a.count);
  views.io.sort((a, b) => b.outputCharacters - a.outputCharacters || a.seq - b.seq);
  const values = projections.values || {}, requests = values.contextTimeline?.requests || [];
  coverage.projections = { source: projections.source || 'unavailable', keys: ['tokenUsage', 'contextBreakdown', 'contextPressure', 'contextTimeline'].filter(k => values[k] !== undefined),
    ...(projections.error ? { reason: projections.error } : {}) };
  coverage.context = { source: projections.source || 'unavailable', firstRecordedTurn: requests[0]?.turn ?? null,
    status: requests.length ? requests[0].turn > (turns?.from ?? native.turns[0]?.number ?? 1) ? 'partial' : 'available' : 'unavailable' };
  let relatedAt = 0;
  for (let i = 1; i < requests.length; i++) {
    const before = requests[i - 1], after = requests[i], relatedEvents = [];
    while (relatedAt < events.length && events[relatedAt].seq <= before.seq) relatedAt++;
    while (relatedAt < events.length && events[relatedAt].seq <= after.seq) {
      const e = events[relatedAt++];
      if (relatedEvents.length < 5 && /^(?:compaction\/|tool\/result|tool\/ptc-dispatch$)/.test(e.type)) relatedEvents.push({ seq: e.seq, type: e.type });
    }
    if (!inRange(after.turn, turns)) continue;
    views.context.push({ turn: after.turn, step: after.step, seq: after.seq,
      before: { seq: before.seq, total: before.total }, after: { seq: after.seq, total: after.total },
      categoryNetChange: Object.fromEntries(['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'].map(k => [k, finite(after[k]) !== null && finite(before[k]) !== null ? after[k] - before[k] : null])),
      net: finite(after.total) !== null && finite(before.total) !== null ? after.total - before.total : null, relatedEvents });
  }
  views.context.sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0));
  const inventory = schemaInventory(events);
  inventory.definitions.sort((a, b) => b.standaloneEstimatedTokens - a.standaloneEstimatedTokens);
  const definitions = inventory.definitions.map(d => ({ ...d, invocationsInScope: inventory.invocations.filter(u => u.name === d.name && inRange(u.turn, turns)).reduce((n, u) => n + u.count, 0) }));
  const turnEntries = native.turns.filter(t => inRange(t.number, turns)).map(t => {
    const own = stepEntries.filter(s => s.turn === t.number), meta = relations.turns[t.number];
    const promptSeqs = meta?.userSeqs || t.prompts.map(p => p.seq), prompt = promptSeqs.map(seq => text(bySeq.get(seq)?.data?.content)).filter(Boolean).join('\n');
    const last = [...t.steps].reverse().find(s => s.reply?.text);
    const toolCounts = {}; for (const c of calls.filter(c => c.turn === t.number)) toolCounts[c.name] = (toolCounts[c.name] || 0) + 1;
    return { turn: t.number, seq: t.seq, endSeq: t.endSeq, status: t.reason?.kind || 'open', steps: own.length,
      prompt: clip(prompt || t.prompts[0]?.text, 600), promptSeqs, following: clip(last?.reply?.text, 500),
      replySeq: last?.assistantSeq ?? null, official: sumSteps(own), toolCounts,
      markers: t.markers.map(m => ({ seq: m.seq, type: m.type })) };
  });
  const summary = { steps: stepEntries.length, nativeCallsForEvidence: calls.length,
    tokenUsageWholeSession: values.tokenUsage || null, contextBreakdownAtCut: values.contextBreakdown || null,
    contextPressureAtCut: values.contextPressure || null,
    toolDefinitions: { ...inventory, invocations: undefined, definitions, definitionCount: definitions.length },
    statisticsScope: 'official step metrics; whole-session projections and at-cut composition labeled separately' };
  return JSON.parse(JSON.stringify({ scope, coverage, summary, views, stepEntries, turnEntries, usageRows,
    // Tuples avoid retaining a second set of long field names per request.
    contextSamples: requests.map(r => ['seq', 'turn', 'step', 'time', 'system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total'].map(k => r[k] ?? null)),
    declarationInvocations: inventory.invocations, definitionItems: definitions.filter(d => d.invocationsInScope === 0), anchors, relations }));
}

function matches(call, focus) {
  if (!focus) return true;
  return focus.tool ? call.name === focus.tool : (call.files || []).some(f => pathKey(typeof f === 'string' ? f : f.path) === pathKey(focus.file));
}
function usageFor(index, turns, stepKeys) {
  const own = index.usageRows.filter(r => inRange(r.turn, turns) && (!stepKeys || stepKeys.has(r.turn + ':' + r.step)));
  const { requests, unknownRequests, ...totals } = costTotals(own);
  return { settlements: requests, unknownSettlements: unknownRequests, ...totals, coverage: costCoverage(own),
    basis: 'recorded assistant/message usage settlements; missing buckets remain null' };
}
function groupCalls(calls, by) {
  const groups = new Map();
  for (const c of calls) for (const name of new Set(by === 'tool' ? [c.name] : c.files.map(f => f.path))) {
    const key = by === 'file' ? pathKey(name) : name;
    if (!groups.has(key)) groups.set(key, { [by]: name, calls: 0, errors: 0, returnedCharacters: 0, seq: c.seq, lastSeq: c.seq, turns: { from: c.turn, to: c.turn }, examples: [], access: {} });
    const g = groups.get(key); g.calls++; if (c.status === 'error') g.errors++;
    g.returnedCharacters = g.returnedCharacters == null || c.outputCharacters == null ? null : g.returnedCharacters + c.outputCharacters;
    g.seq = Math.min(g.seq, c.seq); g.lastSeq = Math.max(g.lastSeq, c.seq);
    g.turns.from = Math.min(g.turns.from, c.turn); g.turns.to = Math.max(g.turns.to, c.turn);
    if (g.examples.length < 3) g.examples.push({ seq: c.seq, turn: c.turn, step: c.step });
    for (const f of c.files) if (by !== 'file' || pathKey(f.path) === key) g.access[f.access] = (g.access[f.access] || 0) + 1;
  }
  return [...groups.values()];
}
export function inspectionPage(index, view, offset = 0, limit = 3, options = {}) {
  const { turns = index.scope.turns, focus, groupBy, sort, samples = true } = options;
  const calls = index.views.io.filter(c => inRange(c.turn, turns) && matches(c, focus));
  const callBySeq = new Map(index.views.io.map(c => [c.seq, c]));
  // Code Mode is unwrapped for operation statistics, but a query for its actual
  // transport name must still locate the outer calls and owning whole steps.
  if (focus?.tool) for (const root of index.relations.calls) {
    if (root.name !== focus.tool || callBySeq.has(root.callSeq)) continue;
    const [turn, step] = index.relations.locations[root.callSeq] || [];
    if (!inRange(turn, turns)) continue;
    const transport = { seq: root.callSeq, callSeq: root.callSeq, resultSeq: root.resultSeq, turn, step,
      name: root.name, family: 'transport', transportOnly: true, files: [], outputCharacters: null,
      status: root.resultSeq == null ? 'unknown' : 'returned' };
    calls.push(transport); callBySeq.set(root.callSeq, transport);
  }
  const focusSteps = focus ? new Set(calls.map(c => c.turn + ':' + c.step)) : null;
  const steps = index.stepEntries.filter(s => inRange(s.turn, turns) && (!focusSteps || focusSteps.has(s.turn + ':' + s.step)));
  const allowedTurns = new Set([...steps.map(s => s.turn), ...calls.map(c => c.turn)]);
  const ownTurns = index.turnEntries.filter(t => inRange(t.turn, turns) && (!focus || allowedTurns.has(t.turn)));
  const scope = { ...index.scope, turns: turns || null, ...(focus ? { focus, metricsScope: 'whole steps containing matching calls; not per-object token/time attribution' } : {}) };
  const hydration = s => !samples ? s : ({ ...s, evidence: { ...s.evidence, callSeqs: undefined,
    prompt: index.turnEntries.find(t => t.turn === s.turn)?.prompt,
    calls: s.evidence.callSeqs.map(seq => callBySeq.get(seq)).filter(Boolean) } });
  const groupTurn = (ts, compact = false) => {
    const ids = new Set(ts.map(t => t.turn)), ss = steps.filter(s => ids.has(s.turn));
    const usage = usageFor(index, { from: ts[0].turn, to: ts.at(-1).turn }, new Set(ss.map(s => s.turn + ':' + s.step)));
    const counts = Object.fromEntries([...new Set(ts.flatMap(t => Object.keys(t.toolCounts)))].map(n => [n, ts.reduce((v, t) => v + (t.toolCounts[n] || 0), 0)]));
    const toolPairs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const largest = [...ts].sort((a, b) => (b.official.wall ?? -1) - (a.official.wall ?? -1))[0];
    const sampleTurns = [...new Set(compact ? [ts[0], ts.at(-1), largest] : [ts[0], ts[Math.floor((ts.length - 1) / 2)], ts.at(-1), largest])];
    const small = (e, max) => ({ ...clip(e.text, max), omitted: e.omitted + Math.max(0, e.text.length - max) });
    return { turns: { from: ts[0].turn, to: ts.at(-1).turn }, seq: ts[0].seq, endSeq: ts.at(-1).endSeq,
      steps: ss.length, official: sumSteps(ss), usage: compact ? { settlements: usage.settlements, input: usage.input, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, output: usage.output,
        ...(usage.unknownSettlements ? { unknownSettlements: usage.unknownSettlements } : {}) } : usage,
      ...(samples ? { samples: sampleTurns.map(t => ({ turn: t.turn, seq: t.seq, promptSeqs: t.promptSeqs, prompt: compact ? small(t.prompt, 180) : t.prompt,
        following: compact ? small(t.following, 140) : t.following, replySeq: t.replySeq, status: t.status })) } : {}),
      toolCounts: compact ? Object.fromEntries(toolPairs.slice(0, 6)) : counts,
      ...(compact && toolPairs.length > 6 ? { omittedToolKinds: toolPairs.length - 6, otherCalls: toolPairs.slice(6).reduce((n, p) => n + p[1], 0) } : {}),
      markers: ts.flatMap(t => t.markers).slice(0, compact ? 4 : 8) };
  };
  let rows;
  if (view === 'overview') {
    if (groupBy === 'tool' || groupBy === 'file') rows = groupCalls(calls, groupBy);
    else if (groupBy === 'turn') rows = ownTurns.map(t => groupTurn([t]));
    else { rows = []; const size = Math.max(1, Math.ceil(ownTurns.length / 6)); for (let i = 0; i < ownTurns.length; i += size) rows.push(groupTurn(ownTurns.slice(i, i + size), true)); }
  } else if (view === 'latency' || view === 'cost') {
    rows = groupBy === 'turn' ? ownTurns.map(t => groupTurn([t])) : steps.map(s => ({ ...hydration(s), usage: usageFor(index, { from: s.turn, to: s.turn }, new Set([s.turn + ':' + s.step])) }));
  } else if (view === 'io') rows = groupBy ? groupCalls(calls, groupBy) : calls;
  else if (view === 'repeats') rows = index.views.repeats.filter(r => inRange(r.turn, turns) && matches(r, focus)).map(r => ({ ...r, evidenceSeqs: undefined, evidence: r.evidenceSeqs.map(seq => callBySeq.get(seq)) }));
  else rows = index.views.context.filter(r => inRange(r.turn, turns) && (!focusSteps || focusSteps.has(r.turn + ':' + r.step)));
  const order = sort || (view === 'latency' ? 'wall' : view === 'cost' ? 'input' : view === 'io' ? 'returned' : view === 'repeats' ? 'count' : view === 'context' ? 'change' : 'time');
  const value = row => order === 'wall' ? row.official?.wall : order === 'input' ? row.usage?.input : order === 'output' ? row.usage?.output :
    order === 'returned' ? row.returnedCharacters ?? row.outputCharacters : order === 'count' ? row.calls ?? row.count : order === 'change' ? Math.abs(row.net ?? 0) : row.seq;
  rows.sort((a, b) => order === 'time' ? (value(a) ?? Infinity) - (value(b) ?? Infinity) : (value(b) ?? -1) - (value(a) ?? -1) || (a.seq ?? 0) - (b.seq ?? 0));
  const startSeq = ownTurns[0]?.seq ?? index.scope.fromSeq, endSeq = ownTurns.at(-1)?.endSeq ?? index.scope.toSeq;
  const declarationPoints = [...index.usageRows.filter(r => inRange(r.turn, turns)).map(r => r.seq), ...index.views.io.filter(r => inRange(r.turn, turns)).map(r => r.seq)];
  const definitions = index.summary.toolDefinitions.definitions.filter(d => (!turns || ownTurns.length) && d.intervals.some(i => declarationPoints.length
    ? declarationPoints.some(seq => seq >= i.fromSeq && (i.toSeq == null || seq <= i.toSeq))
    : i.fromSeq <= endSeq && (i.toSeq == null || i.toSeq >= startSeq))).map(d => ({
    ...d, intervals: undefined, invocationsInScope: index.declarationInvocations.filter(u => u.name === d.name && inRange(u.turn, turns)).reduce((v, u) => v + u.count, 0) }));
  const uncalled = definitions.filter(d => !d.invocationsInScope);
  const coverage = structuredClone(index.coverage);
  const outsideCount = steps.filter(outsideStep).length;
  if (outsideCount) coverage.timing = { toolSpansOutsideStep: outsideCount,
    toolWallAggregate: 'withheld: recorded call spans exceed active step; per-step raw official values preserved',
    tool: 'sum of paired call durations, may overlap; not tool wall coverage' };
  if (coverage.context.status !== 'unavailable') coverage.context.status = coverage.context.firstRecordedTurn > (turns?.from ?? ownTurns[0]?.turn ?? 1) ? 'partial' : 'available';
  const summary = { turns: ownTurns.length, steps: steps.length, calls: calls.length, official: sumSteps(steps),
    usage: usageFor(index, turns, focusSteps), timingUnit: 'ms; sums of official active steps, not session elapsed time' };
  if (view === 'overview' || view === 'cost') Object.assign(summary, {
    tokenUsageWholeSession: index.summary.tokenUsageWholeSession, contextBreakdownAtCut: index.summary.contextBreakdownAtCut,
    contextPressureAtCut: index.summary.contextPressureAtCut,
    toolDefinitions: { ...index.summary.toolDefinitions, definitions: undefined, definitionCount: definitions.length, scope: 'declarations active at recorded settlements/calls in selected turns; metadata counters cover the whole cut' } });
  return { scope, coverage, summary, groupBy: groupBy || (view === 'overview' ? 'window' : view === 'io' ? 'call' : 'step'), sort: order,
    totalEntries: rows.length, offset, items: rows.slice(offset, offset + limit),
    ...(view === 'overview' ? { availableViews: ['latency', 'cost', 'repeats', 'io', 'context'] } : {}),
    ...(groupBy === 'file' ? { groupingNote: 'Calls touching several files occur in several groups; character counts describe the full call result.' } : {}),
    ...(view === 'cost' ? { largestDefinitions: definitions.slice(offset, offset + limit), uncalledDefinitionCandidates: uncalled.slice(offset, offset + limit), totalUncalledDefinitionCandidates: uncalled.length } : {}),
    nextOffset: offset + limit < Math.max(rows.length, view === 'cost' ? Math.max(definitions.length, uncalled.length) : 0) ? offset + limit : null };
}
export function evidencePointers(packet) {
  const refs = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (['seq', 'stepSeq', 'callSeq', 'resultSeq', 'startSeq', 'rootSeq', 'firstHeaderSeq', 'lastHeaderSeq', 'replySeq'].includes(key) && Number.isSafeInteger(field)) refs.add(field);
      else if (field && typeof field === 'object') walk(field);
    }
  };
  walk(packet.items); walk(packet.uncalledDefinitionCandidates); walk(packet.largestDefinitions);
  return [...refs].map(seq => ({ session: packet.scope.session, seq }));
}
