  let reviewBranchesNow = [], reviewRetriesNow = [], reviewStress = false;
  let reviewOverviewBookmark = null;
  const reviewRealEpisodes = session.overview.episodes;
  const reviewRetryEvents = data.context?.retries || session.turns.flatMap(t => t.steps.flatMap(s => s.retries.map(r => ({
    ...r, turn: t.number, step: s.number, responded: s.assistantTime !== null && s.assistantTime >= r.time,
  }))));
  let reviewRowIndex = { key: null, rows: new Map() };
  function reviewActiveTime(turnNumber, time) {
    const layout = overviewProjection?.layout || [];
    // 布局可能把若干轮合成一行,也可能还没排到某一轮;找不到就退到最近的前一行,绝不抛异常。
    if (reviewRowIndex.key !== layout) {
      reviewRowIndex = { key: layout, rows: new Map(layout.map(l => [l.turn.number, l])) };
    }
    let row = reviewRowIndex.rows.get(turnNumber);
    if (!row) row = [...layout].reverse().find(l => l.turn.number <= turnNumber) || layout[0];
    if (!row) return 0;
    return row.offset + Math.max(0, Math.min(endOf(row.turn) - row.turn.start, time - row.turn.start));
  }
  function reviewOverviewSummary() {
    const events = session.overview.episodes, recovered = events.filter(e => e.complete).length;
    return events.length + ' 处受阻 · ' + recovered + ' 处后来成功 · ' + (events.length - recovered) + ' 处结果待确认';
  }
  function reviewTargetLabels(paths) {
    const leaves = paths.map(p => p.split(/[\\/]/).at(-1));
    return paths.map((p, i) => leaves.filter(x => x === leaves[i]).length > 1 ? p.split(/[\\/]/).slice(-2).join('/') : leaves[i]);
  }
  function reviewMeasure(text) {
    tlContext.font = '11.5px "Segoe UI", "Microsoft YaHei", sans-serif';
    return tlContext.measureText(String(text)).width;
  }
  function reviewBranchLabel(members) {
    if (members.length > 1) {
      const pending = members.filter(m => !m.e.complete).length;
      return pending ? members.length + ' 处 · ' + pending + ' 待确认' : members.length + ' 处已恢复';
    }
    const e = members[0].e;
    return String(e.turn).padStart(2, '0') + ' · ' + episodeMeaning(e).short;
  }
  function reviewBranches(mapTime, base, visible, left, right, fullWidth) {
    reviewBranchesNow = layoutBranches(session.overview.episodes.map(e => ({ id: e.id, x: mapTime(e.firstError), at: reviewActiveTime(e.turn, e.firstError), e })), {
      left: 20, right: fullWidth - 20, measure: reviewMeasure, labelOf: reviewBranchLabel,
    });
    let html = '', bottom = base + 42;
    reviewBranchesNow.forEach((p, index) => {
      const events = p.members.map(m => m.e), allDone = events.every(e => e.complete), y = base + p.dy, sign = p.dy > 0 ? 1 : -1;
      bottom = Math.max(bottom, y + 25);
      if (!visible(p.left, p.right)) return;
      const same = events.every(e => e.condition === events[0].condition);
      const condition = same ? events[0].condition : '';
      let part = '<rect class="br-hit" x="' + (p.left - 5) + '" y="' + (base + p.top - 3) + '" width="' + (p.right - p.left + 10) + '" height="' + (p.bottom - p.top + 6) + '"/>';
      // This is the installed renderer's original twig, cap and return mark.
      const twig = 'M' + p.x + ' ' + (base + sign * 2) + ' V' + (y - sign * 10) + ' Q' + p.x + ' ' + y + ' ' + (p.x + 10) + ' ' + y + ' H' + (p.x + 14);
      part += '<path d="' + twig + '" class="review-branch-halo"/><path d="' + twig + '" class="br-connector"/>';
      part += brCap(p.x + 18, y, condition);
      part += allDone ? '<path d="M' + (p.x + 25) + ' ' + y + 'h6" class="br-association"/>' + brCheck(p.x + 37, y) : brText(p.x + 33, y + 4, '?', 'br-note');
      part += brText(p.cx, p.dy > 0 ? y + 21 : y - 14, p.label, 'br-label' + (allDone ? '' : ' bad'));
      for (const m of p.members) part += '<path d="M' + m.x + ' ' + (base - 3) + 'v6" stroke="var(--branch-bad)" stroke-opacity=".35" stroke-width="1"/>';
      html += brGroup('class="br-incident" data-review-branch="' + index + '"', part, reviewBranchSentence(events));
    });
    return { html, bottom };
  }
  function reviewBranchSentence(events) {
    if (events.length === 1) { const e = events[0], meaning = episodeMeaning(e); return '第 ' + e.turn + ' 轮：' + meaning.why + meaning.outcome; }
    const done = events.filter(e => e.complete).length;
    return '这里有 ' + events.length + ' 处受阻；' + done + ' 处找到了后续成功。点击逐条查看。';
  }
  function reviewRetries(mapTime, base, visible) {
    const groups = aggregateInScreen(reviewRetryEvents.map(r => ({
      id: r.turn + ':' + r.seq, x: mapTime(r.time), at: reviewActiveTime(r.turn, r.time), entry: r,
    })), 42);
    let html = '';
    for (const members of groups) {
      const a = members[0].x, b = members.at(-1).x, entries = members.map(m => m.entry);
      const index = reviewRetriesNow.length;
      const group = { entries, turns: [...new Set(entries.map(r => r.turn))] };
      reviewRetriesNow.push(group);
      if (!visible(a, b)) continue;
      const meaning = retryMeaning(entries, entries.every(r => r.responded)), y = base + 7;
      // A quiet position mark on the main line, not another branch or repeated icon.
      const mark = '<path d="M' + (a - 3) + ' ' + y + ' H' + (b + 3) + '" class="review-retry-line"/>';
      html += brGroup('class="review-retry" data-review-retry="' + index + '"',
        '<rect x="' + (a - 7) + '" y="' + (base + 3) + '" width="' + (b - a + 14) + '" height="11" fill="transparent"/>' + mark, meaning.why + meaning.outcome);
    }
    return html;
  }
  function reviewActivities(layout, mapTime, base, visible, left, right) {
    if (overviewScale < 2) return '';
    let html = '', previousEnd = -Infinity;
    if (overviewScale < 48) {
      for (const l of layout) {
        const start = Math.max(left, l.x), end = Math.min(right, l.end), label = turnMeaning(l.turn).short;
        const width = reviewMeasure(label), cx = (start + end) / 2;
        if (end - start < width + 22) continue;
        if (reviewBranchesNow.some(p => p.dy > 0 && p.x > cx - width / 2 - 8 && p.x < cx + width / 2 + 8)) continue;
        html += brGroup('class="review-activity" data-review-turn-activity="' + l.turn.number + '"',
          '<rect class="br-hit" x="' + start + '" y="' + (base + 3) + '" width="' + (end - start) + '" height="25"/>' + brText(cx, base + 21, label, 'review-activity-label'),
          '第 ' + l.turn.number + ' 轮 · ' + label);
      }
      return html;
    }
    for (const l of layout) for (const s of l.turn.steps) {
      const a = mapTime(s.start), b = mapTime(s.end);
      if (!visible(a, b)) continue;
      const meaning = stepMeaning(s), label = meaning.short;
      const width = reviewMeasure(label), start = Math.max(a, left), end = Math.min(b, right);
      if (end - start < width + 22 || start < previousEnd + 12) continue;
      const cx = (start + end) / 2;
      if (reviewBranchesNow.some(p => p.dy > 0 && p.x > cx - width / 2 - 8 && p.x < cx + width / 2 + 8)) continue;
      previousEnd = cx + width / 2;
      html += brGroup('class="review-activity" data-review-step="' + l.turn.number + ':' + s.number + '"',
        '<rect class="br-hit" x="' + start + '" y="' + (base + 3) + '" width="' + (end - start) + '" height="25"/>' +
        brText(cx, base + 21, label, 'review-activity-label'),
        label + '。' + meaning.outcome);
    }
    return html;
  }
  function reviewOpenBranch(events) {
    reviewMarkBranchFiles(events);
    if (events.length === 1) {
      const e = events[0], m = episodeMeaning(e), t = brRound(e.turn);
      let html = '<p class="review-explain">' + esc(m.why) + '</p><div class="review-step"><strong>后来怎么样了</strong>' + esc(m.outcome) + '</div>';
      if (e.readConfirmed) html += '<div class="review-step"><strong>中间做了什么</strong>补看了 ' + (e.targets?.length || 0) + ' 个目标文件，然后重新执行了先前的修改。</div>';
      html += '<p class="review-quiet">' + e.failedCount + ' 次操作没成功。' + (e.complete ? '之后原操作全部返回成功；这不等于整项任务已经完成。' : '其他做法是否完成了任务，需要结合后续记录判断。') + '</p>';
      if (e.synthetic) html += '<p class="review-quiet">这是一条用于密集布局的合成记录。</p>';
      else {
        html += '<div class="drawer-actions"><button class="action-button primary" id="review-path-jump">查看本轮行动路径 ↗</button><button class="action-button" id="review-focus">在全景中放大</button></div><button class="back-link" id="review-evidence">查看原始记录</button>';
        html += '<details class="ov-proof"><summary>这条判断依据什么</summary><p class="review-quiet">依据明确的错误结果，以及同一轮中工具与完整参数一致的后续成功。没有把相邻事件直接当作因果。</p><p class="review-targets">失败记录 ' + e.failureSeqs.join(', ') + '</p></details>';
      }
      openDrawer(m.short, '第 ' + e.turn + ' 轮 · ' + e.failedCount + ' 次操作', html);
      if ($('review-evidence')) $('review-evidence').onclick = () => openOverviewEpisode(e.id);
      if ($('review-focus')) $('review-focus').onclick = () => { closeDrawer(); brFocusEpisode(e); };
      if ($('review-path-jump')) $('review-path-jump').onclick = () => reviewEnterPath(e.turn, e.steps?.[0]);
      return;
    }
    let html = '<p class="review-explain">' + esc(reviewBranchSentence(events)) + '</p><button class="action-button primary" id="review-expand-group">放大这段，展开分叉</button><div class="review-list">';
    html += events.map((e, i) => '<button data-review-item="' + i + '">第 ' + e.turn + ' 轮 · ' + esc(episodeMeaning(e).short) + '<small>' + esc(episodeMeaning(e).outcome) + '</small></button>').join('');
    openDrawer(events.length + ' 处受阻', '位置很近，合在一条细分叉上；每条记录仍然保留。', html + '</div>');
    $('drawer-body').querySelectorAll('[data-review-item]').forEach(b => b.onclick = () => reviewOpenBranch([events[Number(b.dataset.reviewItem)]]));
    $('review-expand-group').onclick = () => reviewExpandEvents(events);
  }
  function reviewOpenRetry(group) {
    const m = retryMeaning(group.entries, group.entries.every(r => r.responded));
    const html = '<p class="review-explain">' + esc(m.why) + '</p><div class="review-step"><strong>接下来</strong>' + esc(m.outcome) + '</div><p class="review-quiet">再次尝试前，系统共等了 ' + preciseTime(m.delayMs) + '。这是记录中的等待间隔，不代表整个问题造成的总延迟。</p><details class="ov-proof"><summary>查看记录</summary>' +
      group.entries.map(r => '<div class="source-row"><span>第 ' + r.turn + ' 轮 / 第 ' + r.step + ' 步 · ' + clock(r.time) + ' · seq ' + r.seq + '</span>' + esc(r.failure?.code || '回应未成功') + ' · 等待 ' + preciseTime(r.delayMs || 0) + '</div>').join('') + '</details><div class="review-list">' +
      group.turns.map(number => '<button data-review-retry-path="' + number + '">查看第 ' + number + ' 轮行动路径 ↗</button>').join('') + '</div>';
    openDrawer('自动再试', group.entries.length + ' 次 · ' + group.turns.length + ' 轮', html);
    $('drawer-body').querySelectorAll('[data-review-retry-path]').forEach(b => b.onclick = () => reviewEnterPath(Number(b.dataset.reviewRetryPath)));
  }
  function reviewOpenStep(t, s) {
    const m = stepMeaning(s), index = t.steps.indexOf(s), next = t.steps[index + 1], prior = t.steps[index - 1];
    let html = '<p class="review-explain">' + esc(m.short) + (m.count ? '，发起了 ' + m.count + ' 次操作。' : '。') + '</p>';
    html += '<div class="review-step"><strong>这一步拿到了什么</strong>' + (prior?.calls?.length ? '前一步的 ' + prior.calls.filter(c => c.resultSeq !== null).length + ' 条操作结果已返回；不能据此断言模型采用了它们。' : '这一轮从你的输入继续。') + '</div>';
    html += '<div class="review-step"><strong>结果</strong>' + esc(m.outcome) + '</div>';
    if (m.targets.length) html += '<p class="review-targets">' + reviewTargetLabels(m.targets).map(esc).join('<br>') + '</p>';
    if (next) html += '<div class="review-step"><strong>随后</strong>' + esc(stepMeaning(next).short) + '</div>';
    html += '<p class="review-quiet">这一步经过 ' + preciseTime(s.end - s.start) + '。</p><div class="drawer-actions"><button class="action-button primary" id="review-step-path">查看本轮行动路径 ↗</button><button class="action-button" id="review-step-evidence">查看原始记录</button></div>';
    openDrawer(m.short, '第 ' + t.number + ' 轮', html);
    $('review-step-evidence').onclick = () => tlOpenStep(t, s);
    $('review-step-path').onclick = () => reviewEnterPath(t.number, s.number);
  }
  function reviewRoundReadout(t) {
    const episodes = session.overview.episodes.filter(e => e.turn === t.number);
    const kinds = [...new Set(t.steps.map(s => stepMeaning(s).short))];
    const done = episodes.filter(e => e.complete).length;
    tlReadout('第 ' + t.number + ' 轮：' + kinds.slice(0, 3).join('、') + '。' +
      (episodes.length ? episodes.length + ' 处受阻，其中 ' + done + ' 处找到了后续成功。' : '没有记录到明确的操作错误。') + '点击放大。');
  }
  function reviewOpenTurn(t) {
    const m = turnMeaning(t), episodes = session.overview.episodes.filter(e => e.turn === t.number);
    let html = '<p class="review-explain">' + esc(m.short) + '。</p>';
    if (t.prompts[0]) html += '<div class="review-step"><strong>这一轮你说</strong>' + esc(shorten(t.prompts[0].text, 160)) + '</div>';
    if (m.files.length) html += '<div class="review-step"><strong>修改操作已返回的文件</strong><div class="review-targets">' + reviewTargetLabels(m.files).map(esc).join('<br>') + '</div></div>';
    html += '<div class="review-step"><strong>执行情况</strong>' + (episodes.length ? episodes.length + ' 处受阻，' + episodes.filter(e => e.complete).length + ' 处有对应操作的后续成功。' : '没有记录到明确的操作错误。') + '</div>';
    html += '<p class="review-quiet">这是执行记录能确认的动作；完成任务、满足要求，还需要结合实际产物和检查结果判断。</p><button class="action-button primary" id="review-turn-path">查看本轮行动路径 ↗</button>';
    openDrawer(m.short, '第 ' + t.number + ' 轮', html);
    $('review-turn-path').onclick = () => reviewEnterPath(t.number);
  }
  function reviewBind() {
    const bind = (query, enter, click) => $('graph').querySelectorAll(query).forEach(el => {
      el.onmouseenter = () => enter(el);
      el.onclick = e => { e.stopPropagation(); click(el); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(el); } };
    });
    bind('[data-review-branch]', el => tlReadout(reviewBranchSentence(reviewBranchesNow[Number(el.dataset.reviewBranch)].members.map(m => m.e))),
      el => reviewOpenBranch(reviewBranchesNow[Number(el.dataset.reviewBranch)].members.map(m => m.e)));
    bind('[data-review-retry]', el => { const g = reviewRetriesNow[Number(el.dataset.reviewRetry)], m = retryMeaning(g.entries, g.entries.every(r => r.responded)); tlReadout(m.why + m.outcome); },
      el => reviewOpenRetry(reviewRetriesNow[Number(el.dataset.reviewRetry)]));
    bind('[data-review-step]', el => { const [n, k] = el.dataset.reviewStep.split(':').map(Number), m = stepMeaning(brRound(n).steps.find(s => s.number === k)); tlReadout(m.short + '。' + m.outcome); },
      el => { const [n, k] = el.dataset.reviewStep.split(':').map(Number), t = brRound(n); reviewOpenStep(t, t.steps.find(s => s.number === k)); });
    bind('[data-review-turn-activity]', el => reviewRoundReadout(brRound(Number(el.dataset.reviewTurnActivity))),
      el => reviewOpenTurn(brRound(Number(el.dataset.reviewTurnActivity))));
    $('review-fit').textContent = overviewScale === 1 ? '全览' : Math.round(overviewScale) + '×';
    const allRetries = $('review-all-retries');
    if (allRetries) {
      $('review-retry-total').textContent = '自动再试 ' + reviewRetryEvents.length + ' 次';
      allRetries.onclick = () => reviewOpenRetry({ entries: reviewRetryEvents, turns: [...new Set(reviewRetryEvents.map(r => r.turn))] });
    }
    reviewContextBind();
    reviewFilesBind();
    reviewSyncNavigation();
  }
  function reviewExpandEvents(events) {
    const viewport = $('graph-scroll'), p = overviewProjection;
    const xs = events.map(e => p.mapTime(e.firstError));
    const from = Math.min(...xs), to = Math.max(...xs), middle = (from + to) / 2;
    closeDrawer();
    setOverviewScale(Math.min(1024, Math.max(overviewScale * 2, overviewScale * viewport.clientWidth * .65 / Math.max(1, to - from))), middle - viewport.scrollLeft);
    const q = overviewProjection, start = Math.min(...events.map(e => q.mapTime(e.firstError))), end = Math.max(...events.map(e => q.mapTime(e.firstError)));
    viewport.scrollLeft = Math.max(0, (start + end) / 2 - viewport.clientWidth / 2);
    renderOverview({ plotOnly: true });
  }
  function reviewEnterPath(number, stepNumber) {
    const t = brRound(number);
    if (!t) return;
    selectedStep = Math.max(0, t.steps.findIndex(s => s.number === stepNumber));
    reviewFocusedTurn = number;
    reviewPathEnteredAt = performance.now();
    selectTurn(session.turns.indexOf(t));
    const selected = $('graph').querySelector('[data-step="' + selectedStep + '"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function reviewReturnOverview() {
    view = 'overview'; zoom = null; closeDrawer();
    if (reviewOverviewBookmark) overviewScale = reviewOverviewBookmark.scale;
    if (reviewOverviewBookmark) reviewFileSelection = reviewOverviewBookmark.file ?? null;
    render();
    $('graph-scroll').scrollLeft = reviewOverviewBookmark?.left || 0;
    $('graph-scroll').scrollTop = reviewOverviewBookmark?.top || 0;
    renderOverview({ plotOnly: true });
  }
  function reviewSyncNavigation() {
    const path = view === 'path';
    $('review-return').hidden = !path;
    $('review-overview-controls').hidden = false;
    $('review-in').disabled = path;
    $('review-fit').textContent = path ? '全览' : overviewScale === 1 ? '全览' : Math.round(overviewScale) + '×';
    $('review-out').title = path ? '缩小，返回刚才的总览位置' : '缩小';
    $('review-stress').hidden = path;
    $('review-path').hidden = path;
    if (path) $('review-state').textContent = '第 ' + turn().number + ' 轮 › 逐步行动 · 缩小返回';
    else $('review-state').textContent = reviewStress ? '160 处合成受阻 · 仅测试密集布局' : reviewFocusedTurn && overviewScale > 1 ? '总览 › 第 ' + reviewFocusedTurn + ' 轮 · 继续放大看行动' : session.turns.length + ' 轮 · 放大逐层查看';
    if ($('review-rounds')) $('review-rounds').textContent = overviewLayers.has('duration') ? '每轮耗时' : '定位轮次';
  }
  const reviewSelectTurnBase = selectTurn;
  selectTurn = function(index) {
    if (view === 'overview') reviewOverviewBookmark = { scale: overviewScale, left: $('graph-scroll').scrollLeft, top: $('graph-scroll').scrollTop, file: reviewFileSelection };
    reviewSelectTurnBase(index);
    reviewSyncNavigation();
  };
  function reviewToggleStress() {
    reviewStress = !reviewStress;
    session.overview.episodes = reviewStress ? Array.from({ length: 160 }, (_, i) => {
      const t = session.turns[(i < 90 ? 5 + Math.floor(i / 10) : 18 + i * 13 % (session.turns.length - 19))];
      const time = t.start + (endOf(t) - t.start) * (.4 + i % 10 * .005);
      return { ...reviewRealEpisodes[i % reviewRealEpisodes.length], id: 'synthetic-' + i, turn: t.number, firstError: time, synthetic: true };
    }) : reviewRealEpisodes;
    $('review-stress').setAttribute('aria-pressed', reviewStress);
    $('review-state').textContent = reviewStress ? '160 处合成受阻 · 仅测试密集布局' : session.turns.length + ' 轮真实记录';
    overviewScale = 1; $('graph-scroll').scrollLeft = 0; closeDrawer(); renderOverview();
  }
