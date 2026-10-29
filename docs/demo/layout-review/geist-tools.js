  let geistOfficialStats = data.officialStats?.snapshot;
  let geistStatsByStep = new Map((geistOfficialStats?.turns || []).flatMap(t => t.steps.map(s => [t.turn + ':' + s.step, s])));
  let geistOutcomes = collectToolResults(session, reviewContextData.callFacts || {}, reviewFileOperations);
  let geistOutcomeBranches = [];
  const geistOutcomeLayoutCache = new Map();
  const geistReportIcon = '<path d="M-4-6h5l3 3v9h-8zM1-6v3h3M-1-0.5h3M-1 2.5h3"/>';
  const geistOperationKindBase = callKind;
  callKind = function(call) { const family = reviewContextData.callFacts?.[call.seq]?.operation?.family; return ({ read: 'read', write: 'write', search: 'query', web: 'query', command: 'run', process: 'run' })[family] || geistOperationKindBase(call); };
  const geistOperationIconBase = stepIcon;
  stepIcon = function(step) { const family = reviewContextData.callFacts?.[step.calls[0]?.seq]?.operation?.family; return family === 'read' ? geistReportIcon : family === 'search' ? STEP_ICON.read : geistOperationIconBase(step); };
  const geistOperationStepLabelBase = reviewActionStepLabel;
  reviewActionStepLabel = function(step) {
    if (!step.calls.some(call => reviewContextData.callFacts?.[call.seq]?.operation)) return geistOperationStepLabelBase(step);
    const names = [...new Set(step.calls.map(call => call.name))];
    return names.slice(0, 2).join(' / ') + (names.length > 2 ? ' 等' : '');
  };
  function geistOutcomeText(members) {
    if (members.length === 1) {
      const r = members[0].result;
      const text = r.kind === 'incident' ? reviewBranchLabel([{ e: r.incident }]) : toolResultLabel(r);
      return shorten(view === 'path' ? text.replace(/^\d+\s*·\s*/, '') : text, r.recorded ? 22 : 17);
    }
    const errors = members.filter(m => ['incident', 'error'].includes(m.result.kind)).length;
    const recovered = members.filter(m => m.result.kind === 'incident' && m.result.incident.complete).length;
    if (members.some(m => m.result.recorded)) {
      const calls = members.flatMap(m => m.result.calls), counts = new Map();
      for (const call of calls) counts.set(call.name, (counts.get(call.name) || 0) + 1);
      const labels = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, n]) => n === 1 ? compactToolLabel(calls.find(c => c.name === name)) : name + ' ×' + n);
      if (errors) labels.push(errors + (recovered === errors ? ' 处已恢复' : ' 处受阻'));
      if (members.some(m => m.result.kind === 'pending')) labels.push('有待返回');
      return labels.join(' · ');
    }
    const names = { read: '取回内容', change: '文件改动', check: '检查输出', query: '查询结果' };
    const kinds = ['check', 'change', 'read', 'query'].filter(kind => members.some(m => m.result.kind === kind)).slice(0, errors ? 1 : 2);
    return kinds.map(kind => names[kind]).join(' · ') + (errors ? (kinds.length ? ' · ' : '') + errors + (recovered === errors ? ' 处已恢复' : ' 处受阻') : '');
  }
  function geistOutcomeGlyph(result, x, y) {
    if (result.kind === 'incident') {
      return brCap(x, y, result.incident.condition);
    }
    if (result.kind === 'error') return brCap(x, y);
    if (result.kind === 'recovered') return brCap(x, y);
    if (result.recorded) {
      const kind = result.kind === 'pending' ? 'pending' : result.family || result.kind;
      const glyph = kind === 'read' ? geistReportIcon : kind === 'write' ? STEP_ICON.write : kind === 'search' ? STEP_ICON.read : kind === 'command' ? STEP_ICON.run : kind === 'pending' || kind === 'process' ? '<circle r="5"/><path d="M0-3v3l2 1"/>' : kind === 'coordination' ? '<path d="M-4-5v7q0 3 4 3h4M-4-1h5q3 0 3-4"/><circle cx="-4" cy="-5" r="1"/><circle cx="4" cy="-5" r="1"/>' : STEP_ICON.query;
      return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + (kind === 'write' ? 'change' : kind) + '">' + glyph + '</g>';
    }
    if (result.kind === 'check') {
      const failed = result.calls.some(c => /^命令输出报告：FAIL\b/i.test(c.fact?.outcome || '') || /^\s*FAIL\b/im.test(c.result?.text || ''));
      return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + (failed ? 'error' : 'check') + '">' + geistReportIcon + '</g>';
    }
    return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + result.kind + '">' + STEP_ICON[result.kind === 'change' ? 'write' : result.kind === 'read' ? 'read' : 'query'] + '</g>';
  }
  function geistResultBranchBody(p, base) {
    const y = base + p.dy, sign = p.dy > 0 ? 1 : -1;
    const twig = 'M' + p.x + ' ' + (base + sign * 2) + 'V' + (y - sign * 10) + 'Q' + p.x + ' ' + y + ' ' + (p.x + 10) + ' ' + y + 'H' + (p.x + 14);
    const endpoint = toolResultEndpoint(p.members);
    const glyph = '<g class="geist-branch-tip" data-endpoint-kind="' + endpoint.kind + '" aria-hidden="true">' + geistOutcomeGlyph(endpoint, p.x + 20, y) + '</g>';
    const body = '<rect class="br-hit" x="' + (p.left - 4) + '" y="' + (base + p.top - 3) + '" width="' + (p.right - p.left + 8) + '" height="' + (p.bottom - p.top + 6) + '"/>' +
      '<path d="' + twig + '" class="br-connector"/>' + glyph + brText(p.cx, p.dy > 0 ? y + 21 : y - 14, p.label, 'br-label');
    return body;
  }
  function geistDrawResultBranches(items, base, left, right, visible, options = {}) {
    if (!items.length) { geistOutcomeBranches = []; return { html: '', bottom: base + 42 }; }
    const key = [view, view === 'path' ? turn().number : overviewScale, right, overviewLayers.has('context'), reviewStress, document.fonts.status, options.reservedKey || ''].join(':');
    let packed = geistOutcomeLayoutCache.get(key);
    if (!packed) {
      const reserved = options.reserved || [], obstacles = [...reserved, ...(options.obstacles || [])];
      try { packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles }); }
      catch (error) {
        if (!options.obstacles?.length) throw error;
        packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles: reserved });
      }
      if (view === 'path' && options.obstacles?.length && packed.some(p => new Set(p.members.map(m => m.result.step)).size > 1)) {
        packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles: reserved });
      }
      if (geistOutcomeLayoutCache.size > 20) geistOutcomeLayoutCache.clear();
      geistOutcomeLayoutCache.set(key, packed);
    }
    geistOutcomeBranches = packed;
    let html = '', bottom = base + 42;
    packed.forEach((p, index) => {
      const y = base + p.dy, sign = p.dy > 0 ? 1 : -1;
      bottom = Math.max(bottom, y + 25);
      if (!visible(p.left, p.right)) return;
      const body = geistResultBranchBody(p, base);
      html += brGroup('class="br-incident geist-result-branch" data-tool-result="' + index + '"', body, p.label + '；点击查看执行结果及关联对象');
    });
    return { html, bottom };
  }
  reviewBranches = function(mapTime, base, visible, left, right, width) {
    const records = reviewStress ? collectToolResults(session, reviewContextData.callFacts || {}, reviewFileOperations) : geistOutcomes;
    const items = records.map(result => ({ id: result.id, at: reviewActiveTime(result.turn, result.time), x: mapTime(result.time), result }));
    const result = geistDrawResultBranches(items, base, 20, width - 20, visible);
    reviewBranchesNow = geistOutcomeBranches;
    return result;
  };
  reviewOverviewSummary = () => session.turns.length + ' 轮执行记录';
  function geistOutcomeFocus() {
    const relevant = new Set(reviewFileSelection ? reviewFileOperations.filter(o => fileIdentity(o.path) === reviewFileSelection).map(o => o.seq) : []);
    $('graph').querySelectorAll('[data-tool-result]').forEach(el => {
      const p = geistOutcomeBranches[Number(el.dataset.toolResult)];
      el.classList.toggle('file-related', p.members.some(m => m.result.seqs.some(seq => relevant.has(seq))));
    });
  }
  const geistFileFocusBase = reviewApplyFileFocus;
  reviewApplyFileFocus = function() { geistFileFocusBase(); geistOutcomeFocus(); };
  function geistOpenResult(result) {
    if (view === 'path' && turn().number === result.turn) {
      const index = turn().steps.findIndex(step => step.number === result.step);
      if (index >= 0) selectStep(index);
    }
    const seqs = new Set(result.seqs);
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      el.classList.toggle('branch-related', group.members.some(m => m.file.operations.some(op => seqs.has(op.seq))));
    });
    if (result.kind === 'incident') { reviewOpenBranch([result.incident]); return; }
    const names = { read: '取回文件内容', change: '文件修改', query: '查询结果', check: '检查输出', error: '操作受阻', command: '命令输出', process: '后台任务', web: '网页返回', coordination: '协作返回', pending: '等待工具返回', other: '工具返回' };
    const paths = [...new Set(result.calls.flatMap(c => c.files?.length ? c.files.map(file => file.path) : [c.file]).filter(Boolean))];
    let html = result.calls.map(call => '<div class="geist-outcome-record"><strong>' + esc(call.fact?.title || call.name) + '</strong><p>' + esc(call.fact?.outcome || '工具结果已记录') + '</p>' +
      (call.fact?.preview ? '<button class="geist-text-action" data-result-diff="' + call.seq + '">' + (call.fact.tone === 'bad' || call.fact.tone === 'unknown' ? '查看原计划' : '查看改动片段') + ' ↗</button>' : '') +
      (result.recorded ? '<p class="review-quiet">' + (call.inner ? '内部工具 · ' : '') + 'seq ' + call.seq + (call.rootSeq != null ? ' · 外层调用 #' + call.rootSeq : '') + '</p>' + callEntry(call) : '') + '</div>').join('');
    if (paths.length) html += '<div class="geist-outcome-files">' + paths.map((path, i) => '<button class="geist-text-action" data-result-file="' + i + '">' + esc(path.split(/[\\/]/).at(-1)) + ' · 全程记录 ↗</button>').join('') + '</div>';
    const embedded = window.parent !== window;
    html += '<div class="drawer-actions"><button class="action-button primary" id="geist-result-step">在行动路径中查看 ↗</button><button class="action-button" id="geist-result-context">本轮上下文变化</button>' +
      (embedded ? '<button class="action-button" id="geist-result-chat">跳到第 ' + result.turn + ' 轮对话 ↗</button>' : '') + '</div>';
    if (result.kind === 'check') html += '<p class="review-quiet">按检查命令实际输出展示，不代表整个任务已经完成。</p>';
    if (result.calls.some(call => call.name === 'grep')) html += '<p class="review-quiet">搜索记录关联实际返回的匹配片段，不表示读入了整份文件。</p>';
    openDrawer(result.recorded ? toolResultLabel(result) : names[result.kind], '第 ' + result.turn + ' 轮 · 第 ' + result.step + ' 步 · ' + result.calls.length + ' 项操作', html);
    $('geist-result-step').onclick = () => { closeDrawer(); reviewEnterPath(result.turn, result.step); };
    $('geist-result-context').onclick = () => reviewOpenContext(result.turn);
    // 跳到对话由宿主视图完成(切到对话并滚到该轮),页面只把轮次交出去。
    $('geist-result-chat')?.addEventListener('click', () => window.parent.postMessage({ type: 'analysis-trace-jump', turn: result.turn }, location.origin));
    $('drawer-body').querySelectorAll('[data-result-file]').forEach(el => el.onclick = () => {
      const file = fileObjects(reviewFileOperations).find(f => f.id === fileIdentity(paths[Number(el.dataset.resultFile)]));
      if (file) { reviewSelectFile(file.id); closeDrawer(); reviewOpenFileHistory(file); }
    });
    $('drawer-body').querySelectorAll('[data-result-diff]').forEach(el => el.onclick = () => {
      const call = result.calls.find(c => c.seq === Number(el.dataset.resultDiff)), t = brRound(result.turn), step = t.steps.find(s => s.number === result.step);
      reviewOpenChange(t, step, call.fact);
    });
  }
  function geistOpenResultGroup(members) {
    if (members.length === 1) { geistOpenResult(members[0].result); return; }
    openDrawer('这段执行的工具结果', members.length + ' 项结果 · 同一主干上的不同返回', '<div class="review-list">' + members.map((m, i) => '<button data-result-item="' + i + '">' + esc(m.result.kind === 'incident' ? episodeMeaning(m.result.incident).short : toolResultLabel(m.result)) + '<small>第 ' + m.result.turn + ' 轮 · 第 ' + m.result.step + ' 步</small></button>').join('') + '</div>');
    $('drawer-body').querySelectorAll('[data-result-item]').forEach(el => el.onclick = () => geistOpenResult(members[Number(el.dataset.resultItem)].result));
  }
  function geistBindResults() {
    $('graph').querySelectorAll('[data-tool-result]').forEach(el => {
      const open = () => geistOpenResultGroup(geistOutcomeBranches[Number(el.dataset.toolResult)].members);
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    geistOutcomeFocus();
  }
  const geistResultsBindBase = reviewBind;
  reviewBind = function() { geistResultsBindBase(); geistBindResults(); };

  function geistTimingLayer(t, step, mapTime, base, interactive = false) {
    if (!overviewLayers.has('duration')) return '';
    const stats = geistStatsByStep.get(t.number + ':' + step.number), timing = toolTiming(stats, step);
    if (timing.status !== 'measured' || !timing.spans.length) return '';
    let body = '';
    for (const span of timing.spans) {
      const a = mapTime(span.start), b = mapTime(span.end);
      body += '<path d="M' + a + ' ' + (base + 3) + 'H' + Math.max(a + .6, b) + '" class="geist-tool-time"/>';
    }
    const a = mapTime(step.start), b = mapTime(step.end);
    if (interactive) body += '<rect x="' + a + '" y="' + (base + 1) + '" width="' + Math.max(1, b - a) + '" height="6" fill="transparent"/>';
    return brGroup('class="geist-tool-timing"' + (interactive ? ' data-tool-timing="' + t.number + ':' + step.number + '"' : ' style="pointer-events:none" tabindex="-1"'), body, '工具执行覆盖 ' + preciseTime(timing.coverage) + '；各调用累计 ' + preciseTime(timing.cumulative) + (timing.partial ? '；图中只展示已列出的调用区间' : ''));
  }
  function geistOpenTiming(number, stepNumber) {
    const t = brRound(number), step = t.steps.find(s => s.number === stepNumber), stats = geistStatsByStep.get(number + ':' + stepNumber), timing = toolTiming(stats, step);
    let html = '<dl class="geist-timing-facts"><div><dt>这一步</dt><dd>' + preciseTime(step.end - step.start) + '</dd></div><div><dt>工具执行覆盖</dt><dd>' + (timing.status === 'measured' ? preciseTime(timing.coverage) : timing.status === 'inconsistent' ? '历史时间记录不一致' : '未记录') + '</dd></div><div><dt>各调用累计</dt><dd>' + (timing.cumulative == null ? '未记录' : preciseTime(timing.cumulative)) + '</dd></div></dl>';
    html += '<p class="review-quiet">覆盖时间将重叠执行的区间只算一次；累计时间采用官方的工具调用计量口径。两者直接读取官方统计结果。</p>';
    if (timing.status === 'inconsistent') html += '<p class="review-quiet">这份历史记录的工具时间超出本步边界，因此没有按比例画进主图。</p>';
    if (timing.partial) html += '<p class="review-quiet">官方摘要最多列出每步 12 项调用，完整操作仍可在本步记录中查看。</p>';
    html += '<button class="action-button" id="geist-timing-path">查看这一步 ↗</button>';
    openDrawer('工具执行时间', '第 ' + number + ' 轮 · 第 ' + stepNumber + ' 步', html);
    $('geist-timing-path').onclick = () => { closeDrawer(); reviewEnterPath(number, stepNumber); };
  }
  function geistBindTiming() {
    $('graph').querySelectorAll('[data-tool-timing]').forEach(el => {
      const open = () => geistOpenTiming(...el.dataset.toolTiming.split(':').map(Number));
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }
  const geistOverviewResultsBase = renderOverview;
  renderOverview = function(...args) {
    const value = geistOverviewResultsBase(...args), p = overviewProjection;
    if (p && overviewLayers.has('duration')) {
      const svg = '<g class="geist-tool-time-layer">' + p.layout.filter(l => l.end >= p.visibleLeft && l.x <= p.visibleRight).map(l => l.turn.steps.map(step => geistTimingLayer(l.turn, step, p.mapTime, p.mainY)).join('')).join('') + '</g>';
      $('graph').insertAdjacentHTML('beforeend', svg); geistBindTiming();
    }
    return value;
  };
  const geistActionResultsBase = renderActionPath;
  renderActionPath = function(...args) {
    const value = geistActionResultsBase(...args), frame = reviewActionFileFrame;
    if (!frame) return value;
    const { t, x, base } = frame, halfGap = t.steps.length > 1 ? (x(1) - x(0)) / 2 : 56;
    if (overviewLayers.has('failures')) {
      const records = geistOutcomes.filter(r => r.turn === t.number);
      const indices = new Map(t.steps.map((s, i) => [s.number, i]));
      const items = records.map(result => ({ id: result.id, at: result.time, x: x(indices.get(result.step) ?? 0) + Math.min(36, halfGap - 18), result }));
      const contextLabels = [...$('graph').querySelectorAll('.review-context-overflow-label')];
      const obstacles = contextLabels.map(el => { const b = el.getBBox(); return { left: b.x - 1, right: b.x + b.width + 1, top: b.y - base - 1, bottom: b.y + b.height - base + 1 }; });
      const result = geistDrawResultBranches(items, base, frame.gutter, x(t.steps.length - 1) + halfGap, () => true, { slots: [-42, -64, -86, -104], aggregateSpan: 25, obstacles });
      $('graph').insertAdjacentHTML('beforeend', '<g class="geist-action-results">' + result.html + '</g>'); geistBindResults();
      // Numeric annotations keep their value and size; shift beside their own bar
      // when a result label needs the same space, rather than dropping the number.
      const occupiedNumbers = [];
      const childLines = typeof geistPlanAgentForks === 'function' ? geistPlanAgentForks() : [];
      for (const el of contextLabels) {
        const ox = Number(el.getAttribute('x')), oy = Number(el.getAttribute('y')), anchor = el.getAttribute('text-anchor') || 'middle';
        const choices = [[ox, oy, anchor], [ox - 24, oy, 'end'], [ox + 24, oy, 'start'], [ox, oy - 16, anchor], [ox, oy + 16, anchor]];
        let fit = false;
        for (const [nx, ny, align] of choices) {
          el.setAttribute('x', nx); el.setAttribute('y', ny); el.setAttribute('text-anchor', align);
          const b = el.getBBox();
          const hitsBranch = geistOutcomeBranches.some(p => b.x < p.right + 3 && b.x + b.width > p.left - 3 && b.y < base + p.bottom + 3 && b.y + b.height > base + p.top - 3);
          const hitsNumber = occupiedNumbers.some(q => b.x < q.x + q.width + 4 && b.x + b.width > q.x - 4 && b.y < q.y + q.height + 3 && b.y + b.height > q.y - 3);
          const hitsChildLine = childLines.some(p => b.x < p.end + 3 && b.x + b.width > p.x - 3 && b.y < base + p.dy + 6 && b.y + b.height > base + p.dy - 6);
          if (!hitsBranch && !hitsNumber && !hitsChildLine && b.x >= 2 && b.y >= 95) { occupiedNumbers.push(b); fit = true; break; }
        }
        if (!fit) { el.setAttribute('x', ox); el.setAttribute('y', oy); el.setAttribute('text-anchor', anchor); occupiedNumbers.push(el.getBBox()); }
      }
    }
    let timing = '';
    for (const [i, step] of t.steps.entries()) {
      const start = x(i) - halfGap + 7, span = halfGap * 2 - 14;
      timing += geistTimingLayer(t, step, time => start + Math.max(0, Math.min(1, (time - step.start) / Math.max(1, step.end - step.start))) * span, 65, true);
    }
    $('graph').insertAdjacentHTML('beforeend', '<g class="geist-tool-time-layer">' + timing + '</g>'); geistBindTiming();
    const meta = $('step-panel').querySelector('.geist-step-meta>span');
    if (meta && t.steps[selectedStep].calls.length && overviewLayers.has('duration') && !meta.querySelector('[data-native-tool-time]')) {
      const step = t.steps[selectedStep], timing = toolTiming(geistStatsByStep.get(t.number + ':' + step.number), step);
      const button = document.createElement('button'); button.className = 'geist-text-action'; button.dataset.nativeToolTime = '';
      button.textContent = timing.status === 'measured' ? '工具 ' + preciseTime(timing.coverage) : timing.status === 'inconsistent' ? '工具时间待核对' : '工具时间未记录';
      button.onclick = () => geistOpenTiming(t.number, step.number); meta.append(button);
    }
    return value;
  };
  const geistCaptionResultsBase = geistArrangeCaption;
  geistArrangeCaption = function() {
    geistCaptionResultsBase();
    const caption = $('graph-caption'), layers = caption.querySelector('.br-layers');
    const existing = layers?.querySelector('[data-br-layer="failures"],[data-action-layer="failures"]');
    if (existing) existing.parentElement.lastChild.textContent = '工具结果';
    else if (layers && view === 'path') {
      const label = document.createElement('label'); label.className = 'br-layer';
      label.innerHTML = '<input type="checkbox" data-action-layer="failures"' + (overviewLayers.has('failures') ? ' checked' : '') + '>工具结果';
      const input = label.querySelector('input'); input.onchange = () => { input.checked ? overviewLayers.add('failures') : overviewLayers.delete('failures'); renderActionPath(); };
      layers.prepend(label);
    }
    const key = caption.querySelector('.br-key');
    key?.querySelectorAll('.br-key-item').forEach(item => {
      if (item.querySelector('.br-check') || /结果还不清楚|结果未确认/.test(item.textContent)) item.remove();
    });
    if (key && !key.querySelector('.geist-result-key')) {
      key.insertAdjacentHTML('afterbegin', '<span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph read">' + STEP_ICON.read + '</svg>取回内容</span><span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph change">' + STEP_ICON.write + '</svg>写入修改</span><span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph check">' + geistReportIcon + '</svg>检查输出</span>');
    }
    if (key && overviewLayers.has('duration') && !key.querySelector('.geist-tool-time-key')) {
      key.insertAdjacentHTML('beforeend', '<span class="geist-tool-time-key" title="官方记录中工具从调用到返回的时间区间；点击本步工具时间查看覆盖与累计口径"><i></i>' + (view === 'path' ? '步内工具时段' : '工具执行区间') + '</span>');
    }
  };
