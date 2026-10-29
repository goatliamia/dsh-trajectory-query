  // Keep one renderer and one set of interaction state while data arrives.
  // The demo and legacy standalone page still start with complete data.
  let geistUpdateFrame = 0, geistDetailIntent = 0, geistHeaderDirty = false;
  const geistMerge = (target, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) geistMerge(target[key], value);
      else target[key] = value;
    }
  };
  function geistHydrateTurn(target, source) {
    const steps = target.steps;
    const byNumber = new Map((steps || []).map(row => [row.number, row]));
    Object.assign(target, source);
    if (steps && source.steps) target.steps = source.steps.map(row => {
      const current = byNumber.get(row.number);
      return current ? Object.assign(current, row) : row;
    });
  }
  function geistProgressStatus() {
    if (!data.traceStage) return;
    let status = $('trace-progress');
    if (!status) {
      status = document.createElement('span'); status.id = 'trace-progress'; status.className = 'trace-progress';
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      document.querySelector('.canvas-bar').append(status);
    }
    const names = { core: '主干', details: '原文与文件', actors: '子代理', context: '上下文', history: '早期增量', refresh: '记录校验' }, states = { ...data.traceStage, ...data.traceStatus };
    if (reviewContextRows.length) states.context = 'ready';
    const pending = Object.keys(names).filter(key => states[key] === 'loading');
    const failed = Object.keys(names).filter(key => ['error', 'unavailable', 'partial'].includes(states[key]));
    status.hidden = !pending.length && !failed.length;
    status.classList.toggle('is-loading', !!pending.length);
    status.replaceChildren(document.createTextNode(pending.length ? '正在补齐 · ' + pending.map(key => names[key]).join(' / ') : states.actors === 'partial' ? '部分子代理记录未完成' : failed.map(key => names[key]).join(' / ') + '暂不可用'));
    if (failed.some(key => key !== 'context')) {
      const retry = document.createElement('button'); retry.textContent = '重新加载';
      retry.onclick = () => window.dispatchEvent(new Event('analysis-trace-retry'));
      status.append(retry);
    }
  }
  // Suppress inferred branches made from short first-frame previews. Their
  // complete inputs are already being prefetched and replace this trunk soon.
  const geistProgressBranches = reviewBranches;
  if (data.traceStage && data.traceStage.details !== 'ready') geistOutcomes = [];
  reviewBranches = function(...args) {
    return data.traceStage && data.traceStage.details !== 'ready' ? { html: '', bottom: args[1] + 42 } : geistProgressBranches(...args);
  };
  const geistProgressClose = closeDrawer;
  closeDrawer = function(...args) { geistDetailIntent++; return geistProgressClose(...args); };
  const geistProgressOpen = openDrawer;
  openDrawer = function(...args) { delete $('drawer').dataset.contextTurn; return geistProgressOpen(...args); };
  function geistWithTurn(number, action) {
    if (!window.__traceEnsureTurn || window.__traceTurnReady(number)) return action();
    const intent = ++geistDetailIntent;
    openDrawer('正在载入原始记录', '第 ' + number + ' 轮', '<p class="trace-detail-loading">正在优先读取这一轮的参数与结果…</p>');
    window.__traceEnsureTurn(number).then(() => {
      if (intent === geistDetailIntent && turn().number === number && $('canvas').classList.contains('drawer-open')) action();
    }).catch(() => {
      if (intent !== geistDetailIntent) return;
      $('drawer-body').innerHTML = '<p>这一轮的记录读取失败。</p><button class="action-button" id="trace-turn-retry">重试</button>';
      $('trace-turn-retry').onclick = () => geistWithTurn(number, action);
    });
  }
  const geistProgressStep = showStep;
  showStep = function(index) { const number = turn().number; return geistWithTurn(number, () => geistProgressStep(index)); };
  const geistProgressGroup = showGroup;
  showGroup = function(index) { return geistWithTurn(turn().number, () => geistProgressGroup(index)); };
  const geistProgressPrompts = showPrompts;
  showPrompts = function(...args) { return geistWithTurn(turn().number, () => geistProgressPrompts(...args)); };
  const geistProgressStepDetail = reviewOpenStepDetail;
  reviewOpenStepDetail = function(t, step) {
    return geistWithTurn(t.number, () => {
      if ($('canvas').classList.contains('drawer-open')) geistProgressClose();
      geistProgressStepDetail(t, step, stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts), reviewStepContext(t, step));
    });
  };
  const geistProgressSummary = reviewRenderStepSummary;
  reviewRenderStepSummary = function(t, step) {
    const value = geistProgressSummary(t, step);
    if (window.__traceEnsureTurn && !window.__traceTurnReady(t.number)) window.__traceEnsureTurn(t.number).catch(() => {});
    return value;
  };
  function geistContextCoverage() {
    if (!session.turns.length) return;
    let note = $('trace-context-coverage');
    if (!note) { note = document.createElement('div'); note.id = 'trace-context-coverage'; note.className = 'trace-context-coverage'; $('geist-context-overview').append(note); }
    const recent = reviewContextData.requests || [], history = reviewContextData.historyRequests || [];
    const first = Math.min(...recent.map(row => row.turn));
    const oldFirst = history.length ? Math.min(...history.map(row => row.turn)) : first;
    note.hidden = !recent.length || first <= session.turns[0].number;
    if (note.hidden) return;
    note.replaceChildren(document.createTextNode((history.length ? '已补充历史 ' + oldFirst + '–' + Math.max(...history.map(row => row.turn)) + ' 轮；' : '') + '当前增量记录从第 ' + first + ' 轮开始。'));
    if (oldFirst > session.turns[0].number && data.traceCapabilities?.history) {
      const button = document.createElement('button'); button.textContent = data.traceStatus?.history === 'loading' ? '正在读取更早增量…' : '读取更早增量';
      button.disabled = data.traceStatus?.history === 'loading';
      button.onclick = () => window.__traceLoadHistory(oldFirst); note.append(button);
    } else if (!history.length) note.append(document.createTextNode('更早记录超出当前返回范围。'));
    if (data.traceStatus?.history === 'error') note.append(document.createTextNode(' 历史回补暂不可用。'));
  }
  // The actual page stays present while the first log is read. No separate
  // illustration or synthetic branch stands in for recorded execution.
  window.__geistShell = function() {
    header(); geistRenderContextOverview(); geistProgressStatus();
    $('turn-heading').textContent = '正在读取主干，已有上下文会先显示';
  };
  const geistPendingOverview = renderOverview, geistPendingPath = renderActionPath;
  renderOverview = function(...args) { if (!session.turns.length) return window.__geistShell(); return geistPendingOverview(...args); };
  renderActionPath = function(...args) { if (!session.turns.length) return window.__geistShell(); return geistPendingPath(...args); };
  geistProgressStatus();
