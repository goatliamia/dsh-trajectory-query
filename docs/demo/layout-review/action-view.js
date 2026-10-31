  function reviewActionStepLabel(step) {
    const kinds = [...new Set(step.calls.map(callKind))];
    const titles = [...new Set(step.calls.map(c => reviewContextData.callFacts?.[c.seq]?.title).filter(Boolean))];
    if (kinds.length === 1 && kinds[0] === 'other' && titles.length === 1) return titles[0] + (step.calls.length > 1 ? ' ×' + step.calls.length : '');
    return kinds.length > 1 ? kinds.slice(0, 2).map(kindLabel).join('、') + (kinds.length > 2 ? '等' : '') : stepLabel(step);
  }
  function renderActionPath() {
    const t = turn(), steps = t.steps, count = steps.length, viewport = $('graph-scroll');
    const canvas = $('canvas'); canvas.classList.add('review-action-mode');
    if (!count) { $('graph').innerHTML = ''; return; }
    selectedStep = Math.max(0, Math.min(selectedStep, count - 1));
    const selected = steps[selectedStep], showContext = overviewLayers.has('context'), showTime = overviewLayers.has('duration');
    const geometry = typeof geistActionGeometry === 'function' ? geistActionGeometry(t) : { height: 360, base: 208 };
    const viewportWidth = Math.max(300, viewport.clientWidth), viewportLeft = viewport.scrollLeft, gutter = 54, { height, base } = geometry;
    const gap = Math.max(128, Math.min(176, (viewportWidth - gutter * 2) / count));
    const width = Math.max(viewportWidth, gutter * 2 + gap * count);
    const start = (width - gap * count) / 2, x = index => start + (index + .5) * gap;
    const scale = { ...reviewActionScale(t), pixels: 100 };
    // 上下按本轮实际的增减极值分配:数据在真实页面里是齐的(rows 598 / index 598)。
    let sideUp = 0, sideDown = 0;
    if (showContext) for (const step of steps) {
      const info = reviewStepContext(t, step); if (!info) continue;
      let plus = 0, minus = 0;
      for (const c of CONTEXT_CATEGORIES) { const value = info.parts[c.key] || 0; if (value > 0) plus += value; else minus -= value; }
      sideUp = Math.max(sideUp, plus); sideDown = Math.max(sideDown, minus);
    }
    const band = scale.pixels * 2;
    const upPixels = sideUp + sideDown > 0 ? Math.max(28, band * sideUp / (sideUp + sideDown)) : scale.pixels;
    const downPixels = band - upPixels;
    const upSide = { limit: Math.max(1, sideUp), pixels: upPixels }, downSide = { limit: Math.max(1, sideDown), pixels: downPixels };
    const gridTop = base - upPixels, gridBottom = base + downPixels;
    let html = '<title>第 ' + t.number + ' 轮 · 逐步行动</title><desc>每个图标是一段模型处理及随后发起的工具操作，步内可能经历请求重试。上下文与主线共用零点，向上增加、向下减少。步骤间距表示顺序，不表示耗时。</desc>', axisLabels = '';
    html += '<defs><pattern id="review-action-negative" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="var(--surface)" stroke-opacity=".6"/></pattern></defs>';
    if (showContext) {
      html += '<path d="M' + gutter + ' ' + gridTop + 'H' + (width - gutter) + '" class="review-context-grid"/>';
      html += '<path d="M' + gutter + ' ' + gridBottom + 'H' + (width - gutter) + '" class="review-context-grid"/>';
      axisLabels += brText(gutter - 7, gridTop + 3, reviewSigned(upSide.limit), 'review-context-axis', 'end');
      axisLabels += brText(gutter - 7, gridBottom + 3, reviewSigned(-downSide.limit), 'review-context-axis', 'end');
    }
    html += '<path d="M' + (x(0) - 36) + ' ' + base + 'H' + (x(count - 1) + 36) + '" class="br-trunk"/>';
    steps.forEach((step, index) => {
      const pos = x(index), active = index === selectedStep, left = start + index * gap + 6, right = left + gap - 12;
      const info = reviewStepContext(t, step);
      let part = '<rect x="' + left + '" y="28" width="' + (right - left) + '" height="' + (height - 60) + '" class="br-hit"/>';
      // 步号与耗时并成一行,顶部少一行给图。
      part += brText(pos, 48, '第 ' + step.number + ' 步' + (showTime ? ' · ' + preciseTime(step.end - step.start) : ''), 'review-turn-duration');
      part += '<path d="M' + left + ' 56v4H' + right + 'v-4" class="review-interval-guide"/>';
      if (showContext && info) {
        const values = CONTEXT_CATEGORIES.map(c => ({ ...c, value: info.parts[c.key] }));
        const plus = values.reduce((n, c) => n + Math.max(0, c.value), 0), minus = values.reduce((n, c) => n + Math.max(0, -c.value), 0);
        const sides = { up: contextDisplaySide(plus, upSide), down: contextDisplaySide(minus, downSide) };
        let up = base, down = base;
        for (const c of values) {
          if (!c.value) continue;
          const side = c.value > 0 ? sides.up : sides.down, h = Math.abs(c.value) * side.factor;
          const y = c.value > 0 ? up - h : down;
          part += '<rect data-context-segment="' + c.key + '" x="' + (pos - 20) + '" y="' + y + '" width="40" height="' + h + '" fill="' + c.color + '" opacity="' + (active ? '.65' : '.46') + '"/>';
          if (c.value < 0) part += '<rect x="' + (pos - 20) + '" y="' + y + '" width="40" height="' + h + '" fill="url(#review-action-negative)" pointer-events="none"/>';
          if (c.value > 0) up -= h; else down += h;
        }
        for (const [amount, side, sign] of [[plus, sides.up, 1], [minus, sides.down, -1]]) {
          if (!amount) continue;
          const edge = base - sign * side.height;
          const labelY = sign > 0 ? Math.min(base - 27, edge - 9) : Math.max(base + 78, edge + 15);
          part += brText(pos, labelY, (info.initial ? '初始 ' : '') + reviewSigned(amount * sign) + (side.overflow ? ' · 收起' : ''), 'review-context-overflow-label');
          if (side.overflow) {
            part += '<rect x="' + (pos - 20) + '" y="' + (edge - 4 * sign - 4) + '" width="40" height="8" rx="3" class="review-context-capped"/>';
            for (const dx of [-4, 0, 4]) part += '<circle cx="' + (pos + dx) + '" cy="' + (edge - 4 * sign) + '" r=".9" class="review-context-capped-dot"/>';
          }
        }
      } else if (showContext) part += brText(pos, base - 30, '上下文未记录', 'br-note');
      if (active) part += '<circle cx="' + pos + '" cy="' + base + '" r="18" class="review-action-halo"/>';
      part += '<circle cx="' + pos + '" cy="' + base + '" r="13" class="review-action-node"/>';
      const icon = step.calls.length && step.calls.every(c => /^查询/.test(reviewContextData.callFacts?.[c.seq]?.title || '')) ? STEP_ICON.query : stepIcon(step);
      part += '<g transform="translate(' + pos + ' ' + base + ')" class="review-action-icon">' + icon + '</g>';
      part += brText(pos, base + 34, shorten(reviewActionStepLabel(step), 16), 'br-label');
      html += brGroup('class="action-step review-action-step' + (active ? ' is-selected' : '') + '" data-step="' + index + '" aria-pressed="' + active + '"', part,
        '第 ' + step.number + ' 步 · ' + reviewActionStepLabel(step) + ' · ' + preciseTime(step.end - step.start) + (info ? '；上下文净变化 ' + reviewSigned(info.amount) : ''));
    });
    const fullTitle = '第 ' + t.number + ' 轮 · ' + String(t.prompts?.[0]?.text || t.title || '').replace(/\s+/g, ' ');
    const titleWidth = Math.max(60, viewportWidth - gutter * 2 - 210);
    let title = fullTitle;
    if (reviewMeasure(title) > titleWidth) {
      let low = 0, high = title.length;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (reviewMeasure(title.slice(0, mid) + '…') <= titleWidth) low = mid; else high = mid - 1; }
      title = title.slice(0, low) + '…';
    }
    const failures = steps.filter(s => s.calls.some(c => c.status === 'error')).length;
    html += '<g class="review-action-pinned" transform="translate(' + viewport.scrollLeft + ',0)">' + axisLabels +
      brText(gutter, 18, title, 'br-note', 'start') +
      brText(viewportWidth - gutter, 18, count + ' 步' + (showTime ? ' · ' + reviewDuration(endOf(t) - t.start) : '') + (failures ? ' · ' + failures + ' 步受阻' : ''), 'br-note', 'end') +
      brText(gutter, height - 12, showContext ? '每步上下文变化 · 显示至 ±' + reviewTokens(scale.limit) : '步骤从左到右排列', 'br-axis', 'start') +
      brText(viewportWidth - gutter, height - 12, '间距表示顺序 · 耗时见上方', 'br-axis', 'end') + '</g>';
    reviewActionFileFrame = { t, x, base, gutter, height, viewportWidth, viewportLeft };
    html += '<g id="review-files-layer">' + reviewActionFiles(t, x, base, viewport.scrollLeft + gutter, viewport.scrollLeft + viewportWidth - gutter, height) + '</g>';
    const graph = $('graph');
    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height); graph.setAttribute('height', height);
    graph.style.width = width + 'px'; graph.innerHTML = html;
    graph.querySelectorAll('[data-step]').forEach(el => {
      el.onclick = () => selectStep(Number(el.dataset.step));
      el.ondblclick = () => showStep(Number(el.dataset.step));
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(Number(el.dataset.step)); graph.querySelector('[data-step="' + selectedStep + '"]')?.focus({ preventScroll: true }); } };
    });
    reviewRenderStepSummary(t, selected);
    reviewRenderActionCaption();
    reviewBindActionControls();
    reviewFilesBind();
    if (!viewport.dataset.reviewPinnedBound) {
      viewport.dataset.reviewPinnedBound = 'true';
      viewport.addEventListener('scroll', () => {
        if (view === 'path') {
          graph.querySelector('.review-action-pinned')?.setAttribute('transform', 'translate(' + viewport.scrollLeft + ',0)');
          reviewRefreshActionFiles();
        }
      });
    }
  }
  // Selection changes the active mark and inspector, not the already materialized
  // turn geometry. Data/layer/viewport changes still go through the full renderer.
  selectStep = function(index) {
    const t = turn(), next = Math.max(0, Math.min(t.steps.length - 1, index));
    if (!t.steps.length || !Number.isInteger(next)) return;
    const graph = $('graph'), frame = reviewActionFileFrame, node = graph.querySelector('[data-step="' + next + '"]');
    if (view !== 'path' || zoom || frame?.t !== t || !node) { selectedStep = next; renderActionPath(); return; }
    const previous = graph.querySelector('[data-step="' + selectedStep + '"]');
    if (next !== selectedStep) {
      if (previous) {
        previous.classList.remove('is-selected'); previous.setAttribute('aria-pressed', 'false');
        previous.querySelector('.review-action-halo')?.remove();
        previous.querySelectorAll('[data-context-segment]').forEach(el => el.setAttribute('opacity', '.46'));
      }
      selectedStep = next;
      node.classList.add('is-selected'); node.setAttribute('aria-pressed', 'true');
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({ cx: frame.x(next), cy: frame.base, r: 18, class: 'review-action-halo' })) halo.setAttribute(key, value);
      node.insertBefore(halo, node.querySelector('.review-action-node'));
      node.querySelectorAll('[data-context-segment]').forEach(el => el.setAttribute('opacity', '.65'));
    }
    reviewRenderStepSummary(t, t.steps[next]);
    if (typeof geistUpdateStepTiming === 'function') geistUpdateStepTiming(t);
    reviewApplyFileFocus();
    if (typeof geistBindSkillMaterials === 'function') geistBindSkillMaterials();
  };
  function reviewRenderStepSummary(t, step) {
    const panel = $('step-panel'), info = reviewStepContext(t, step);
    const identity = [session.id, t.number, step.number, overviewLayers.has('duration'), overviewLayers.has('context')].join(':');
    if (panel.dataset.detailKey === identity) return;
    panel.dataset.detailKey = identity;
    const insight = stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts);
    panel.className = 'step-panel on review-step-summary'; panel.style.display = '';
    const calls = step.calls || [];
    const single = insight.calls.length === 1;
    const title = single ? insight.calls[0].title : reviewActionStepLabel(step);
    const renderCall = fact => '<article class="review-operation">' +
      (single ? '' : '<h4>' + esc(fact.title) + '</h4>') +
      '<div class="review-operation-result"><p data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</p>' +
      (fact.preview ? '<button class="review-operation-change" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? '查看原计划' : '对比改动') + ' ↗</button>' : '') + '</div></article>';
    const onward = insight.links[0] || (insight.following ? { step: insight.following.step, text: '第 ' + insight.following.step + ' 步 · ' + insight.following.text } : null);
    panel.innerHTML = '<div class="review-step-heading"><div><p>第 ' + step.number + ' 步' +
      (overviewLayers.has('duration') ? ' · ' + preciseTime(step.end - step.start) : '') + (calls.length ? ' · ' + calls.length + ' 项操作' : '') +
      '</p><h3>' + esc(title) + '</h3></div><button class="review-panel-quiet" id="panel-record">原始记录 ↗</button><button class="review-panel-quiet" id="panel-expand">展开全文</button></div>' +
      '<div class="review-operations">' + insight.calls.slice(0, 2).map(renderCall).join('') +
      (!calls.length && insight.reply ? '<p class="review-reply-summary">' + esc(insight.reply) + '</p>' : '') +
      (!calls.length && !insight.reply ? '<p class="review-reply-summary">没有记录到本步的文字回复或工具操作。</p>' : '') + '</div>' +
      '<div class="review-step-footer"><div>' + (onward ? '<span>' + (insight.links.length ? '后续确认' : '接下来') + '</span><button data-insight-step="' + onward.step + '" class="' + (insight.links.length ? 'review-insight-proof' : '') + '">' + esc(onward.text) + ' ↗</button>' : '<span>本轮执行记录到这里</span>') +
      '</div><button class="review-panel-quiet" id="review-panel-details">' + (insight.calls.length > 2 ? '全部 ' + insight.calls.length + ' 项操作与依据' : '前后文与依据') + ' ↗</button></div>';
    $('panel-record').onclick = () => showStep(selectedStep);
    const expand = $('panel-expand');
    if (expand) expand.onclick = () => { const open = panel.classList.toggle('is-open'); expand.textContent = open ? '收起' : '展开全文'; };
    $('review-panel-details').onclick = () => reviewOpenStepDetail(t, step, insight, info);
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
  }
  function reviewJumpToStep(t, number) {
    const index = t.steps.findIndex(s => s.number === number);
    if (index < 0) return;
    if ($('review-detail-overlay')) reviewCloseDetail();
    selectStep(index); $('graph').querySelector('[data-step="' + index + '"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function reviewRenderActionCaption() {
    $('graph-caption').innerHTML = '<div class="br-key"><span class="br-key-item"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" class="review-action-node"/></svg>操作步骤</span>' +
      '<span class="br-key-item"><svg viewBox="0 0 12 12">' + brCap(6, 6) + '</svg>报错</span></div>' +
      '<div class="review-action-guidance">点图标看这一步 · 双击看原始记录 · 缩小返回总览</div>' +
      '<div class="review-overlay-key" aria-hidden="' + !overviewLayers.has('context') + '"><span class="review-overlay-caption">上下文 <b>↑增 ↓减</b></span>' +
      CONTEXT_CATEGORIES.map(c => '<button class="review-overlay-source" data-action-source="' + c.key + '"><i style="background:' + c.color + '"></i>' + c.label + '</button>').join('') + '</div>';
    $('graph-caption').querySelectorAll('[data-action-source]').forEach(el => el.onclick = () => reviewOpenContextSources(el.dataset.actionSource));
  }
