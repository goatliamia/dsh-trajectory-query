(() => {
  const element = document.getElementById('trace-data'), payload = JSON.parse(element.textContent);
  element.textContent = ''; window.__geistPayload = payload;
  const loading = payload.traceLoad, sessionId = loading?.sessionId || payload.mainSession;
  const official = {}, pendingTurns = new Map(), readyTurns = new Set(), pendingStages = new Map();
  const timing = window.__traceStages = { shell: performance.now() };
  const viewer = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let booted = false, cut = null, officialKey = '', active = true, generation = 0, controller = new AbortController(), coreWork;
  const cancelled = () => new DOMException('Trace view paused', 'AbortError');
  const merge = (target, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const current = target[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) merge(current, value);
      else target[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge({}, value) : value;
    }
    return target;
  };
  const announce = () => {
    if (window.parent !== window) window.parent.postMessage({ type: 'analysis-trace-ready', sessionId, version: payload.traceVersion ?? null, assets: payload.traceAssets ?? null }, location.origin);
  };
  const boot = () => {
    if (booted) return;
    booted = true;
    try {
      window.__geistBoot(); timing.shellReady = performance.now(); announce();
      if (!loading) { timing.core = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { timing.corePaint = performance.now(); })); }
    }
    catch (error) {
      window.__renderGuard = String(error?.message || error);
      const box = document.createElement('pre'); box.className = 'trace-render-error';
      box.textContent = '执行路径渲染失败：' + window.__renderGuard; document.body.appendChild(box);
    }
  };
  const apply = (patch, stage) => {
    const combined = {}; merge(combined, patch);
    if (patch.context || patch.officialStats) merge(combined, official);
    if (booted) window.__geistUpdate(combined, { stage }); else merge(payload, combined);
    if (stage) timing[stage] = performance.now();
  };
  const query = (stage, turn, token = cut) => {
    const value = new URLSearchParams({ session: sessionId, stage, view: viewer });
    if (token) value.set('cut', token);
    if (turn !== undefined) value.set('turn', turn);
    return '/analysis-view/trace-data?' + value;
  };
  const release = token => { if (loading && token) fetch(query('release', undefined, token), { credentials: 'same-origin', keepalive: true }).catch(() => {}); };
  const read = async (stage, turn, retry = true) => {
    if (!active) throw cancelled();
    const turnGeneration = generation, token = stage === 'core' ? null : cut;
    const response = await fetch(query(stage, turn, token), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (response.status === 409 && stage !== 'core' && retry) { await start(true); return read(stage, turn, false); }
    if (!response.ok) throw new Error('读取失败 (' + response.status + ')');
    const value = await response.json();
    if (!active || turnGeneration !== generation) { if (stage === 'core') release(value.cut); throw cancelled(); }
    if (value.sessionId !== sessionId || (token && value.cut !== token)) throw new Error('记录版本不一致');
    if (stage !== 'core' && token !== cut) return read(stage, turn, false);
    if (stage === 'core') cut = value.cut;
    return value.payload;
  };
  window.__traceTurnReady = number => !loading || payload.traceStage?.details === 'ready' || readyTurns.has(number);
  window.__traceEnsureTurn = number => {
    if (window.__traceTurnReady(number)) return Promise.resolve();
    if (!pendingTurns.has(number)) {
      const job = read('turn', number).then(value => { readyTurns.add(number); apply(value, 'turn'); })
        .finally(() => { if (pendingTurns.get(number) === job) pendingTurns.delete(number); });
      pendingTurns.set(number, job);
    }
    return pendingTurns.get(number);
  };
  window.__traceLoadHistory = async before => {
    if (payload.traceStatus?.history === 'loading' || !active) return;
    apply({ traceStatus: { history: 'loading' } });
    try { apply(await read('history', before), 'history'); }
    catch (error) { if (error.name !== 'AbortError') apply({ traceStatus: { history: 'error' } }); }
  };
  const enrich = (stage, force = false) => {
    if (!active || pendingStages.has(stage) || (!force && payload.traceStage?.[stage] === 'ready')) return;
    const job = read(stage).then(value => {
      apply(value, stage);
      if (stage === 'actors') announce();
    }).catch(error => {
      if (error.name !== 'AbortError' && active) { timing[stage + 'Error'] = String(error.message); apply({ traceStage: { [stage]: 'error' } }); }
    }).finally(() => {
      if (pendingStages.get(stage) === job) pendingStages.delete(stage);
      if (!pendingStages.size) apply({ traceStatus: { refresh: 'ready' } });
    });
    pendingStages.set(stage, job);
  };
  async function start(force = false) {
    if (coreWork) return coreWork;
    if (!active) return;
    const job = (async () => {
      try {
        const core = await read('core');
        if (!payload.sessions?.some(session => session.turns.length)) apply(core, 'core');
        else apply({ traceVersion: core.traceVersion, traceAssets: core.traceAssets, traceCapabilities: core.traceCapabilities, traceStatus: { refresh: 'loading' } });
        timing.core = performance.now(); announce();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          timing.corePaint = performance.now(); enrich('details', force); enrich('actors', force);
        }));
      } catch (error) {
        if (error.name !== 'AbortError' && active) { timing.coreError = String(error.message); apply({ traceStage: { core: 'error' } }); }
      }
    })().finally(() => { if (coreWork === job) coreWork = null; });
    coreWork = job; return job;
  }
  const pause = () => {
    if (!active) return;
    active = false; generation++; controller.abort(); release(cut);
  };
  const resume = () => {
    if (active) return;
    active = true; controller = new AbortController(); coreWork = null;
    pendingStages.clear(); pendingTurns.clear();
    if (payload.traceStage?.details !== 'ready' || payload.traceStage?.actors !== 'ready') start(true);
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || (window.parent !== window && event.source !== window.parent)) return;
    const message = event.data;
    if (!message || (message.sessionId && message.sessionId !== sessionId)) return;
    if (message.type === 'analysis-trace-visibility') { message.visible ? resume() : pause(); return; }
    if (message.type === 'analysis-trace-refresh') { if (active) start(true); return; }
    if (message.type !== 'analysis-trace-data' || !message.payload) return;
    const key = JSON.stringify(message.payload);
    if (key === officialKey) return;
    officialKey = key; merge(official, message.payload); apply(message.payload);
  });
  window.addEventListener('pagehide', pause);
  window.addEventListener('analysis-trace-retry', () => { if (loading) start(true); });
  if (loading) {
    Object.assign(payload, { mainSession: sessionId, sessions: [{ id: sessionId, title: '执行路径', turns: [], totals: { turns: 0, steps: 0, calls: 0, errors: 0 }, overview: { episodes: [], turns: [], focus: {}, totals: {} }, communications: [] }],
      context: { requests: [], boundaries: [], callFacts: {}, fileOperations: [] }, traceStage: { core: 'loading', details: 'loading', actors: 'loading', context: window.parent === window ? 'unavailable' : 'loading' } });
  }
  boot();
  if (loading) start();
})();
