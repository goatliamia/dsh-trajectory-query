  // Shared host study: independent overlay switches and source multi-selection.
  const studyMeaning = data.host === 'codex' ? { delta: '可见文本变化', total: '文本趋势', title: '可见文本趋势', quantity: '可见文本估算' } : data.host === 'pi' ? { delta: '上下文增量', total: '总趋势', title: '上下文估算趋势', quantity: '可见上下文估算' } : { delta: '上下文增量', total: '总趋势', title: '上下文总趋势', quantity: '上下文构成估算' };
  const studySources = new Set(CONTEXT_CATEGORIES.map(c => c.key));
  let studyShowTotal = true;
  const studyCategories = () => CONTEXT_CATEGORIES.filter(c => studySources.has(c.key));
  const studyLabel = () => studySources.size === CONTEXT_CATEGORIES.length ? '全部构成' : studySources.size ? studyCategories().map(c => c.label).join(' + ') : '未选择构成';
  const studySum = row => studyCategories().reduce((sum, c) => sum + Number(row?.[c.key] || 0), 0);
  function studyAmounts(row) {
    const values = Object.fromEntries(CONTEXT_CATEGORIES.map(c => [c.key, row && studySources.has(c.key) ? row.parts[c.key][row.isBaseline ? 'after' : 'delta'] : 0]));
    return { values, increase: Object.values(values).reduce((n, v) => n + Math.max(0, v), 0), decrease: Object.values(values).reduce((n, v) => n + Math.max(0, -v), 0) };
  }
  contextBarAmounts = studyAmounts;
  const studyOriginalStepContext = reviewStepContext;
  reviewStepContext = function(t, step) {
    const info = studyOriginalStepContext(t, step); if (!info) return info;
    const parts = Object.fromEntries(CONTEXT_CATEGORIES.map(c => [c.key, studySources.has(c.key) ? info.parts[c.key] : 0]));
    return { ...info, total: studySum(info.current), amount: Object.values(parts).reduce((n, v) => n + v, 0), parts };
  };
  const studyOriginalNote = reviewContextNote;
  reviewContextNote = function(row, number) {
    if (!row) return studyOriginalNote(row, number);
    const amount = studyCategories().reduce((n, c) => n + row.parts[c.key][row.isBaseline ? 'after' : 'delta'], 0);
    return '第 ' + row.turn + ' 轮 · ' + studyLabel() + (row.isBaseline ? ' ≈' + reviewTokens(amount) : ' ' + reviewSigned(amount));
  };
  geistOverviewGeometry = function() {
    geistRenderContextOverview();
    const total = studyShowTotal && view === 'overview';
    reviewContextScale.pixels = 76;
    return { height: total ? 430 : 350, base: total ? 282 : overviewLayers.has('context') ? 202 : 208 };
  };
  function studySyncSources() {
    const region = $('geist-context-overview'); if (!region) return;
    let actions = $('study-source-actions');
    if (!actions) {
      actions = document.createElement('div'); actions.id = 'study-source-actions'; actions.className = 'study-source-actions';
      actions.innerHTML = '<span>点选构成 · 可多选</span><button id="study-all-sources">全选</button><button id="study-clear-sources">清空</button>';
      region.querySelector('header').append(actions);
      $('study-all-sources').onclick = () => { CONTEXT_CATEGORIES.forEach(c => studySources.add(c.key)); studyRefresh(); };
      $('study-clear-sources').onclick = () => { studySources.clear(); studyRefresh(); };
    }
    for (const button of region.querySelectorAll('[data-current-source]')) {
      const key = button.dataset.currentSource, category = geistContextCategory(key), selected = studySources.has(key);
      button.style.setProperty('--source-color', category.color);
      button.setAttribute('aria-pressed', String(selected)); button.dataset.muted = String(!selected);
      button.title = (selected ? '取消' : '选上') + category.label + '；可同时选择多类';
      button.onclick = () => studyToggle(key);
    }
    for (const [index, segment] of [...region.querySelectorAll('.geist-context-occupied > span')].entries()) {
      const key = region.querySelectorAll('[data-current-source]')[index]?.dataset.currentSource;
      segment.dataset.muted = String(!studySources.has(key)); segment.onclick = () => studyToggle(key);
    }
  }
  function studyToggle(key) { studySources.has(key) ? studySources.delete(key) : studySources.add(key); studyRefresh(); }
  const studyOverviewHeader = geistRenderContextOverview;
  geistRenderContextOverview = function(...args) { const value = studyOverviewHeader(...args); studySyncSources(); return value; };
  function studyRefresh({ geometryChanged = false } = {}) {
    const pixels = reviewContextScale.pixels;
    reviewContextScale = contextDisplayScale(reviewContextRows.map(row => ({ ...row, ...studyAmounts(row) })));
    reviewContextScale.pixels = pixels;
    reviewActionScales.clear();
    if ($('step-panel')) delete $('step-panel').dataset.detailKey;
    $('canvas').dataset.contextTotal = String(studyShowTotal && view === 'overview');
    if (view === 'path') renderActionPath();
    else if (!geometryChanged && $('trace-context-layer') && overviewProjection) {
      const p = overviewProjection, visible = (a, b = a) => b >= p.visibleLeft - 90 && a <= p.visibleRight + 90;
      $('trace-context-layer').innerHTML = reviewContextLayer(p.layout, p.mainY, p.visibleLeft, p.visibleRight, visible);
      reviewContextBind(); studyBindStock();
      if ($('review-context-scale-note')) $('review-context-scale-note').textContent = '柱高至 ±' + reviewTokens(reviewContextScale.limit) + ' · …收起更大量';
    } else renderOverview({ plotOnly: true });
    studySyncSources();
  }
  function studyNice(value) {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
    return [1, 2, 2.5, 4, 5, 8, 10].map(n => n * magnitude).find(n => n >= value) || magnitude * 10;
  }
  const studyDeltaLayer = reviewContextLayer;
  let studySeriesCache, studyProjectionCache;
  function studySeries() {
    const categories = studyCategories(), mask = categories.map(c => c.key).join(':');
    if (studySeriesCache?.rows === reviewContextRequests && studySeriesCache.mask === mask) return studySeriesCache;
    let maximum = 0;
    const values = reviewContextRequests.map(row => {
      let sum = 0;
      const upper = categories.map(c => sum += Number(row[c.key] || 0));
      maximum = Math.max(maximum, sum); return upper;
    });
    return studySeriesCache = { rows: reviewContextRequests, mask, categories, values, maximum };
  }
  function studyStockLayer(layout, base, left, right, visible) {
    if (!studyShowTotal || view !== 'overview') return '';
    if (!studySources.size) return brText(left + 8, base - 54, '点选上方构成项，选择要追踪的类型', 'br-note', 'start');
    const projection = overviewProjection;
    const series = studySeries();
    const axis = projection.layout.map(l => [l.turn.number, l.turn.start, endOf(l.turn), l.x, l.end].join(':')).join('|');
    if (studyProjectionCache?.series !== series || studyProjectionCache.axis !== axis)
      studyProjectionCache = { series, axis, points: series.rows.map((row, index) => ({ row, index, x: projection.mapTime(row.time) })) };
    const points = studyProjectionCache.points;
    if (!points.length) return '';
    const max = studyNice(series.maximum * 1.03), pixels = 154, stockBase = base;
    const y = value => stockBase - value / max * pixels;
    const firstVisible = points.findIndex(p => p.x >= left);
    const first = firstVisible < 0 ? Math.max(0, points.length - 1) : Math.max(0, firstVisible - 1);
    const after = points.findIndex(p => p.x > right);
    const shown = points.slice(first, after < 0 ? undefined : after + 1);
    let html = '<defs><clipPath id="study-stock-clip"><rect x="' + left + '" y="' + (stockBase - pixels - 2) + '" width="' + Math.max(0, right - left) + '" height="' + (pixels + 4) + '"/></clipPath></defs>';
    const paired = overviewLayers.has('context');
    for (const amount of [0, max / 2, max]) {
      html += '<path d="M' + left + ' ' + y(amount) + 'H' + right + '" class="review-context-grid"/>' + brText(paired ? right + 7 : left - 7, y(amount) + 3, reviewTokens(amount), 'review-context-axis', paired ? 'start' : 'end');
    }
    html += brText(left + 6, base - pixels - 14, studyMeaning.title + ' · ' + studyLabel(), 'study-stock-title', 'start');
    html += '<g clip-path="url(#study-stock-clip)">';
    let lower = compactTrendPolyline(shown.map(p => [p.x, y(0)]));
    for (const [index, category] of series.categories.entries()) {
      const upper = compactTrendPolyline(shown.map(p => [p.x, y(series.values[p.index][index])]));
      const d = 'M' + upper.join('L') + 'L' + [...lower].reverse().join('L') + 'Z';
      html += '<path data-study-area="' + category.key + '" d="' + d + '" fill="' + category.color + '" class="study-stock-fill"/>';
      html += '<path d="M' + upper.join('L') + '" stroke="' + category.color + '" class="study-stock-edge"/>';
      lower = upper;
    }
    html += '</g>';
    for (const entry of layout) {
      if (!visible(entry.x, entry.end)) continue;
      const row = reviewContextMap.get(entry.turn.number); if (!row) continue;
      html += brGroup('class="study-stock-turn" data-stock-turn="' + row.turn + '"', '<rect class="br-hit" x="' + entry.x + '" y="' + (stockBase - pixels) + '" width="' + Math.max(1, entry.end - entry.x) + '" height="' + pixels + '"/>', studyStockNote(row) + '；点击查看保留量');
    }
    return html;
  }
  // Translucent retained context sits behind the original delta bars and path.
  // Both layers share the path baseline; their token scales stay separate.
  reviewContextLayer = function(...args) { return studyStockLayer(...args) + studyDeltaLayer(...args); };
  const studyCompactions = reviewCompactionLayer;
  reviewCompactionLayer = function(...args) {
    if (!studyShowTotal || overviewLayers.has('context')) return studyCompactions(...args);
    overviewLayers.add('context');
    try { return studyCompactions(...args); } finally { overviewLayers.delete('context'); }
  };
  function studyStockNote(row) {
    const amount = studyCategories().reduce((n, c) => n + row.parts[c.key].after, 0);
    return '第 ' + row.turn + ' 轮 · ' + studyLabel() + ' 保留 ≈' + reviewTokens(amount);
  }
  function studyOpenStock(number) {
    const row = reviewContextMap.get(number); if (!row) return;
    const total = studyCategories().reduce((n, c) => n + row.parts[c.key].after, 0);
    const all = CONTEXT_CATEGORIES.reduce((n, c) => n + row.parts[c.key].after, 0);
    let html = '<div class="review-context-headline"><strong>≈' + reviewTokens(total) + '</strong><span>tokens · 选中构成保留量</span></div>';
    html += '<div class="review-context-breakdown">' + studyCategories().map(c => '<div class="review-context-category"><div><i style="background:' + c.color + '"></i><span>' + c.label + '</span><b>≈' + reviewTokens(row.parts[c.key].after) + '</b></div><small>占完整构成 ' + (all ? row.parts[c.key].after / all * 100 : 0).toFixed(1) + '%</small></div>').join('') + '</div>';
    openDrawer('第 ' + number + ' 轮 · ' + studyMeaning.title, studyMeaning.quantity + ' · ' + studyLabel(), html);
  }
  const studyArrange = geistArrangeCaption;
  geistArrangeCaption = function(...args) {
    const result = studyArrange(...args); studySyncSources();
    const caption = $('graph-caption');
    const input = caption.querySelector('[data-br-layer="context"], [data-action-layer="context"]');
    if (!input) return result;
    const label = input.parentElement;
    const text = [...label.childNodes].find(node => node.nodeType === 3); if (text) text.textContent = studyMeaning.delta;
    const span = label.querySelector('span'); if (span) span.textContent = studyMeaning.delta;
    label.title = '显示每轮或每步的上下文增减，可与总趋势同时开启';
    let totalToggle = $('study-total-toggle');
    if (!totalToggle) { totalToggle = document.createElement('label'); totalToggle.id = 'study-total-toggle'; totalToggle.className = 'br-layer'; }
    label.after(totalToggle);
    const total = studyShowTotal && view === 'overview';
    totalToggle.innerHTML = '<input type="checkbox" data-study-total' + (total ? ' checked' : '') + '>' + studyMeaning.total;
    totalToggle.title = '把保留量叠加在原图上，与增量共用主干和时间轴，可同时开启';
    totalToggle.querySelector('input').onchange = event => { studyShowTotal = event.target.checked; if (studyShowTotal && view !== 'overview') reviewReturnOverview(); studyRefresh({ geometryChanged: true }); };
    $('canvas').dataset.contextTotal = String(total);
    studyBindStock();
    return result;
  };
  function studyBindStock() {
    const graph = $('graph'); if (graph.dataset.studyStockBound) return;
    graph.dataset.studyStockBound = 'true';
    const record = event => { const node = event.target.closest('[data-stock-turn]'); return node && graph.contains(node) ? reviewContextMap.get(Number(node.dataset.stockTurn)) : null; };
    graph.addEventListener('mouseover', event => { const row = record(event); if (row) tlReadout(studyStockNote(row)); });
    graph.addEventListener('click', event => { const row = record(event); if (row) { event.stopPropagation(); studyOpenStock(row.turn); } });
    graph.addEventListener('keydown', event => { const row = record(event); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); studyOpenStock(row.turn); } });
  }
