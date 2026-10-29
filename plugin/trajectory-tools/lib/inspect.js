import { createHash } from 'node:crypto';
import { projectSession } from './inspect-models/session.js';
import { describeOperation } from './inspect-models/operations.mjs';
import { replayOfficialStats, estimateToolsTokens } from './official-stats.js';
import { INSPECT_METHODS, INSPECT_OUTPUT_RULE } from './inspect-methods.js';

export const INSPECT_VIEWS = Object.keys(INSPECT_METHODS);
const replacement = e => e.surfaceOp && typeof e.surfaceOp === 'object';
const text = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const hash = value => createHash('sha256').update(value).digest('base64url');
// Detach short excerpts from large V8 backing strings before caching a packet.
const clip = (value, max = 240) => { const s = String(value || ''); return { text: Buffer.from(s.slice(0, max), 'utf16le').toString('utf16le'), omitted: Math.max(0, s.length - max) }; };
const inRange = (n, range) => (!range || (n >= range.from && n <= range.to));
const sourceRef = (session, seq) => ({ session, seq });
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

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

function schemaInventory(events, range) {
  const definitions = new Map(), invocations = new Map(), roots = new Map(), seenCalls = new Set();
  let header = null, turn = null, contexts = 0, headerChanges = 0, missingHeaders = 0, schemaTokenRequests = 0;
  const remember = (schema, seq) => {
    if (!schema?.name) return;
    let item = definitions.get(schema.name);
    if (!item) { item = { name: schema.name, owner: null, versions: new Set(), standaloneEstimatedTokens: 0, exposureSamples: 0, deferredRequested: false, firstHeaderSeq: seq, lastHeaderSeq: seq }; definitions.set(schema.name, item); }
    item.versions.add(hash(JSON.stringify(schema)));
    item.standaloneEstimatedTokens = Math.max(item.standaloneEstimatedTokens, estimateToolsTokens({ tools: [schema] }));
    item.deferredRequested ||= schema.deferLoading === true; item.lastHeaderSeq = seq;
  };
  for (const event of events) {
    if (replacement(event)) continue;
    const d = event.data || {};
    if (event.type === 'turn/start') turn = d.turn;
    if (event.type === 'tool/call') roots.set(d.callId, d.turn ?? turn);
    if (event.type === 'request/header') { header = { value: d.header, seq: event.seq }; if (inRange(d.turn ?? turn, range)) { headerChanges++; for (const schema of d.header?.tools || []) remember(schema, event.seq); } }
    if (!inRange(d.turn ?? roots.get(d.rootCallId) ?? turn, range)) continue;
    if (event.type === 'request/context' && header) {
      contexts++; schemaTokenRequests += estimateToolsTokens(header.value);
      for (const schema of header.value?.tools || []) { remember(schema, header.seq); const item = definitions.get(schema.name); if (item) item.exposureSamples++; }
    }
    if (event.type === 'request/context' && !header) missingHeaders++;
    // Keep transport invocation evidence too: folding Code Mode for statistics
    // must not make its actually called run_code declaration appear unused.
    if (['tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start'].includes(event.type)) {
      const id = event.type === 'tool/call' ? d.callId : d.subCallId;
      const key = id ?? 'seq:' + event.seq;
      if (d.name && !seenCalls.has(key)) { seenCalls.add(key); invocations.set(d.name, (invocations.get(d.name) || 0) + 1); }
    }
  }
  return { source: '@deepseek-ai/dsh-token-meter/estimate', basis: 'official-fixed-density-estimate',
    headerChanges, requestSamples: contexts, requestSamplesWithoutHeader: missingHeaders,
    estimatedSchemaTokenRequests: contexts ? schemaTokenRequests : null, definitionCount: definitions.size,
    definitions: [...definitions.values()].map(item => ({ ...item, versions: item.versions.size,
      invocationsInScope: invocations.get(item.name) || 0, evidence: [item.firstHeaderSeq, item.lastHeaderSeq] })),
    coverage: { owners: 'unavailable-in-recorded-tool-schema', embeddedCatalogs: 'not-separated-from-system-or-injected-text',
      exposure: 'Only recorded request/context samples with a known header are counted; older requests without these records are not reconstructed.',
      measurement: 'Standalone schema estimates are not additive, billed tokens, or measured savings. A deferLoading flag is a request, not proof of adapter behavior.' } };
}

export function buildInspection(loaded, sessionId, { turns = null, projections = { values: {} }, statsReader = replayOfficialStats } = {}) {
  const events = loaded.events, eventBySeq = new Map(events.map(e => [e.seq, e]));
  const scope = { session: sessionId, turns, fromSeq: events[0]?.seq ?? null, toSeq: events.at(-1)?.seq ?? null };
  const anchors = Object.fromEntries(events.map(event => [event.seq, hash(JSON.stringify(event))]));
  const coverage = {}, views = Object.fromEntries(INSPECT_VIEWS.map(v => [v, []])), stepEntries = [];
  let native;
  try { native = projectSession([{ type: 'session', id: sessionId, version: 4 }, ...events], { cwd: loaded.header?.cwd }); }
  catch (error) { native = { turns: [] }; coverage.native = { status: 'unavailable', reason: String(error.message) }; }
  const nativeSteps = new Map(), calls = [], callsByStep = new Map();
  for (const t of native.turns) for (const s of t.steps) {
    if (!inRange(t.number, turns)) continue;
    nativeSteps.set(t.number + ':' + s.number, { seq: s.seq, prompt: clip(t.prompts[0]?.text, 160), following: clip(s.reply?.text, 180) });
    for (const call of s.calls) {
      const raw = eventBySeq.get(call.seq)?.data || {}, result = eventBySeq.get(call.resultSeq)?.data || {};
      const output = text(result.message?.content || result.content), args = json(raw.arguments);
      const detail = describeOperation(call, args, output, result.meta, loaded.header?.cwd);
      calls.push({ seq: call.seq, resultSeq: call.resultSeq, startSeq: call.startSeq ?? call.seq, rootSeq: call.rootSeq ?? null,
        name: call.name, turn: t.number, step: s.number, signature: call.signature, status: call.status,
        args: clip(typeof raw.arguments === 'string' ? raw.arguments : JSON.stringify(raw.arguments || {})), result: clip(output),
        resultHash: call.resultSeq == null ? null : hash(output), outputCharacters: output.length,
        family: detail.family, files: detail.files.slice(0, 8).map(f => ({ path: f.path, access: f.access, matchedLines: f.lines?.length || 0 })),
        omittedFiles: Math.max(0, detail.files.length - 8),
        metrics: detail.metrics, search: detail.search ? { total: detail.search.total, shown: detail.search.shown, truncated: detail.search.truncated } : null });
    }
  }
  let official;
  for (const call of calls) { const key = call.turn + ':' + call.step; if (!callsByStep.has(key)) callsByStep.set(key, []); callsByStep.get(key).push(call); }
  try { official = statsReader(events); coverage.statistics = { status: 'available', source: official.source, hash: official.hash }; }
  catch (error) { official = { snapshot: { turns: [] } }; coverage.statistics = { status: 'unavailable', reason: String(error.message) }; }
  const steps = official.snapshot.turns.filter(t => inRange(t.turn, turns)).flatMap(t => t.steps);
  const proof = call => ({ ...call, signature: undefined, resultHash: undefined, files: undefined });
  const neighbours = (t, s) => nativeSteps.get(t + ':' + s) || {};
  for (const s of steps) {
    const own = callsByStep.get(s.turn + ':' + s.step) || [];
    const numbers = Object.fromEntries(['wall', 'ttft', 'model', 'decode', 'tool', 'toolWall', 'retries', 'toolErrors', 'cacheRead', 'cacheWrite', 'cacheHit', 'output', 'context'].map(k => [k, finite(s[k])]));
    const entry = { turn: s.turn, step: s.step, official: numbers, tools: s.tools,
      evidence: { ...neighbours(s.turn, s.step), calls: own.slice(0, 3).map(proof), omittedCalls: Math.max(0, own.length - 3) } };
    const key = stepEntries.push(entry) - 1;
    views.latency.push(key); views.cost.push(key);
  }
  views.latency.sort((a, b) => (stepEntries[b].official.wall ?? -1) - (stepEntries[a].official.wall ?? -1));
  views.cost.sort((a, b) => ((stepEntries[b].official.context ?? 0) + (stepEntries[b].official.output ?? 0)) - ((stepEntries[a].official.context ?? 0) + (stepEntries[a].official.output ?? 0)));

  const groups = new Map();
  for (const call of calls) {
    if (!call.signature) continue;
    const key = call.turn + ':' + call.signature;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(call);
    if (call.files.length || ['read', 'write', 'search'].includes(call.family)) views.io.push({ ...proof(call), files: call.files, ...neighbours(call.turn, call.step) });
  }
  for (const group of groups.values()) if (group.length >= 2) {
    const sameReturnedText = group.every(c => c.resultHash !== null && c.resultHash === group[0].resultHash);
    views.repeats.push({ name: group[0].name, turn: group[0].turn, count: group.length,
      sameReturnedText, classification: group[0].family === 'process' ? 'polling-or-task-operation' : 'repeat-candidate',
      interpretation: 'Matching parameters/output do not establish unchanged external state or wasted work.',
      evidence: [group[0], group.at(-1)].map(proof), omittedCalls: Math.max(0, group.length - 2) });
  }
  views.repeats.sort((a, b) => b.count - a.count);
  views.io.sort((a, b) => b.outputCharacters - a.outputCharacters || a.seq - b.seq);

  const values = projections.values || {}, requests = values.contextTimeline?.requests || [];
  const projectionKeys = ['tokenUsage', 'contextBreakdown', 'contextPressure', 'contextTimeline'].filter(key => values[key] !== undefined);
  coverage.projections = { source: projections.source || 'unavailable', keys: projectionKeys,
    status: projectionKeys.length ? 'available' : 'unavailable', ...(projections.error ? { reason: projections.error } : {}) };
  coverage.context = { source: projections.source || 'unavailable', firstRecordedTurn: requests[0]?.turn ?? null,
    status: requests.length ? (requests[0].turn > (turns?.from ?? native.turns[0]?.number ?? 1) ? 'partial' : 'available') : 'unavailable' };
  let relatedAt = 0;
  for (let i = 1; i < requests.length; i++) {
    const before = requests[i - 1], after = requests[i];
    const relatedEvents = [];
    while (relatedAt < events.length && events[relatedAt].seq <= before.seq) relatedAt++;
    while (relatedAt < events.length && events[relatedAt].seq <= after.seq) { const event = events[relatedAt++]; if (relatedEvents.length < 5 && /^(?:compaction\/|tool\/result|tool\/ptc-dispatch$)/.test(event.type)) relatedEvents.push({ seq: event.seq, type: event.type }); }
    if (!inRange(after.turn, turns)) continue;
    const delta = Object.fromEntries(['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'].map(k => [k, finite(after[k]) !== null && finite(before[k]) !== null ? after[k] - before[k] : null]));
    views.context.push({ turn: after.turn, step: after.step, before: { seq: before.seq, total: before.total }, after: { seq: after.seq, total: after.total },
      categoryNetChange: delta, net: finite(after.total) !== null && finite(before.total) !== null ? after.total - before.total : null,
      relatedEvents,
      interpretation: 'Net changes may cancel additions/removals; related events are not per-call token attribution.' });
  }
  views.context.sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0));
  const schemas = schemaInventory(events, turns);
  schemas.definitions.sort((a, b) => b.standaloneEstimatedTokens - a.standaloneEstimatedTokens);
  const definitionItems = schemas.definitions.filter(d => d.invocationsInScope === 0);
  const summary = { steps: steps.length, nativeCallsForEvidence: calls.length,
    tokenUsageWholeSession: values.tokenUsage || null, contextBreakdownAtCut: values.contextBreakdown || null,
    contextPressureAtCut: values.contextPressure || null, toolDefinitions: schemas,
    statisticsScope: turns ? 'Steps are filtered; whole-session projections remain explicitly labeled whole-session/at-cut.' : 'whole-session',
    evidencePointers: { session: sessionId, maxSeq: scope.toSeq } };
  views.overview = ['latency', 'cost', 'repeats', 'io', 'context'].map(view => ({ view, entries: views[view].length, status: view === 'context' ? coverage.context.status : view === 'latency' || view === 'cost' ? coverage.statistics.status : coverage.native?.status || 'available' }));
  return JSON.parse(JSON.stringify({ scope, coverage, summary, views, stepEntries, definitionItems, anchors }));
}

export function inspectionPage(index, view, offset = 0, limit = 3) {
  const rows = index.views[view];
  return { scope: index.scope, coverage: index.coverage,
    summary: view === 'overview' || view === 'cost' ? { ...index.summary, toolDefinitions: { ...index.summary.toolDefinitions, definitions: undefined } } : { steps: index.summary.steps },
    method: INSPECT_METHODS[view], outputRule: INSPECT_OUTPUT_RULE,
    totalEntries: rows.length, offset, items: rows.slice(offset, offset + limit).map(row => view === 'latency' || view === 'cost' ? index.stepEntries[row] : row),
    ...(view === 'cost' ? { ranking: 'Recorded context + output token volume; not a monetary cost ranking. Compare reported cache buckets before proposing savings.' } : {}),
    ...(view === 'cost' ? { largestDefinitions: index.summary.toolDefinitions.definitions.slice(offset, offset + limit),
      uncalledDefinitionCandidates: index.definitionItems.slice(offset, offset + limit), totalUncalledDefinitionCandidates: index.definitionItems.length } : {}),
    nextOffset: offset + limit < Math.max(rows.length, view === 'cost' ? index.summary.toolDefinitions.definitions.length : 0) ? offset + limit : null };
}

export function evidencePointers(packet) {
  const refs = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (['seq', 'resultSeq', 'startSeq', 'rootSeq', 'firstHeaderSeq', 'lastHeaderSeq'].includes(key) && Number.isSafeInteger(field)) refs.add(field);
      else if (field && typeof field === 'object') walk(field);
    }
  };
  walk(packet.items); walk(packet.uncalledDefinitionCandidates); walk(packet.largestDefinitions);
  return [...refs].sort((a, b) => a - b).map(seq => sourceRef(packet.scope.session, seq));
}
