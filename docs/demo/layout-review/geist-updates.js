  // Merge arrivals cheaply, then rebuild only the indices whose inputs changed.
  // Several arrivals in one frame share the same index and graph work.
  window.__ctxProbe = () => ({ rows: reviewContextRequests.length, index: reviewContextStepIndex.size, view, sample: reviewContextRequests.slice(0, 2).map(r => ({ seq: r.seq, turn: r.turn, step: r.step })) });

  const geistDirty = new Set();
  const geistUpdateCounts = window.__traceUpdates = { context: 0, outcomes: 0, actors: 0, stats: 0, graph: 0, contextLayer: 0, summary: 0 };
  const geistArrived = new Set();
  window.__geistUpdate = (patch, options = {}) => {
    const before = { requests: reviewContextData.requests, history: reviewContextData.historyRequests,
      files: reviewContextData.fileOperations, facts: reviewContextData.callFacts,
      branches: reviewContextData.agentBranches, skills: reviewContextData.skillEvents, analysis: reviewContextData.skillAnalysis,
      stats: data.officialStats?.snapshot };
    if (patch.sessions) {
      for (const incoming of patch.sessions) {
        const current = data.sessions.find(row => row.id === incoming.id);
        if (!current) { data.sessions.push(incoming); continue; }
        const empty = !current.turns.length, selected = current === session ? turn()?.number : null;
        const turns = new Map(current.turns.map(turn => [turn.number, turn]));
        for (const [key, value] of Object.entries(incoming)) if (key !== 'turns') current[key] = value;
        for (const row of incoming.turns || []) {
          const target = turns.get(row.number);
          if (target) geistHydrateTurn(target, row); else current.turns.push(row);
        }
        if (options.stage === 'details' || options.stage === 'core') {
          const available = new Set((incoming.turns || []).map(row => row.number));
          current.turns = current.turns.filter(row => available.has(row.number));
          if (current === session && selected != null) turnIndex = Math.max(0, current.turns.findIndex(row => row.number === selected));
        }
        if (empty && current === session) turnIndex = Math.max(0, current.turns.findIndex(t => t.number === 6));
      }
      geistDirty.add('session'); geistHeaderDirty = true;
    }
    const rest = { ...patch }; delete rest.sessions; geistMerge(data, rest);
    if (options.stage && options.stage !== 'turn' && data.traceStage) data.traceStage[options.stage] = 'ready';
    Object.assign(reviewContextData, data.context || {});
    if (reviewContextData.requests !== before.requests || reviewContextData.historyRequests !== before.history) geistDirty.add('context');
    if (reviewContextData.fileOperations !== before.files || patch.context?.fileOperations) geistDirty.add('files');
    if (reviewContextData.callFacts !== before.facts || patch.context?.callFacts) geistDirty.add('facts');
    if (reviewContextData.agentBranches !== before.branches || reviewContextData.skillEvents !== before.skills || reviewContextData.skillAnalysis !== before.analysis) geistDirty.add('actors');
    if (data.officialStats?.snapshot !== before.stats || patch.officialStats?.snapshot) geistDirty.add('stats');
    if (patch.context?.current || patch.context?.route || patch.officialStats?.context) geistDirty.add('summary');
    geistProgressStatus();
    if (!geistDirty.size) { geistContextCoverage(); return; }
    if (geistUpdateFrame) return;
    geistUpdateFrame = requestAnimationFrame(() => {
      geistUpdateFrame = 0;
      const dirty = new Set(geistDirty); geistDirty.clear();
      const changed = name => dirty.has(name), sessionChanged = changed('session');
      if (sessionChanged) {
        reviewRealEpisodes = session.overview.episodes;
        reviewRetryEvents = reviewContextData.retries || session.turns.flatMap(t => t.steps.flatMap(s => s.retries.map(r => ({ ...r, turn: t.number, step: s.number }))));
      }
      if (changed('context')) {
        const bySeq = new Map([...(reviewContextData.historyRequests || []), ...(reviewContextData.requests || [])].map(row => [row.seq, row]));
        reviewContextRequests = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
        reviewContextStepIndex = reviewIndexContextSteps(reviewContextRequests);
        reviewActionScales.clear();
        reviewContextRows = contextByTurn(reviewContextRequests);
        reviewContextMap = new Map(reviewContextRows.map(row => [row.turn, row]));
        reviewContextScale = contextDisplayScale(reviewContextRows);
        reviewContextSelected ??= reviewContextRows.at(-1)?.turn ?? null;
        geistUpdateCounts.context++;
      }
      if (changed('files')) reviewFileOperations = reviewContextData.fileOperations || [];
      if (sessionChanged || changed('facts') || changed('files')) {
        geistOutcomes = data.traceStage && data.traceStage.details !== 'ready' ? [] : collectToolResults(session, reviewContextData.callFacts || {}, reviewFileOperations);
        geistUpdateCounts.outcomes++;
      }
      if (changed('actors')) {
        geistActors = actorRecords(data); geistSkills = skillObjects(geistActors.skills);
        geistSkillAnalysis = reviewContextData.skillAnalysis;
        geistUpdateCounts.actors++;
      }
      if (changed('actors') || changed('files') || sessionChanged) geistSkillScopeCache.clear();
      if (changed('stats')) {
        geistOfficialStats = data.officialStats?.snapshot;
        geistStatsByStep = new Map((geistOfficialStats?.turns || []).flatMap(t => t.steps.map(s => [t.turn + ':' + s.step, s])));
        geistUpdateCounts.stats++;
      }
      const graph = sessionChanged || ['context', 'files', 'facts', 'actors', 'stats'].some(changed);
      if (sessionChanged || changed('summary') || changed('stats')) {
        geistContextSnapshot = data.officialStats?.context;
        if ($('geist-context-overview')) delete $('geist-context-overview').dataset.ready;
        geistRenderContextOverview(); geistActorControls(); geistUpdateCounts.summary++;
      }
      const contextOnly = changed('context') && !sessionChanged && !['files','facts','actors','stats'].some(changed)
        && view === 'overview' && $('trace-context-layer') && overviewProjection;
      if (contextOnly) {
        const p = overviewProjection, visible = (a, b = a) => b >= p.visibleLeft - 90 && a <= p.visibleRight + 90;
        $('trace-context-layer').innerHTML = reviewContextLayer(p.layout, p.mainY, p.visibleLeft, p.visibleRight, visible);
        reviewContextBind();
        if ($('review-context-scale-note')) $('review-context-scale-note').textContent = '柱高至 ±' + reviewTokens(reviewContextScale.limit) + ' · …收起更大量';
        geistUpdateCounts.contextLayer++;
      } else if (graph && session.turns.length) {
        geistOutcomeLayoutCache.clear();
        if ($('step-panel')) delete $('step-panel').dataset.detailKey;
        const vp = $('graph-scroll'), left = vp.scrollLeft, top = vp.scrollTop;
        const focused = document.activeElement, focusId = focused?.id;
        const attribute = ['data-turn', 'data-step', 'data-inspector-nav'].find(key => focused?.hasAttribute(key));
        const value = attribute && focused.getAttribute(attribute);
        if (geistHeaderDirty) {
          geistHeaderDirty = false;
          const list = $('turn-list'), y = list.scrollTop, x = list.scrollLeft;
          header(); list.scrollTop = y; list.scrollLeft = x;
        }
        if (view === 'path') renderActionPath(); else renderOverview({ plotOnly: true });
        vp.scrollLeft = left; vp.scrollTop = top;
        if (focused && !focused.isConnected) (focusId ? $(focusId) : attribute ? [...document.querySelectorAll('[' + attribute + ']')].find(node => node.getAttribute(attribute) === value) : null)?.focus({ preventScroll: true });
        geistUpdateCounts.graph++;
      }
      for (const [name, ready, selector] of [['core', session.turns.length, '.br-trunk'], ['context', reviewContextRows.length, '#trace-context-layer'], ['actors', geistActors.branches.length, '.actor-layer']]) {
        if (!ready || geistArrived.has(name)) continue;
        const nodes = [...$('graph').querySelectorAll(selector)];
        if (!nodes.length) continue;
        geistArrived.add(name); nodes.forEach(node => node.classList.add('trace-stage-enter'));
        setTimeout(() => nodes.forEach(node => node.classList.remove('trace-stage-enter')), 200);
      }
      geistProgressStatus(); geistContextCoverage();
      const selected = Number($('drawer').dataset.contextTurn);
      if (changed('context') && selected && $('canvas').classList.contains('drawer-open')) reviewOpenContext(selected);
    });
  };
  const geistCoverageArrange = geistArrangeCaption;
  geistArrangeCaption = function(...args) { const value = geistCoverageArrange(...args); geistContextCoverage(); return value; };
