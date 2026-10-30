// A frozen preview has no parent bridge or history endpoint to fill its gaps.
// Check against the recorded model responses, not turn count: some turns end
// without a response, and must not acquire invented context samples.
export function inspectStudySnapshot(payload) {
  const session = payload.sessions?.find(row => row.id === payload.mainSession);
  if (!session) throw Error('The context study needs its main session');
  if (payload.officialStats?.session && payload.officialStats.session !== session.id) {
    throw Error('Official context summary belongs to another session');
  }
  const expected = new Map(session.turns.flatMap(turn => turn.steps
    .filter(step => Number.isInteger(step.assistantSeq))
    .map(step => [step.assistantSeq, { turn: turn.number, step: step.number }])));
  const samples = new Map();
  for (const row of [...(payload.context?.historyRequests || []), ...(payload.context?.requests || [])]) {
    const response = expected.get(row.seq);
    if (!response || response.turn !== row.turn || response.step !== row.step) {
      throw Error('Context sample does not match a recorded response in this session');
    }
    const previous = samples.get(row.seq);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
      throw Error('Conflicting context samples for the same response');
    }
    samples.set(row.seq, row);
  }
  if (!samples.size) throw Error('The study needs recorded context compositions');
  const missing = [...expected].filter(([seq]) => !samples.has(seq));
  const pressure = payload.officialStats?.context?.pressure;
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const hasSummary = valid(pressure?.projectedTokens ?? pressure?.pressureTokens)
    && valid(pressure?.contextWindow) && pressure.contextWindow > 0;
  return { session: session.id, turns: session.turns.length, requests: samples.size,
    expected: expected.size, missing: missing.length, firstMissingTurn: missing[0]?.[1].turn,
    hasSummary, complete: !missing.length && hasSummary };
}

export function requireStudySnapshot(payload, { allowIncomplete = false } = {}) {
  const result = inspectStudySnapshot(payload);
  if (!allowIncomplete && !result.complete) {
    throw Error('Incomplete frozen context study: ' + (result.missing
      ? result.missing + ' response compositions missing (first at turn ' + result.firstMissingTurn + '). '
      : '') + (result.hasSummary ? '' : 'Official occupancy/capacity missing. ')
      + 'Capture the full snapshot, or use --allow-incomplete with a separate --out for a performance fixture.');
  }
  return result;
}
