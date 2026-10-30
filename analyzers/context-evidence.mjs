// Read-only evidence adapters. Numerical composition remains owned by the
// registered projections; surface placement remains owned by SurfaceManager.
import { createHash } from 'node:crypto';
const KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const clone = value => JSON.parse(JSON.stringify(value));
const text = message => (message?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const excerpt = (value, limit = 560) => {
  const s = String(value || '');
  return { text: Buffer.from(s.slice(0, limit), 'utf16le').toString('utf16le'), omitted: Math.max(0, s.length - limit) };
};
const sourceOf = message => message?.source || {};
const messageOf = event => event.type === 'user/message' ? event.data : event.data?.message;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const payloadHash = message => createHash('sha256').update(JSON.stringify(canonical({ role: message?.role, source: message?.source, content: message?.content }))).digest('hex');

export function evidenceCut(session, events, asOfSeq = events.at(-1)?.seq ?? -1) {
  if (!Number.isSafeInteger(asOfSeq) || asOfSeq < -1 || asOfSeq > (events.at(-1)?.seq ?? -1)) throw Error('Invalid evidence cut');
  if (events.some((event, i) => event.seq !== i)) throw Error('A complete contiguous session prefix is required for positional evidence');
  return { session, asOfSeq, eventCount: asOfSeq + 1 };
}

/** Preserve the official views at exactly the same cut; never scale source
 * estimates to make them equal provider usage. dsh-context is an optional,
 * separately attributed enrichment, not part of the official token meter. */
export function readCompositionEvidence({ cut, projections, sources = {} }) {
  if (projections.asOfSeq !== cut.asOfSeq) throw Error('Composition projection and evidence cut differ');
  const values = projections.values || {}, p = values.contextPressure || null, b = values.contextBreakdown || null;
  const timeline = values.contextTimeline, current = timeline?.current;
  const detailed = !timeline?.unsupported && timeline?.ok !== false && KEYS.every(k => numeric(current?.[k]));
  const basic = ['systemTokens', 'toolsTokens', 'messageTokens'].every(k => numeric(b?.[k]));
  const categories = detailed ? KEYS.map(key => ({ key, tokens: current[key] })) : [
    { key: 'system', tokens: b?.systemTokens }, { key: 'tools', tokens: b?.toolsTokens }, { key: 'messages', tokens: b?.messageTokens },
  ].filter(() => basic);
  return clone({ cut, available: categories.length > 0, categories,
    estimate: { total: categories.length ? categories.reduce((n, row) => n + row.tokens, 0) : null, detailed,
      source: detailed ? sources.contextTimeline || { name: 'dsh-context/contextTimeline' } : sources.contextBreakdown || { name: '@deepseek-ai/dsh-token-meter/contextBreakdown' },
      basis: 'source-estimate', raw: detailed ? current : b },
    occupancy: { reportedInputTokens: numeric(p?.pressureTokens) ? p.pressureTokens : null,
      projectedInputTokens: numeric(p?.projectedTokens) ? p.projectedTokens : null,
      contextWindow: numeric(p?.contextWindow) ? p.contextWindow : null,
      source: sources.contextPressure || { name: '@deepseek-ai/dsh-token-meter/contextPressure' },
      basis: 'Independent last reported usage, official projected input, and route capacity; not one atomic request observation.' },
    nodeCategories: detailed ? Object.fromEntries((timeline.nodes || []).filter(n => typeof n.cat === 'string').map(n => [n.seq, n.cat])) : {},
    nodeEstimates: detailed ? Object.fromEntries((timeline.nodes || []).filter(n => numeric(n.tokens)).map(n => [n.seq, n.tokens])) : {},
    coverage: { numericalAtSeq: cut.asOfSeq, detailed: detailed ? 'available' : 'unavailable',
      earliestTimelineTurn: timeline?.requests?.[0]?.turn ?? null,
      ...(projections.error ? { error: projections.error } : {}),
      limits: ['Source estimates are not billed usage or per-message attribution.', 'request/context counts metadata changes, not model requests.'] } });
}

/** Compact deterministic lineage; no model judgment, caller API inference,
 * token positioning or claim that submitted content was used by a model. */
export function buildInjectionIndex({ session, events, SurfaceManager, asOfSeq = events.at(-1)?.seq ?? -1, nodeCategories = {} }) {
  const cut = evidenceCut(session, events, asOfSeq);
  if (typeof SurfaceManager !== 'function') throw Error('The official SurfaceManager is required');
  const prefix = [], surface = new SurfaceManager(prefix), queues = { 'next-step': [], 'next-turn': [] };
  const records = [], claims = new Map(), bySeq = new Map(), shadowed = new Map();
  let turn = null, step = null;
  const describe = message => {
    const source = sourceOf(message), body = text(message);
    return { messageId: message?.id || null, producer: source.kind || null, form: source.form || null,
      noticeSummary: source.form === 'notice' && typeof source.summary === 'string' ? excerpt(source.summary, 120) : null,
      role: message?.role || 'user', payloadHash: payloadHash(message), blockTypes: [...new Set((message?.content || []).map(b => b.type))],
      toolChanges: (message?.content || []).filter(b => ['tool-addition', 'tool-removal'].includes(b.type)).map(b => ({ type: b.type, toolName: b.toolName })),
      characters: (message?.content || []).reduce((sum, b) => sum + (typeof b.text === 'string' ? b.text.length : 0), 0),
      excerpt: excerpt(body), sections: source.form === 'snapshot' && Array.isArray(source.sections)
        ? source.sections.map(s => ({ name: s.name, characters: typeof s.text === 'string' ? s.text.length : 0, excerpt: excerpt(s.text, 220) })) : [],
      instructionChanges: Array.isArray(source.changes) ? source.changes.map(c => ({ action: c.action, path: c.path, scope: c.scope })) : [] };
  };
  for (const event of events) {
    if (event.seq > asOfSeq) break;
    const d = event.data || {}, replacement = event.surfaceOp && typeof event.surfaceOp === 'object';
    const before = replacement ? [...surface.nodes] : null;
    prefix.push(event);
    if (replacement) {
      const after = new Set(surface.nodes);
      for (const seq of before) if (!after.has(seq)) shadowed.set(seq, event.seq);
    }
    if (event.type === 'turn/start') { turn = d.turn; step = null; }
    if (event.type === 'step/start') { turn = d.turn; step = d.step; }
    if (event.type === 'agent/inbox/spliced') {
      const queue = queues[d.target];
      if (!queue || !Number.isSafeInteger(d.start) || d.start < 0 || d.start > queue.length || !Array.isArray(d.inserted)
        || !Number.isSafeInteger(d.removedCount ?? 0) || (d.removedCount ?? 0) < 0 || d.start + (d.removedCount ?? 0) > queue.length) throw Error('Invalid durable inbox splice at seq ' + event.seq);
      const added = d.inserted.map((message, i) => {
        const record = { id: 'queue:' + event.seq + ':' + i, ...describe(message),
          queued: { seq: event.seq, target: d.target, time: event.time, outcome: 'pending', exitSeq: null },
          admitted: null, replacement: null, callerApi: null, evidence: [event.seq], presence: 'pending' };
        records.push(record); return record;
      });
      for (const record of queue.splice(d.start, d.removedCount || 0, ...added)) {
        record.queued.exitSeq = event.seq; record.evidence.push(event.seq);
        record.queued.outcome = d.outcome === 'canceled' ? 'canceled' : 'removed-for-claim';
        record.presence = d.outcome === 'canceled' ? 'canceled' : 'claimed-uncommitted';
        if (d.outcome !== 'canceled' && record.messageId) {
          if (!claims.has(record.messageId)) claims.set(record.messageId, []);
          claims.get(record.messageId).push(record);
        }
      }
    }
    const tracked = ['system/message', 'developer/message', 'user/message'].includes(event.type)
      || replacement && event.type === 'tool/result';
    if (!tracked) continue;
    const message = messageOf(event);
    if (!message) continue;
    const own = describe(message), candidates = own.messageId ? (claims.get(own.messageId) || []).filter(r => !r.admitted) : [];
    const claimed = candidates.length === 1 ? candidates[0] : null;
    let record = claimed;
    if (!record) {
      record = { id: 'surface:' + event.seq, ...own, queued: null, admitted: null, callerApi: null, evidence: [] };
      records.push(record);
    } else {
      record.queuedProducer = record.producer;
      record.queuedPayloadHash = record.payloadHash;
      record.payloadChangedOnAdmission = record.payloadHash !== own.payloadHash;
      Object.assign(record, own);
    }
    record.admitted = { seq: event.seq, turn: d.turn ?? turn, step: d.step ?? step, time: event.time,
      operation: event.surfaceOp === 'append' ? 'append' : replacement ? 'replace' : 'unknown' };
    record.queueCorrelation = candidates.length === 1 ? 'unique-claimed-message-id' : candidates.length > 1 ? 'ambiguous-message-id' : 'no-claimed-message-id';
    record.declarationHeader = event.type === 'developer/message' && Number.isSafeInteger(d.headerSeq)
      ? { seq: d.headerSeq, resolved: d.headerSeq < event.seq && prefix[d.headerSeq]?.type === 'request/header' } : null;
    record.replacement = replacement ? { startSeq: event.surfaceOp.startSeq, endSeq: event.surfaceOp.endSeq,
      sourceEventSeqs: event.sourceEventSeqs || [], meteringSeq: ['compaction/summary', 'compaction/prune'].includes(prefix.at(-2)?.type) ? prefix.at(-2).seq : null } : null;
    if (record.declarationHeader?.resolved) record.evidence.push(record.declarationHeader.seq);
    record.evidence.push(event.seq); record.presence = 'committed'; bySeq.set(event.seq, record);
  }
  const nodes = surface.nodes, nodeSet = new Set(nodes), slots = [];
  for (const seq of nodes) {
    const event = prefix[seq], message = surface.deriveEventMessage(event);
    if (!message) continue;
    const source = sourceOf(message), record = bySeq.get(seq);
    slots.push({ seq, ordinal: slots.length, role: message.role, producer: source.kind || null, form: source.form || null,
      turn: record?.admitted?.turn ?? event.data?.turn ?? null, step: record?.admitted?.step ?? event.data?.step ?? null,
      category: nodeCategories[seq] || (message.role === 'system' ? 'system' : message.role === 'assistant' ? 'assistant' : message.role === 'tool' ? 'tool' : source.kind === 'user' ? 'user' : 'inject'),
      categoryBasis: nodeCategories[seq] ? 'registered-projection' : 'role-source-display-only',
      recordId: record?.id || null, excerpt: excerpt(text(message), 95) });
  }
  const position = new Map(slots.map(s => [s.seq, s.ordinal]));
  for (const record of records) if (record.admitted) {
    const seq = record.admitted.seq;
    record.ordinal = position.get(seq) ?? null;
    record.shadowedAt = shadowed.get(seq) ?? null;
    record.presence = position.has(seq) ? 'retained' : nodeSet.has(seq) ? 'empty-surface-node' : 'shadowed';
  }
  const latestSnapshot = new Map();
  for (const record of records) if (record.admitted && record.form === 'snapshot') latestSnapshot.set(record.producer, record.admitted.seq);
  for (const record of records) record.laterSnapshotSeq = record.form === 'snapshot' && latestSnapshot.get(record.producer) > record.admitted?.seq ? latestSnapshot.get(record.producer) : null;
  const summary = { records: records.length, admitted: records.filter(r => r.admitted).length,
    queued: records.filter(r => r.queued).length, canceled: records.filter(r => r.presence === 'canceled').length,
    pending: records.filter(r => r.presence === 'pending').length, claimedUncommitted: records.filter(r => r.presence === 'claimed-uncommitted').length,
    retained: records.filter(r => r.presence === 'retained').length, shadowed: records.filter(r => r.presence === 'shadowed').length,
    logicalMessages: slots.length };
  return clone({ cut, summary, records, slots,
    coverage: { source: 'durable-events + official SurfaceManager', positions: 'logical-message-order',
      callerApi: 'not-recorded', modelAttention: 'not-observable', providerTokenOffsets: 'not-provided',
      limits: ['No queue match does not prove that content was lost.', 'A retained older snapshot may be superseded semantically.', 'Message identity alone does not prove unchanged payload.', 'Fallback role/source colors do not constitute numerical category attribution.'] } });
}

export function readInjectionEvidence(index, { producer, presence, offset = 0, limit = 30 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('Invalid evidence page');
  const rows = index.records.filter(r => (!producer || r.producer === producer) && (!presence || r.presence === presence));
  return clone({ cut: index.cut, summary: index.summary, coverage: index.coverage, total: rows.length,
    items: rows.slice(offset, offset + limit), nextOffset: offset + limit < rows.length ? offset + limit : null });
}

/** A production caller can use this against the existing host service. It
 * retains one observation only for this read and never writes checkpoints. */
export async function observeContextEvidence(ctx, session, { asOfSeq, signal, SurfaceManager, sources, parts = ['composition', 'injections'] } = {}) {
  if (!Array.isArray(parts) || !parts.length || parts.some(p => !['composition', 'injections'].includes(p))) throw Error('Unknown evidence part');
  const query = ctx.get('sessionQuery'), registry = ctx.get('sessionProjections');
  if (!query?.observeSession) throw Error('sessionQuery.observeSession is required');
  const observed = await query.observeSession(session, { projectionMode: 'none', ...(signal ? { signal } : {}) });
  try {
    signal?.throwIfAborted();
    if (observed.header?.id && observed.header.id !== session) throw Error('Observed session identity differs');
    const events = observed.events || [], cut = evidenceCut(session, events, asOfSeq ?? observed.cursor ?? events.at(-1)?.seq ?? -1);
    let projection = observed.projections?.asOfSeq === cut.asOfSeq ? observed.projections : null;
    if (parts.includes('composition') && !projection && registry?.restore && observed.header) {
      let checkpoint = {}, result;
      const deadline = performance.now() + 8000;
      try {
        for (let i = 0; i <= cut.asOfSeq; i += 1000) {
          signal?.throwIfAborted(); if (performance.now() > deadline) throw Error('Projection restore time budget exceeded');
          const batch = events.slice(i, Math.min(i + 1000, cut.asOfSeq + 1));
          result = registry.restore(checkpoint, batch, batch[0].seq, observed.header, observed.inheritedEventCount || 0);
          checkpoint = result.checkpoint; await new Promise(resolve => setImmediate(resolve));
        }
        projection = result?.snapshot || { asOfSeq: cut.asOfSeq, values: {} };
      } catch (error) {
        if (signal?.aborted) throw error;
        projection = { asOfSeq: cut.asOfSeq, values: {}, error: String(error.message) };
      }
    }
    projection ||= { asOfSeq: cut.asOfSeq, values: {} };
    const composition = parts.includes('composition') ? readCompositionEvidence({ cut, projections: projection, sources }) : null;
    const injections = parts.includes('injections') ? buildInjectionIndex({ session, events, SurfaceManager, asOfSeq: cut.asOfSeq, nodeCategories: composition?.nodeCategories }) : null;
    return { cut, composition, injections };
  } finally {
    const dispose = observed[Symbol.dispose] || observed.dispose;
    if (typeof dispose === 'function') dispose.call(observed);
  }
}
