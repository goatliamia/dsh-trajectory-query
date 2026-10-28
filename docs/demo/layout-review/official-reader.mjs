// Runs inside a DSH conversation view; no new host route or event fold.
export function useOfficialContext(useProjection) {
  // These are native DSH renderer hook seats, subscribed by the host UI kit.
  const pressure = useProjection('contextPressure');
  const breakdown = useProjection('contextBreakdown');
  // Optional existing enrichment; absence keeps the official three-category view.
  const timeline = useProjection('contextTimeline');
  return { pressure, breakdown, composition: timeline?.current, route: timeline && {
    provider: timeline.provider, model: timeline.model, reasoningEffort: timeline.reasoningEffort,
  } };
}

export function createOfficialReader(ctx, sessionId, fetchImpl = globalThis.fetch) {
  const binding = ctx.sessions.binding(sessionId);
  if (!binding?.session) throw new Error('DSH session binding is unavailable');
  const session = binding.session, conversation = ctx.uiConversation.binding(sessionId);
  const stats = conversation.target('stats'), trajectory = conversation.target('trajectory');
  const lifetime = new AbortController();
  let pendingPage = null;
  const coordinates = (seq, index) => {
    if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError('Invalid workspace/changes sequence');
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new TypeError('Invalid original file index');
    return new URLSearchParams({ sessionId, seq: String(seq), ...(index === undefined ? {} : { index: String(index) }) });
  };
  async function read(path, seq, index, signal) {
    const response = await fetchImpl(path + '?' + coordinates(seq, index), {
      signal: signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal,
      credentials: 'same-origin',
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error('Official DSH read failed: HTTP ' + response.status);
    return response.json();
  }
  return {
    // Pass these official sources to slot inject.hooks. Do not resubscribe in render.
    stats, trajectory,
    loadOlder() {
      if (pendingPage) return pendingPage;
      const state = session.getSnapshot();
      if (lifetime.signal.aborted || state.openState !== 'open' || state.loadingOlder) return Promise.resolve('retry');
      if (!state.hasMore) return Promise.resolve('exhausted');
      const before = stats.getSnapshot();
      pendingPage = session.loadOlder().then(() => {
        if (lifetime.signal.aborted) return 'retry';
        if (stats.getSnapshot() !== before) return 'grew';
        return session.getSnapshot().hasMore ? 'retry' : 'exhausted';
      }).finally(() => { pendingPage = null; });
      return pendingPage;
    },
    changeSequence(turnLocation) {
      return turnLocation.data.get('deliverables')?.changes?.seq;
    },
    readFileChanges(seq, signal) { return read('api/changes.summary', seq, undefined, signal); },
    readFileDiff(seq, index, signal) { return read('api/changes.diff', seq, index, signal); },
    openFileReview(seq, turn, index = 0) {
      coordinates(seq, index);
      if (!Number.isSafeInteger(turn) || turn < 1) throw new TypeError('Invalid turn');
      return ctx.sidebarRight.openResource('dsh-resource://changes-review/session/' + encodeURIComponent(sessionId) + '/' + seq + '/' + turn, { params: { index } });
    },
    dispose() { lifetime.abort(); },
  };
}
