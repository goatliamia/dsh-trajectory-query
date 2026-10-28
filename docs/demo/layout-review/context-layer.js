  const reviewContextData = data.context || { requests: [], boundaries: [] };
  const reviewContextRows = contextByTurn(reviewContextData.requests);
  const reviewContextMap = new Map(reviewContextRows.map(row => [row.turn, row]));
  const reviewContextScale = contextDisplayScale(reviewContextRows);
  let reviewContextSelected = reviewContextRows.at(-1)?.turn ?? null;
  overviewLayers.add('context');
  const reviewTokens = value => Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : Math.round(value).toLocaleString();
  const reviewSigned = value => (value > 0 ? '+' : value < 0 ? '−' : '') + reviewTokens(Math.abs(value));
  function reviewDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return seconds + '秒';
    return Math.floor(seconds / 60) + '分' + (seconds % 60 ? seconds % 60 + '秒' : '');
  }
  function reviewTimeLayer(layout, visible, left, right, mainHeight, mapTime) {
    if (!overviewLayers.has('duration')) return '';
    let html = '', lastDivider = -Infinity;
    for (const l of layout) {
      if (!visible(l.x, l.end)) continue;
      const fullDivider = l.x - lastDivider >= 16;
      html += '<path d="M' + l.x + ' 96V' + (fullDivider ? mainHeight - 38 : 104) + '" class="review-turn-divider' + (fullDivider ? '' : ' short') + '"/>';
      if (fullDivider) lastDivider = l.x;
    }
    for (const group of durationGroups(layout)) {
      if (!visible(group.start, group.end)) continue;
      const first = group.rows[0].turn.number, last = group.rows.at(-1).turn.number;
      const start = Math.max(left, group.start), end = Math.min(right, group.end), cx = (start + end) / 2;
      const label = first === last ? '第 ' + first + ' 轮' : first + '–' + last + ' 轮 · 展开';
      const ongoing = group.rows.some(l => l.turn.end === null);
      const duration = (first === last ? '' : '共 ') + (ongoing ? '≥' : '') + reviewDuration(group.duration);
      let body = '<rect x="' + start + '" y="28" width="' + Math.max(1, end - start - 3) + '" height="38" rx="4" class="review-duration-band"/>';
      body += '<path d="M' + (start + 4) + ' 62v4H' + Math.max(start + 4, end - 7) + 'v-4" class="review-interval-guide"/>';
      if (end - start >= Math.max(reviewMeasure(label), reviewMeasure(duration)) + 8)
        body += brText(cx, 42, label, 'review-turn-duration') + brText(cx, 57, duration, 'review-turn-duration review-duration-value');
      html += brGroup('data-review-duration-range="' + first + ':' + last + '" class="review-duration-hit"', body,
        label + ' · ' + duration + '。点击查看每一轮耗时，没有按时长筛选。');
    }
    const last = layout.at(-1);
    if (last && visible(last.end)) html += '<path d="M' + last.end + ' 96V' + (mainHeight - 38) + '" class="review-turn-divider"/>';
    return html;
  }
  function reviewContextNote(row) {
    if (!row) return '没有这轮的构成记录';
    if (row.isBaseline) return '首轮已有 ' + reviewTokens(row.total) + ' · 看开始时的构成';
    return '第 ' + row.turn + ' 轮 · ' + (row.net >= 0 ? '净增 ' : '净减 ') + reviewTokens(Math.abs(row.net));
  }
  function reviewContextLayer(layout, base, left, right, visible) {
    if (!overviewLayers.has('context')) return '';
    if (!reviewContextRows.length) return '';
    const scale = reviewContextScale, zero = base;
    const top = zero - scale.pixels, bottom = zero + scale.pixels;
    let html = '<defs><pattern id="review-negative-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1 M0 5L5 0 M4 6L6 4" stroke="var(--surface)" stroke-opacity=".5" stroke-width="1"/></pattern></defs>';
    for (const y of [top, bottom]) html += '<path d="M' + left + ' ' + y + 'H' + right + '" class="review-context-grid"/>';
    html += brText(left - 7, top + 3, '+' + reviewTokens(scale.limit), 'review-context-axis', 'end');
    html += brText(left - 7, zero + 3, '0', 'review-context-axis', 'end');
    html += brText(left - 7, bottom + 3, '−' + reviewTokens(scale.limit), 'review-context-axis', 'end');
    const overflowLabels = [];
    for (const l of layout) {
      if (!visible(l.x, l.end)) continue;
      const row = reviewContextMap.get(l.turn.number);
      const x = (l.x + l.end) / 2, width = Math.max(.8, Math.min(38, (l.end - l.x) * .65));
      const amounts = contextBarAmounts(row);
      const positive = contextDisplaySide(amounts.increase, scale), negative = contextDisplaySide(amounts.decrease, scale);
      const upper = Math.max(15, positive.height), lower = Math.max(15, negative.height);
      let body = '<rect class="br-hit" x="' + l.x + '" y="' + (zero - upper) + '" width="' + Math.max(1, l.end - l.x) + '" height="' + (upper + lower) + '"/>';
      if (!row) {
        body += '<path d="M' + (x - 2) + ' ' + (zero - 2) + 'l4 4m0 -4l-4 4" class="review-context-missing"/>';
      } else {
        let up = zero, down = zero;
        for (const c of CONTEXT_CATEGORIES) {
          const delta = amounts.values[c.key];
          if (delta === 0) continue;
          const height = Math.abs(delta) * (delta > 0 ? positive.factor : negative.factor), start = delta > 0 ? up - height : down;
          body += '<rect data-context-segment="' + c.key + '" x="' + (x - width / 2) + '" y="' + start + '" width="' + width + '" height="' + height + '" fill="' + c.color + '" opacity="' + (delta > 0 ? .46 : .4) + '"/>';
          if (delta < 0) body += '<rect x="' + (x - width / 2) + '" y="' + start + '" width="' + width + '" height="' + height + '" fill="url(#review-negative-hatch)" pointer-events="none"/>';
          if (delta > 0) up -= height; else down += height;
        }
        for (const sign of [1, -1]) {
          const side = sign > 0 ? positive : negative;
          if (!side.overflow) continue;
          const y = zero - sign * (scale.pixels - 4), capWidth = Math.max(14, width);
          body += '<rect x="' + (x - capWidth / 2) + '" y="' + (y - 4) + '" width="' + capWidth + '" height="8" rx="3" class="review-context-capped"/>';
          for (const dx of [-4, 0, 4]) body += '<circle cx="' + (x + dx) + '" cy="' + y + '" r=".9" class="review-context-capped-dot"/>';
          overflowLabels.push({ x, sign, turn: row.turn, baseline: row.isBaseline, value: sign > 0 ? amounts.increase : -amounts.decrease });
        }
      }
      const note = reviewContextNote(row);
      html += brGroup('class="review-context-turn" data-context-turn="' + l.turn.number + '"', body, note + (row && !row.isBaseline ? '；增加 ' + reviewTokens(row.increase) + '，减少 ' + reviewTokens(row.decrease) : '；显示末次请求已有构成，作为后续轮次的比较基线') + (positive.overflow || negative.overflow ? '；实际量超过本图 ' + reviewTokens(scale.limit) + ' 显示范围，柱高已收起，不表示模型上下文超限' : ''));
    }
    for (const sign of [1, -1]) {
      const occupied = [];
      for (const item of overflowLabels.filter(i => i.sign === sign).sort((a, b) => Number(b.baseline) - Number(a.baseline) || Math.abs(b.value) - Math.abs(a.value))) {
        const label = (item.baseline ? '首轮 ' + reviewTokens(item.value) : reviewSigned(item.value)) + ' · 收起', width = reviewMeasure(label);
        const x = Math.max(left + width / 2, Math.min(right - width / 2, item.x));
        const y = sign > 0 ? top - 7 : bottom + 15;
        if (occupied.some(box => x - width / 2 < box.right + 10 && x + width / 2 > box.left - 10)) continue;
        if (reviewBranchesNow.some(p => x - width / 2 < p.right + 5 && x + width / 2 > p.left - 5 && y + 3 > base + p.top - 3 && y - 10 < base + p.bottom + 3)) continue;
        html += brGroup('class="review-context-overflow" data-context-turn="' + item.turn + '"',
          brText(x, y, label, 'review-context-overflow-label'), '第 ' + item.turn + ' 轮 · 实际 ' + reviewTokens(item.value) + ' tokens；柱高已收起，点开看完整构成');
        occupied.push({ left: x - width / 2, right: x + width / 2 });
      }
    }
    return html;
  }
  function reviewCompactionLayer(mapTime, left, right, mainHeight) {
    if (!overviewLayers.has('context')) return '';
    const markers = (reviewContextData.boundaries || []).filter(e => e.kind === 'compaction')
      .map(e => ({ id: e.seq, at: reviewActiveTime(e.turn, e.time), x: mapTime(e.time), e }));
    let html = '';
    for (const group of aggregateInScreen(markers, 24)) {
      const x = group[0].x;
      if (x < left || x > right) continue;
      const events = group.map(item => item.e);
      const caption = events.length === 1 ? '压缩上下文 · 第 ' + events[0].turn + ' 轮' : events.length + ' 次压缩上下文';
      html += '<path d="M' + x + ' 96V' + (mainHeight - 38) + '" class="review-compaction-divider"/>';
      html += brGroup('class="review-compaction-marker" data-context-compaction="' + events.map(e => e.seq).join(',') + '"',
        '<rect x="' + (x - 12) + '" y="68" width="24" height="24" rx="5" class="review-compaction-hit"/>' +
        '<g transform="translate(' + (x - 8) + ' 71)" class="review-scissors"><circle cx="3" cy="4" r="2.4"/><circle cx="3" cy="13" r="2.4"/><path d="M5 5.3L14.5 14M5 11.6L14.5 3"/></g>' +
        (events.length > 1 ? brText(x + 15, 83, String(events.length), 'review-compaction-count') : ''), caption);
    }
    return html;
  }
  function reviewOpenCompaction(seqs) {
    const events = reviewContextData.boundaries.filter(e => seqs.includes(e.seq));
    const event = events[0], row = reviewContextMap.get(event.turn);
    let html = '<p class="review-explain">系统把较早的一段对话整理成摘要，再带着摘要继续。黄色虚线标出摘要实际写入上下文的位置；原会话日志仍然保留。</p>';
    if (row) html += '<p class="review-context-change-note">第 ' + row.turn + ' 轮净变化 ' + reviewSigned(row.net) + ' tokens。这个数还包含本轮新增内容，不等于这次压缩单独减少的量。</p>';
    html += '<div class="review-list">' + events.map(e => '<button data-compaction-turn="' + e.turn + '">第 ' + e.turn + ' 轮 · 查看上下文来源变化<small>压缩记录 seq ' + e.seq + '</small></button>').join('') + '</div>';
    html += '<div class="drawer-actions"><button class="action-button primary" id="review-compaction-path">查看本轮行动路径 ↗</button></div>';
    openDrawer(events.length > 1 ? events.length + ' 次压缩上下文' : '压缩上下文', '较早的对话 → 摘要', html);
    document.querySelectorAll('[data-compaction-turn]').forEach(el => el.onclick = () => reviewOpenContext(Number(el.dataset.compactionTurn)));
    $('review-compaction-path').onclick = () => reviewEnterPath(event.turn);
  }
  function reviewOpenContext(turnNumber) {
    const row = reviewContextMap.get(turnNumber);
    if (!row) { openDrawer('暂无上下文构成记录', '第 ' + turnNumber + ' 轮', '<p class="review-explain">这一轮没有可用于比较的请求构成，不能把缺失当成零。</p>'); return; }
    reviewContextSelected = turnNumber;
    const first = reviewContextData.requests.find(r => r.turn === row.turn);
    const max = Math.max(1, ...CONTEXT_CATEGORIES.map(c => Math.abs(row.parts[c.key][row.isBaseline ? 'after' : 'delta'])));
    let html = '<div class="review-context-headline"><strong>' + (row.isBaseline ? reviewTokens(row.total) : reviewSigned(row.net)) + '</strong><span>' + (row.isBaseline ? '首轮末次请求 · 已有上下文' : 'tokens · 净变化') + '</span></div>';
    if (row.isBaseline) html += '<p class="review-context-change-note">首次请求已经带着约 ' + reviewTokens(CONTEXT_CATEGORIES.reduce((n, c) => n + (first[c.key] || 0), 0)) + ' tokens，并不是空白。下面同时列出首次请求与本轮末次请求的构成。</p>';
    if (!row.isBaseline && (row.increase || row.decrease)) html += '<div class="review-context-totals">' +
      (row.increase ? '<span>增加 <b>' + reviewSigned(row.increase) + '</b></span>' : '') +
      (row.decrease ? '<span>减少 <b>' + reviewSigned(-row.decrease) + '</b></span>' : '') + '</div>';
    html += '<div class="review-context-breakdown">';
    const changedCategories = CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after !== 0 : row.parts[c.key].delta !== 0);
    if (!changedCategories.length) html += '<p class="review-quiet">本轮各来源没有净变化。</p>';
    for (const c of changedCategories) {
      const p = row.parts[c.key], shareBase = p.delta >= 0 ? row.increase : row.decrease;
      const share = shareBase ? Math.abs(p.delta) / shareBase * 100 : 0;
      html += '<div class="review-context-category"><div><i style="background:' + c.color + '"></i><span>' + c.label + '</span><b>' + (row.isBaseline ? '≈' + reviewTokens(p.after) : reviewSigned(p.delta)) + '</b></div>';
      const amount = row.isBaseline ? p.after : Math.abs(p.delta);
      if (amount) html += '<div class="review-context-meter"><i style="width:' + amount / max * 100 + '%;background:' + c.color + ';opacity:' + (p.delta >= 0 ? .9 : .6) + '"></i></div>';
      html += '<small>' + (row.isBaseline ? '开始时 ≈' + reviewTokens(first[c.key] || 0) + ' → 末次请求 ≈' + reviewTokens(p.after) : '≈' + reviewTokens(p.before) + ' → ≈' + reviewTokens(p.after) + (p.delta ? ' · 占本轮' + (p.delta > 0 ? '增加 ' : '减少 ') + share.toFixed(1) + '%' : ' · 未变')) + '</small></div>';
    }
    html += '</div>';
    const boundaries = row.baselineSeq === null ? [] : (reviewContextData.boundaries || []).filter(e => e.seq > row.baselineSeq && e.seq <= row.seq);
    const prunes = boundaries.filter(e => e.kind === 'prune'), compactions = boundaries.filter(e => e.kind === 'compaction');
    if (compactions.length) html += '<p class="review-context-change-note">' + compactions.length + ' 次压缩：把较早的对话整理成摘要，黄色剪刀线标出实际发生的位置。</p>';
    if (prunes.length) {
      const names = [...new Set(prunes.flatMap(e => e.tools || []))];
      html += '<p class="review-context-change-note">' + prunes.length + ' 条过长的工具返回被裁短：保留开头和结尾，省去中间内容。' + (names.length ? '涉及 ' + names.map(esc).join('、') + '。' : '') + '按日志明确指定的被替换返回记录对应，计在裁短实际发生的这一轮；不挂在报错分叉上，也不会删除行动路径或原会话日志。</p>';
      html += '<details class="ov-proof"><summary>裁短了哪些工具返回</summary>' + prunes.flatMap(e => (e.replaced || []).map(r =>
        '<div class="source-row"><span>' + esc(r.tool || '工具') + (r.turn ? ' · 原第 ' + r.turn + ' 轮 / 第 ' + r.step + ' 步' : '') + '</span>原返回 seq ' + r.seq + ' → 裁短记录 seq ' + e.seq + '</div>')).join('') + '</details>';
    }
    if (contextBarAmounts(row).increase > reviewContextScale.limit || row.decrease > reviewContextScale.limit) html += '<p class="review-quiet">图的柱高显示到 ' + reviewTokens(reviewContextScale.limit) + ' tokens，超过时用省略号收起柱高。这是显示范围，不是模型容量限制。这里显示完整数值。</p>';
    html += '<p class="review-quiet">' + (row.isBaseline ? '首轮显示已有量，作为下一轮的比较基线；不能把它称作相对上一轮的增量。' : '比较第 ' + row.baselineTurn + ' 轮与第 ' + row.turn + ' 轮的末次请求，反映每类内容的净变化。') + '这些不是累计花费，也不包括末次请求之后才产生的回复。</p>';
    html += '<button class="back-link" id="review-context-sources">“补充内容”等来源分别是什么？</button>';
    html += '<div class="drawer-actions"><button class="action-button primary" id="review-context-path">查看本轮行动路径 ↗</button><button class="action-button" id="review-context-focus">在全景中放大本轮</button></div>';
    openDrawer('第 ' + turnNumber + ' 轮 · 上下文变化', row.steps + ' 次请求 · 各来源均为估算', html);
    $('review-context-path').onclick = () => reviewEnterPath(turnNumber);
    $('review-context-focus').onclick = () => reviewFocusTurn(turnNumber);
    $('review-context-sources').onclick = () => reviewOpenContextSources();
  }
  function reviewContextBind() {
    let key = $('review-overlay-key');
    if (view === 'overview') {
      if (!key) {
        key = document.createElement('div'); key.id = 'review-overlay-key'; key.className = 'review-overlay-key';
        key.innerHTML = '<span class="review-overlay-caption">上下文 <b>首轮已有量 · 之后↑增 ↓减</b></span>' + CONTEXT_CATEGORIES.map(c => '<button class="review-overlay-source" data-context-category="' + c.key + '"><i style="background:' + c.color + '"></i>' + c.label + '</button>').join('') +
          '<button id="review-context-readout" class="review-overlay-pick"></button><button id="review-context-scale-note" class="review-overlay-scale">柱高至 ±' + reviewTokens(reviewContextScale.limit) + ' · …收起更大量</button>';
        $('graph-caption').append(key);
      }
      key.setAttribute('aria-hidden', String(!overviewLayers.has('context')));
      $('review-context-readout').textContent = reviewContextNote(reviewContextMap.get(reviewContextSelected)) + ' ↗';
      $('review-context-readout').onclick = () => reviewOpenContext(reviewContextSelected);
      $('review-context-scale-note').onclick = reviewOpenScaleNote;
    } else key?.remove();
    $('graph').querySelectorAll('[data-context-turn]').forEach(el => {
      const number = Number(el.dataset.contextTurn), row = reviewContextMap.get(number);
      el.onmouseenter = () => {
        reviewContextSelected = number;
        if ($('review-context-readout')) $('review-context-readout').textContent = reviewContextNote(row);
        tlReadout(row && !row.isBaseline ? '第 ' + number + ' 轮：增加 ' + reviewTokens(row.increase) + '，减少 ' + reviewTokens(row.decrease) + '，净变化 ' + reviewSigned(row.net) + ' tokens。点击看来源。' : reviewContextNote(row));
      };
      el.onclick = e => { e.stopPropagation(); reviewOpenContext(number); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reviewOpenContext(number); } };
    });
    $('graph').querySelectorAll('[data-review-duration-range]').forEach(el => {
      const [first, last] = el.dataset.reviewDurationRange.split(':').map(Number);
      const open = () => reviewOpenDurations(first, last);
      el.onmouseenter = () => tlReadout(first === last ? '第 ' + first + ' 轮：点击定位本轮，或查看上下文与行动。' : '第 ' + first + '–' + last + ' 轮：点击展开每一轮的耗时，短轮次也在其中。');
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    $('graph').querySelectorAll('[data-context-compaction]').forEach(el => {
      const seqs = el.dataset.contextCompaction.split(',').map(Number);
      el.onclick = e => { e.stopPropagation(); reviewOpenCompaction(seqs); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reviewOpenCompaction(seqs); } };
      el.onmouseenter = () => tlReadout('剪刀与黄色虚线：较早的对话在这里被整理成摘要。点击看详情。');
    });
    $('canvas').querySelectorAll('[data-context-category]').forEach(el => {
      el.onclick = () => reviewOpenContextSources(el.dataset.contextCategory);
      el.onmouseenter = () => $('graph').querySelectorAll('[data-context-segment]').forEach(segment => { segment.style.opacity = segment.dataset.contextSegment === el.dataset.contextCategory ? '.8' : '.08'; });
      el.onmouseleave = () => $('graph').querySelectorAll('[data-context-segment]').forEach(segment => { segment.style.opacity = ''; });
    });
    $('graph-caption').querySelectorAll('.br-key-item').forEach(el => {
      const label = el.textContent.trim();
      el.dataset.tone = Object.entries({ '中断': 'stop', '压缩上下文': 'compact', '结果还不清楚': 'unknown', '等待已折叠': 'gap' }).find(([name]) => label.includes(name))?.[1] || '';
      if (el.dataset.tone === 'compact') {
        el.style.visibility = overviewLayers.has('context') ? '' : 'hidden';
        el.setAttribute('aria-hidden', String(!overviewLayers.has('context')));
      }
    });
    $('graph-caption').querySelector('[data-br-layer="context"]')?.setAttribute('title', '上下文来源变化，以及压缩与裁短记录；与停顿、再试独立');
  }
