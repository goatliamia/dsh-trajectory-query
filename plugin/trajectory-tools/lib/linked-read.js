// Deterministic adjacency, not semantic episodes or inferred causality.
const human = e => e.type === 'user/message' && (!e.data?.source || e.data.source.kind === 'user');
const text = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const excerpt = (value, max) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return { text: Buffer.from(raw.slice(0, max), 'utf16le').toString('utf16le'), characters: raw.length, omitted: Math.max(0, raw.length - max) };
};

export function buildRelations(events) {
  const locations = {}, steps = {}, turns = {}, calls = {}, roots = new Map(), dispatches = new Map();
  let turn = null, step = null, active = false, pendingUsers = [];
  const ownTurn = t => turns[t] ||= { turn: t, userSeqs: [], startSeq: null, endSeq: null, lastAssistantSeq: null, stepKeys: [] };
  for (const e of events) {
    const d = e.data || {};
    if (e.surfaceOp && typeof e.surfaceOp === 'object') continue;
    if (e.type === 'turn/start') {
      turn = d.turn; step = null; active = true;
      const t = ownTurn(turn); t.startSeq = e.seq;
      for (const seq of pendingUsers) { t.userSeqs.push(seq); locations[seq] = [turn, null]; }
      pendingUsers = [];
    }
    if (e.type === 'step/start') { turn = d.turn; step = d.step; }
    const root = roots.get(d.rootCallId), t = d.turn ?? root?.turn ?? turn, s = d.step ?? root?.step ?? step;
    locations[e.seq] = [t, s];
    if (human(e)) {
      if (d.turn != null || active) ownTurn(t).userSeqs.push(e.seq);
      else pendingUsers.push(e.seq);
    }
    if (e.type === 'step/start') {
      const key = t + ':' + s, list = ownTurn(t).stepKeys;
      if (list.length) steps[list.at(-1)].nextStepKey = key;
      steps[key] = { turn: t, step: s, startSeq: e.seq, endSeq: null, assistantSeq: null, callSeqs: [], nextStepKey: null };
      list.push(key);
    }
    const st = steps[t + ':' + s];
    if (e.type === 'step/end' && st) st.endSeq = e.seq;
    if (e.type === 'assistant/message') { if (st) st.assistantSeq = e.seq; if (t != null) ownTurn(t).lastAssistantSeq = e.seq; }
    if (e.type === 'tool/call') {
      const call = { name: d.name, turn: t, step: s, callSeq: e.seq, startSeq: e.seq, resultSeq: null, rootSeq: null, formalResultSeq: null };
      calls[e.seq] = call; roots.set(d.callId, call); st?.callSeqs.push(e.seq);
    }
    if (e.type === 'tool/result') {
      const id = d.message?.toolCallId ?? d.message?.source?.callId ?? d.callId;
      const call = roots.get(id);
      if (call) { call.resultSeq = e.seq; calls[e.seq] = call; }
    }
    if (/^tool\/ptc-dispatch(?:-start)?$/.test(e.type) && root && d.subCallId) {
      const id = JSON.stringify([d.rootCallId, d.subCallId]);
      let call = dispatches.get(id);
      if (!call) {
        call = { turn: t, step: s, callSeq: e.seq, startSeq: e.seq, resultSeq: null, rootSeq: root.callSeq, formalResultSeq: null };
        dispatches.set(id, call); st?.callSeqs.push(e.seq);
      }
      calls[e.seq] = call;
      if (e.type === 'tool/ptc-dispatch') call.resultSeq = e.seq;
    }
    if (e.type === 'turn/end') { ownTurn(t).endSeq = e.seq; active = false; }
  }
  for (const call of dispatches.values()) call.formalResultSeq = calls[call.rootSeq]?.resultSeq ?? null;
  // Start/result seqs point to the same call. Store that object only once.
  const uniqueCalls = [...new Set(Object.values(calls))], ids = new Map(uniqueCalls.map((c, i) => [c, i]));
  return { locations, steps, turns, calls: uniqueCalls.map(c => ({ callSeq: c.callSeq, resultSeq: c.resultSeq,
    ...(c.name ? { name: c.name } : {}),
    ...(c.rootSeq == null ? {} : { rootSeq: c.rootSeq }), ...(c.formalResultSeq == null ? {} : { formalResultSeq: c.formalResultSeq }) })),
    callRefs: Object.fromEntries(Object.entries(calls).map(([seq, c]) => [seq, ids.get(c)])) };
}

export function linkedPlan(index, seq) {
  const r = index.relations, location = r.locations[seq];
  if (!location && !Object.hasOwn(index.anchors, seq)) throw Error('Anchor outside inspection cut');
  const getCall = seq => r.calls[r.callRefs[seq]];
  const [turn, step] = location || [], call = getCall(seq), st = r.steps[turn + ':' + step], t = r.turns[turn];
  const found = new Map(), add = (n, relation) => {
    if (Number.isSafeInteger(n) && Object.hasOwn(index.anchors, n)) {
      if (!found.has(n)) found.set(n, { seq: n, relations: [] });
      if (!found.get(n).relations.includes(relation)) found.get(n).relations.push(relation);
    }
  };
  add(seq, 'anchor');
  if (call) { add(call.callSeq, 'call-start'); add(call.resultSeq, 'call-result'); add(call.rootSeq, 'outer-call'); add(call.formalResultSeq, 'formal-result'); }
  const users = t?.userSeqs.filter(n => n <= seq) || [];
  add(users.at(-1) ?? t?.userSeqs[0], 'user-request'); add(st?.startSeq, 'step-start');
  add(st?.assistantSeq, 'assistant-in-step');
  add(r.steps[st?.nextStepKey]?.assistantSeq, 'next-step-assistant');
  // At a turn/step anchor, offer its calls as well; at a call, these are later pages.
  for (const n of st?.callSeqs || r.steps[t?.stepKeys[0]]?.callSeqs || []) {
    const c = getCall(n); add(n, 'same-step-call'); add(c?.resultSeq, 'same-step-result');
    add(c?.formalResultSeq, 'formal-result');
  }
  add(t?.lastAssistantSeq, 'last-assistant-in-turn'); add(t?.endSeq, 'turn-end');
  return { turn: turn ?? null, step: step ?? null, records: [...found.values()], relationBasis: 'recorded call IDs and turn/step order; subsequent messages are temporal context' };
}

export function linkedRecord(event, relations, readArgs) {
  const d = event.data || {}, fields = [], detail = {};
  const field = (path, value, budget) => {
    if (value === undefined) return;
    detail[path] = excerpt(value, budget);
    if (detail[path].omitted) fields.push({ tool: 'trajectory_read', args: { ...readArgs, seq: event.seq, field: path, offset: 0 } });
  };
  const contentPath = d.message?.content ? 'data.message.content' : 'data.content';
  const blocks = d.message?.content || d.content || [], textIndices = blocks.map((b, i) => b.type === 'text' ? i : -1).filter(i => i >= 0);
  const bodyPath = textIndices.length === 1 ? contentPath + '.' + textIndices[0] + '.text' : contentPath;
  if (d.arguments !== undefined) field('data.arguments', d.arguments, 1000);
  const body = text(d.message?.content || d.content);
  if (body) { detail.text = excerpt(body, relations.some(r => ['anchor', 'call-result', 'formal-result'].includes(r)) ? 2000 : 700);
    if (detail.text.omitted) fields.push({ tool: 'trajectory_read', args: { ...readArgs, seq: event.seq, field: bodyPath, offset: 0 } }); }
  if (d.reason) field('data.reason', d.reason, 600);
  if (d.error) field('data.error', d.error, 600);
  if (d.meta) field('data.meta', d.meta, 900);
  if (d.header) field('data.header', d.header, 800);
  if (d.sections) field('data.sections', d.sections, 500);
  if (d.usage) detail.usage = d.usage;
  if (d.message?.source || d.source) detail.source = d.message?.source || d.source;
  const known = Object.keys(detail).length > 0;
  if (!known && Object.keys(d).length) field('data', d, 800);
  return { seq: event.seq, type: event.type, time: event.time, relations,
    ...(d.name ? { name: d.name } : {}), ...detail,
    ...(body ? { body: { tool: 'trajectory_read', args: { ...readArgs, seq: event.seq, field: bodyPath, offset: 0 } } } : {}),
    original: { tool: 'trajectory_read', args: { ...readArgs, seq: event.seq, field: 'data', offset: 0 } },
    ...(fields.length ? { more: fields } : {}) };
}

export function readField(event, path, offset = 0, budget = 12000) {
  if (typeof path !== 'string' || !path || path.length > 240) throw Error('field must be a dotted event path');
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('offset must be a nonnegative integer');
  let value = event;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw Error('Field not found: ' + path);
    value = value[key];
  }
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (offset > raw.length) throw Error('offset exceeds field length');
  const end = Math.min(raw.length, offset + budget);
  return { seq: event.seq, field: path, valueType: typeof value, totalCharacters: raw.length,
    offset, text: raw.slice(offset, end), omittedBefore: offset, omittedAfter: raw.length - end,
    nextOffset: end < raw.length ? end : null };
}
