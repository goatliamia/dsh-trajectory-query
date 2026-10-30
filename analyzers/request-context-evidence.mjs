// Retrospective request receipts. Logical history comparisons are distinct
// from provider-reported cache usage and never locate a token cache boundary.
import { createHash } from 'node:crypto';
import { evidenceCut } from './context-evidence.mjs';
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function requestUsageEvidence(usage) {
  const input = numeric(usage?.inputTokens) ? usage.inputTokens : null;
  const read = numeric(usage?.cacheReadTokens) ? usage.cacheReadTokens : null;
  const write = numeric(usage?.cacheWriteTokens) ? usage.cacheWriteTokens : null;
  const output = numeric(usage?.outputTokens) ? usage.outputTokens : null;
  const aggregate = numeric(usage?.totalTokens) && output !== null && usage.totalTokens >= output ? usage.totalTokens - output : null;
  const full = input !== null && read !== null && write !== null ? input + read + write : null;
  const knownInput = [input, read, write].filter(n => n !== null).reduce((a, b) => a + b, 0);
  const inconsistent = aggregate !== null && (full !== null ? aggregate !== full : knownInput > aggregate);
  const prompt = inconsistent ? null : aggregate ?? full;
  return { uncachedInputTokens: input, cacheReadTokens: read, cacheWriteTokens: write, outputTokens: output,
    promptTokens: prompt, cacheRate: prompt > 0 && read !== null && read <= prompt ? read / prompt : null,
    available: usage != null, consistent: !inconsistent,
    denominator: inconsistent ? 'inconsistent' : aggregate !== null ? 'reported-total-minus-output' : full !== null ? 'disjoint-input-buckets' : 'unavailable',
    raw: usage || null };
}

export function buildRequestContextIndex({ session, events, SurfaceManager, lastAssistantStreamChunk, asOfSeq = events.at(-1)?.seq ?? -1 }) {
  const cut = evidenceCut(session, events, asOfSeq);
  if (typeof SurfaceManager !== 'function' || typeof lastAssistantStreamChunk !== 'function') throw Error('Official surface and stream helpers are required');
  const prefix = [], surface = new SurfaceManager(prefix), requests = [], firstRequestBySurfaceSeq = {};
  const byId = new Map(), groups = new Map(), epochs = new Map(), starts = new Map();
  let header = null, previousNodes = [], previousRequest = null, replacements = [], contexts = [];
  for (const event of events) {
    if (event.seq > asOfSeq) break;
    const d = event.data || {}, stepKey = d.turn + ':' + d.step;
    if (event.type === 'step/start') starts.set(stepKey, { seq: event.seq, time: event.time });
    if (event.type === 'llm/retry-started') epochs.set(stepKey, (epochs.get(stepKey) || 0) + 1);
    if (event.type === 'request/header') {
      const tools = d.header?.tools;
      header = { seq: event.seq, toolsRecorded: Array.isArray(tools), toolCount: Array.isArray(tools) ? tools.length : null,
        deferredCount: Array.isArray(tools) ? tools.filter(t => t.deferLoading === true).length : null,
        toolNames: (tools || []).slice(0, 8).map(t => t.name), toolsHash: Array.isArray(tools) ? digest(tools) : null };
    }
    if (event.type === 'request/context') contexts.push(event.seq);
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const groupKey = stepKey + ':' + (epochs.get(stepKey) || 0);
      let request = groups.get(groupKey);
      if (!request) {
        const nodes = surface.nodes.filter(seq => surface.deriveEventMessage(prefix[seq]) !== null);
        let common = 0;
        while (common < previousNodes.length && common < nodes.length && previousNodes[common] === nodes[common]) common++;
        request = { id: 'request:' + event.seq, inputCut: { session, asOfSeq: event.seq - 1 },
          turn: d.turn ?? null, step: d.step ?? null, retry: epochs.get(stepKey) || 0,
          start: starts.get(stepKey) || null, firstSettlementSeq: event.seq, settlementSeq: event.seq, settlementSeqs: [],
          header: header ? { ...header } : null, route: null, usage: null, previousId: previousRequest?.id || null,
          logicalChange: previousRequest ? { previousMessages: previousNodes.length, currentMessages: nodes.length,
            unchangedPrefixMessages: common, unchangedPrefixLastSeq: common ? nodes[common - 1] : null,
            firstChangedOrdinal: common < previousNodes.length ? common : null,
            firstChangedPreviousSeq: common < previousNodes.length ? previousNodes[common] : null,
            firstChangedCurrentSeq: common < nodes.length && common < previousNodes.length ? nodes[common] : null,
            appendOnly: common === previousNodes.length, replacementCount: replacements.length,
            replacements: replacements.slice(0, 20), replacementsOmitted: Math.max(0, replacements.length - 20),
            declarationChanged: previousRequest.header?.toolsHash && header?.toolsHash ? previousRequest.header.toolsHash !== header.toolsHash : null,
            contextMetadataChanges: contexts.slice(0, 12) } : null };
        requests.push(request); byId.set(request.id, request); groups.set(groupKey, request);
        for (const seq of nodes) firstRequestBySurfaceSeq[seq] ??= request.id;
        previousNodes = nodes; previousRequest = request; replacements = []; contexts = [];
      }
      const explicit = event.type === 'assistant/message' && d.usage !== undefined;
      const usage = explicit ? d.usage : lastAssistantStreamChunk(d.stream || [], 'usage')?.usage;
      request.settlementSeq = event.seq; request.settlementSeqs.push(event.seq);
      request.settlementType = event.type;
      request.route = d.message?.source?.provider ? { provider: d.message.source.provider, model: d.message.source.model || null } : request.route;
      if (usage !== undefined) {
        request.usage = { ...requestUsageEvidence(usage), evidenceSeq: event.seq,
          source: explicit ? 'assistant/message.data.usage' : event.type + '.data.stream:last-usage' };
      }
    }
    if (event.surfaceOp && typeof event.surfaceOp === 'object') replacements.push({ seq: event.seq,
      startSeq: event.surfaceOp.startSeq, endSeq: event.surfaceOp.endSeq });
    prefix.push(event);
  }
  return { cut, requests, byId, firstRequestBySurfaceSeq,
    coverage: { source: 'durable assistant settlements + official SurfaceManager and stream helper',
      grouping: 'same turn/step replaces its sample until llm/retry-started; not an independent billed-request count',
      positionBasis: 'logical surface immediately before its first settlement; not provider wire',
      limits: ['Cache usage is a whole-request observation, not a per-message cached span.',
        'An unchanged logical prefix is not proof of a provider cache hit.', 'Nearby changes do not establish a cause for cache changes.'] } };
}

export function readRequestContextEvidence(index, { contextCut, surfaceSeq, excluded = false }) {
  if (contextCut.session !== index.cut.session || !Number.isSafeInteger(contextCut.asOfSeq) || contextCut.asOfSeq < -1 || contextCut.asOfSeq > index.cut.asOfSeq) throw Error('Request evidence cut mismatch');
  if (surfaceSeq != null && (!Number.isSafeInteger(surfaceSeq) || surfaceSeq < 0 || surfaceSeq > contextCut.asOfSeq)) throw Error('Surface reference is outside the context cut');
  const firstId = !excluded && surfaceSeq != null ? index.firstRequestBySurfaceSeq[surfaceSeq] : null;
  const first = firstId ? index.byId.get(firstId) : null;
  const recent = index.requests.findLast(r => r.settlementSeq <= contextCut.asOfSeq) || null;
  const request = first || recent;
  const previous = request?.previousId ? index.byId.get(request.previousId) : null;
  const relation = excluded ? 'not-admitted' : first ? 'first-observed-input' : surfaceSeq != null ? 'no-observed-input' : 'latest-observed-receipt';
  const deltaRate = request?.usage?.cacheRate != null && previous?.usage?.cacheRate != null ? request.usage.cacheRate - previous.usage.cacheRate : null;
  const routeChanged = request?.route && previous?.route ? request.route.provider !== previous.route.provider || request.route.model !== previous.route.model : null;
  return copy({ contextCut, observedThrough: index.cut, relation, surfaceSeq: surfaceSeq ?? null,
    request, previous, comparison: { deltaRate, routeChanged },
    receiptAfterContextCut: request ? request.settlementSeq > contextCut.asOfSeq : false,
    coverage: index.coverage });
}
