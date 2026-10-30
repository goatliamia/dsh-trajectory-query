import { hash } from './sources.mjs';
import { estimateVisibleTokens } from '../../analyzers/codex-adapter.mjs';

export const CATEGORIES = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
export const VIEWS = ['overview', 'latency', 'cost', 'repeats', 'io', 'context'];
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = values => { const known = values.filter(valid); return known.length ? known.reduce((n, v) => n + v, 0) : null; };
const compact = text => String(text || '').replace(/\s+/g, ' ').slice(0, 180);
const self = name => /(?:^|[/_.])trajectory_(?:inspect|search|read|graph)$/.test(name);
const pointer = (data, seq) => ({ session: data.session, seq, logId: data.logId });
export const toolName = call => call.nativeName || call.name;
export function intervalUnion(spans) {
  let end = -Infinity, total = 0;
  for (const [a, b] of spans.filter(([a, b]) => valid(a) && valid(b) && b >= a).sort((x, y) => x[0] - y[0])) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}
function usageRow(host, row) {
  const u = row.usage || {};
  if (host === 'pi') {
    const input = ['input', 'cacheRead', 'cacheWrite'].every(k => valid(u[k])) ? u.input + u.cacheRead + u.cacheWrite : null;
    return { input, uncachedInput: valid(u.input) ? u.input : null, cachedInput: valid(u.cacheRead) ? u.cacheRead : null, cacheWrite: valid(u.cacheWrite) ? u.cacheWrite : null, output: valid(u.output) ? u.output : null, reportedCost: valid(u.cost?.total) ? u.cost.total : null };
  }
  const cached = u.cached_input_tokens ?? u.input_tokens_details?.cached_tokens;
  return { input: valid(u.input_tokens) ? u.input_tokens : null, uncachedInput: valid(u.input_tokens) && valid(cached) && cached <= u.input_tokens ? u.input_tokens - cached : null, cachedInput: valid(cached) ? cached : null, cacheWrite: null, output: valid(u.output_tokens) ? u.output_tokens : null, reportedCost: null };
}
function usageTotal(host, rows) {
  const values = rows.map(row => usageRow(host, row));
  return { records: rows.length, ...Object.fromEntries(['input', 'uncachedInput', 'cachedInput', 'cacheWrite', 'output', 'reportedCost'].map(k => [k, sum(values.map(v => v[k]))])), fieldCoverage: Object.fromEntries(['input', 'uncachedInput', 'cachedInput', 'output'].map(k => [k, values.filter(v => valid(v[k])).length])) };
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value; }
function declarationEvidence(data) {
  const definitions = new Map();
  function collect(tools, record, prefix = '') {
    for (const tool of Array.isArray(tools) ? tools : []) {
      if (tool.type === 'namespace' && Array.isArray(tool.tools)) { collect(tool.tools, record, prefix + tool.name + '.'); continue; }
      const body = tool.function || tool, name = prefix + (body.name || tool.type || 'unidentified');
      definitions.set(name, { tool: name, raw: tool, seq: record.seq });
    }
  }
  for (const record of data.records) {
    if (record.kind === 'declaration') collect(record.body.tools, record);
    if (record.kind === 'historical-definition') definitions.set(record.name, { tool: record.name, raw: record.body, seq: record.seq });
    if (data.host === 'pi') { const message = record.body?.message || record.body?.systemMessage; if (message?.role === 'system') collect(message.toolsAdded, record); }
  }
  return [...definitions.values()];
}

export function inspectData(data, q) {
  const p = data.payload, session = p.sessions[0], context = p.context;
  const range = q.turns || { from: session.turns[0]?.number || 1, to: session.turns.at(-1)?.number || 1 };
  let turns = session.turns.filter(t => t.number >= range.from && t.number <= range.to);
  const allCalls = turns.flatMap(t => t.steps.flatMap(s => s.calls.map(c => ({ ...c, turn: t.number, step: s.number, precise: c.timingSource?.endsWith('-capture') || c.timingSource === 'local-rollout' || s.endObserved && data.host === 'codex' }))));
  let calls = allCalls.filter(c => q.includeSelf || !self(toolName(c)));
  const bySeq = new Map(data.records.map(r => [r.seq, r]));
  let files = context.fileOperations.filter(f => f.turn >= range.from && f.turn <= range.to);
  if (q.focus?.tool) calls = calls.filter(c => toolName(c) === q.focus.tool || c.name === q.focus.tool);
  if (q.focus?.file) { const seqs = new Set(files.filter(f => f.path === q.focus.file).map(f => f.seq)); calls = calls.filter(c => seqs.has(c.seq)); }
  if (q.focus?.skill) {
    const seqs = new Set(context.skillEvents.filter(s => s.name === q.focus.skill || s.path === q.focus.skill).map(s => s.seq));
    const touched = new Set(turns.filter(t => seqs.has(t.seq) || t.prompts.some(r => seqs.has(r.seq)) || t.steps.some(s => seqs.has(s.seq) || s.calls.some(c => seqs.has(c.seq)))).map(t => t.number));
    calls = calls.filter(c => touched.has(c.turn));
  }
  const focusTurns = q.focus && new Set(calls.map(c => c.turn));
  if (focusTurns) turns = turns.filter(t => focusTurns.has(t.number));
  const turnIds = new Set(turns.map(t => t.id)), turnNumbers = new Set(turns.map(t => t.number));
  const callSeqs = new Set(calls.map(c => c.seq)); files = files.filter(f => callSeqs.has(f.seq));
  const rawUsage = (context.usage || []).filter(u => data.host === 'pi' ? turnNumbers.has(u.turn) : turnIds.has(u.turnId));
  // A response ID can be re-emitted by telemetry; it is one usage settlement.
  const usage = [...new Map(rawUsage.map((u, i) => [u.responseId || 'record:' + i, u])).values()];
  const totals = usageTotal(data.host, usage);
  const nativeSpan = t => valid(t.start) && valid(t.end) && t.end >= t.start ? t.end - t.start : null;
  const measured = calls.filter(c => c.precise && valid(c.start) && valid(c.end) && c.end >= c.start);
  const nativeTurns = new Map(turns.map(t => [t.number, t]));
  const boundedIntervals = measured.flatMap(c => { const t = nativeTurns.get(c.turn); return valid(t?.start) && valid(t?.end) ? [[Math.max(c.start, t.start), Math.min(c.end, t.end)]] : []; }).filter(([a, b]) => b >= a);
  const read = seq => ({ tool: 'trajectory_read', ...pointer(data, seq), linked: true });
  const summary = { host: data.host, unit: data.host === 'pi' ? 'assistant-cycle' : 'visible-action', turns: turns.length, actions: turns.reduce((n, t) => n + t.steps.length, 0), calls: calls.length, errors: calls.filter(c => c.status === 'error').length,
    observedTurnSpanMs: sum(turns.map(nativeSpan)), nativeToolDurationMs: sum(calls.map(c => c.durationMs)), measuredToolIntervals: measured.length, toolCoveredMs: boundedIntervals.length ? intervalUnion(boundedIntervals) : null, returnedTextCharacters: calls.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0), usage: totals };
  const coverage = { usageUnit: data.host === 'pi' ? 'recorded assistant usage' : 'local response usage records; not all request attempts', callUnit: 'recorded native calls; inner Code Mode activity only when separately recorded', errorUnit: 'tool-result errors; turn failures and assistant stopReason remain separate', focusedUsage: q.focus ? 'whole owning turns, not attributed to the selected tool/file/skill' : 'selected turns', excludedDiagnosticCalls: allCalls.length - allCalls.filter(c => q.includeSelf || !self(toolName(c))).length, unknownTimingCalls: calls.length - measured.length, toolCoverage: 'union of recorded intervals clipped to owning turn bounds; native durations remain separate', crossTurnToolIntervals: measured.filter(c => { const t = nativeTurns.get(c.turn); return c.start < t.start || c.end > t.end; }).length, context: p.evidence.context, synthetic: data.synthetic };
  summary.failedTurns = turns.filter(t => t.reason?.kind === 'failed').length;
  summary.assistantErrorCycles = turns.flatMap(t => t.steps).filter(s => s.stopReason === 'error' || s.stopReason === 'aborted').length;
  const turnRows = turns.map(t => {
    const own = calls.filter(c => c.turn === t.number), ownUsage = usage.filter(u => data.host === 'pi' ? u.turn === t.number : u.turnId === t.id);
    return { turn: t.number, title: compact(t.title || t.prompts[0]?.text), actions: t.steps.length, calls: own.length, errors: own.filter(c => c.status === 'error').length, wallMs: nativeSpan(t), usage: usageTotal(data.host, ownUsage), tools: [...new Set(own.map(toolName))], returnedTextCharacters: own.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0), read: read(t.prompts[0]?.seq ?? t.steps[0]?.seq ?? t.seq) };
  });
  function toolRows() {
    return [...new Set(calls.map(toolName))].map(name => {
      const own = calls.filter(c => toolName(c) === name);
      return { tool: name, count: own.length, errors: own.filter(c => c.status === 'error').length, operationKinds: Object.fromEntries([...new Set(own.map(c => c.semanticKind || c.classification?.kind || 'other'))].map(k => [k, own.filter(c => (c.semanticKind || c.classification?.kind || 'other') === k).length])), nativeDurationMs: sum(own.map(c => c.durationMs)), returnedTextCharacters: own.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0), positions: own.slice(0, 8).map(c => ({ turn: c.turn, step: c.step, status: c.status, read: read(c.seq) })) };
    });
  }
  function fileRows() {
    return [...new Set(files.map(f => f.path))].map(path => { const own = files.filter(f => f.path === path); return { file: path, count: own.length, reads: own.filter(f => f.kind === 'read').length, changes: own.filter(f => f.kind === 'change').length, errors: own.filter(f => f.status === 'error').length, sources: [...new Set(own.map(f => f.source))], read: read(own[0].seq) }; });
  }
  let rows, extra = {};
  if (['overview', 'latency', 'cost'].includes(q.view)) {
    rows = q.groupBy === 'tool' ? toolRows() : q.groupBy === 'file' ? fileRows() : turnRows;
    if (!q.groupBy) {
      const size = Math.max(1, Math.ceil(turnRows.length / 6));
      rows = [];
      for (let i = 0; i < turnRows.length; i += size) {
        const group = turnRows.slice(i, i + size), selected = new Set(group.map(r => r.turn));
        const selectedIds = new Set(turns.filter(t => selected.has(t.number)).map(t => t.id));
        const windowUsage = usage.filter(u => data.host === 'pi' ? selected.has(u.turn) : selectedIds.has(u.turnId));
        const range = { from: group[0].turn, to: group.at(-1).turn };
        rows.push({ kind: 'window', turns: range, ...(group.length === 1 ? { turn: group[0].turn } : {}), firstTask: group[0].title, lastTask: group.at(-1).title, actions: group.reduce((n, r) => n + r.actions, 0), calls: group.reduce((n, r) => n + r.calls, 0), errors: group.reduce((n, r) => n + r.errors, 0), wallMs: sum(group.map(r => r.wallMs)), usage: usageTotal(data.host, windowUsage), returnedTextCharacters: group.reduce((n, r) => n + r.returnedTextCharacters, 0), read: group[0].read, expand: { tool: 'trajectory_inspect', view: q.view, turns: range, groupBy: 'turn', ...(q.focus ? { focus: q.focus } : {}) } });
      }
    }
    if (q.view === 'cost') {
      const historical = context.scope ? [] : declarationEvidence(data);
      extra = { latestRecordedInput: p.officialStats?.context?.pressure ?? null, scope: context.scope ? { source: context.scope.source, observedAt: context.scope.observedAt, configuredTools: context.scope.tools.length, activeTools: context.scope.tools.filter(t => t.active).length, definitions: { tool: 'trajectory_inspect', view: 'cost', groupBy: 'definition' }, read: read(data.records.find(r => r.kind === 'scope').seq) } : null, historicalDeclarationCount: historical.length, definitionBasis: context.scope ? 'current Pi SDK catalog; exposure and active status are separate' : historical.length ? 'historical declarations, not a current inventory; non-matching Codex names do not prove non-use' : 'no recorded tool definitions; calls remain available in io' };
      if (q.groupBy === 'definition') rows = (context.scope?.tools || []).filter(t => !q.focus?.tool || t.name === q.focus.tool).map(t => ({ tool: t.name, active: t.active, exposure: t.exposure ?? null, reachesTools: t.reachesTools ?? null, origin: t.source ?? null, schemaTextEstimate: estimateVisibleTokens(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters })), directCallsInRange: calls.filter(c => toolName(c) === t.name).length, read: read(data.records.find(r => r.kind === 'definition' && r.name === t.name).seq) }));
      if (q.groupBy === 'definition' && !context.scope) rows = historical.filter(t => !q.focus?.tool || t.tool === q.focus.tool).map(t => ({ tool: t.tool, active: null, basis: 'historical declaration', schemaTextEstimate: estimateVisibleTokens(JSON.stringify(t.raw)), directCallsInRange: calls.some(c => toolName(c) === t.tool) || data.host === 'pi' ? calls.filter(c => toolName(c) === t.tool).length : null, read: read(t.seq) }));
    }
  } else if (q.view === 'io') rows = q.groupBy === 'turn' ? turnRows : q.groupBy === 'file' ? fileRows() : toolRows();
  else if (q.view === 'repeats') {
    const groups = new Map();
    for (const c of calls) {
      let args = bySeq.get(c.seq)?.body?.arguments;
      if (c.nativeName === 'commandExecution') args = { command: args?.command, cwd: args?.cwd };
      // Incomplete adapter excerpts are never evidence of identical parameters.
      if (args === undefined) continue;
      const signature = hash(canonical({ name: toolName(c), arguments: args }));
      if (!groups.has(signature)) groups.set(signature, []); groups.get(signature).push(c);
    }
    rows = [...groups.values()].filter(g => g.length > 1).map(g => ({ tool: toolName(g[0]), count: g.length, positions: g.slice(0, 12).map(c => ({ turn: c.turn, step: c.step, status: c.status, read: read(c.seq) })), morePositions: Math.max(0, g.length - 12) }));
  } else {
    rows = context.requests.filter(r => turnNumbers.has(r.turn)).map(r => ({ turn: r.turn, step: r.step, seq: r.seq, semantics: r.semanticUnit, values: Object.fromEntries(CATEGORIES.map(k => [k, r[k]])), selectedEstimate: CATEGORIES.reduce((n, k) => n + Number(r[k] || 0), 0), source: r.source, read: read(r.seq) }));
    const boundaries = context.boundaries.filter(b => turnNumbers.has(b.turn)), skills = context.skillEvents.filter(s => !s.turn || turnNumbers.has(s.turn));
    extra = { currentVisibleEstimate: context.current, boundaryCount: boundaries.length, boundaries: boundaries.slice(-12).map(b => ({ kind: b.kind, turn: b.turn, seq: b.seq, source: b.source, summary: compact(b.summary), read: read(b.seq) })), skillEventCount: skills.length, skillEvents: skills.slice(-20).map(s => ({ kind: s.kind, name: s.name, path: s.path, turn: s.turn, seq: s.seq, entries: s.entries?.length })), scopeAvailable: !!context.scope };
  }
  const value = row => q.sort === 'input' ? row.usage?.input : q.sort === 'output' ? row.usage?.output : q.sort === 'returned' ? row.returnedTextCharacters : q.sort === 'count' ? row.count ?? row.calls : q.sort === 'wall' ? row.wallMs ?? row.nativeDurationMs : q.sort === 'change' ? row.selectedEstimate : null;
  if (q.sort && q.sort !== 'time') rows.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
  return { summary, coverage, range, focus: q.focus ?? null, ...extra, rows };
}
