  let reviewFocusedTurn = null, reviewPathEnteredAt = 0;
  function reviewOpenScaleNote() {
    openDrawer('柱高为什么会收起', '这是图的显示范围，不是模型容量限制',
      '<p class="review-explain">按本会话约九成五轮次的新增量选取，图先展示 ±' + reviewTokens(reviewContextScale.limit) + ' 的范围。这样几千 tokens 的变化也能看清。</p>' +
      '<p class="review-explain">例如实际新增 132.7k，柱顶仍写 <b>+132.7k · 收起</b>，省略号表示柱高被收起。颜色仍按真实来源占比分配，点柱可查看全部数值。</p>' +
      '<p class="review-quiet">范围按本会话新增量第 95 百分位向上取整。平移、放大不会改变纵向单位。首轮柱显示末次请求已有量，后续轮次显示相对上一轮的变化。</p>');
  }
  function reviewOpenContextSources(selected = 'inject') {
    const definitions = {
      system: '模型的基础行为规则。单独计入系统提示，不计入下面的补充内容。',
      tools: '本次可调用工具的名称、用途与参数说明。它是工具清单，不是执行工具后得到的结果。',
      user: '用户发来的消息。自动附加的环境说明与通知另计。',
      inject: '运行环境或插件自动补进来的文字，例如工作目录、项目说明、当前时间、后台任务通知，以及压缩后继续对话的说明。这里原来叫“注入内容”。',
      skill: '技能目录、已加载技能的操作说明。它虽然也是自动提供的，但单独归类。',
      assistant: '模型产生的回复、思考和工具调用内容。',
      tool: '工具执行后的返回内容，例如文件正文、命令输出、搜索结果。过长返回被裁短时，这一类可能减少。',
    };
    const sourceNames = {
      'agent-instructions': '项目与工作区说明', 'runtime-context': '运行环境',
      'time-context': '时间信息', 'plugin:out-of-band': '运行中补充通知',
      'tool-jobs': '后台任务通知', 'tool-registry': '工具清单变更说明',
      'agent-message': '其他 Agent 的消息', 'subagent-settled': '子任务结束通知',
      goal: '任务目标', 'compact-checkpoint': '压缩后继续对话的说明', 'user-approval': '审批结果',
      'plugin:dsh-runtime-seam': '运行环境插件补充', 'plugin:dsh-trajectory-tools': '轨迹工具插件补充',
    };
    const ordered = [...CONTEXT_CATEGORIES].sort((a, b) => (b.key === selected) - (a.key === selected));
    let html = ordered.map(c => '<div class="review-source-definition"><strong><i style="background:' + c.color + '"></i>' + c.label + '</strong><p>' + definitions[c.key] + '</p></div>').join('');
    html += '<details class="ov-proof"><summary>这份会话记录了哪些补充来源</summary><p class="review-quiet">以下为写入记录的次数，不是当前仍保留的 tokens。</p>' +
      (reviewContextData.supplementSources || []).map(s => '<div class="source-row"><span>' + esc(sourceNames[s.kind] || s.kind) + '</span>' + s.count + ' 条</div>').join('') + '</details>';
    html += '<p class="review-quiet">按消息的角色与来源标记归类，不根据文字内容猜测。所有 token 构成是估算值。</p>';
    openDrawer('上下文从哪里来', '七类来源，各自只计一次', html);
  }
  function reviewOpenDurations(first = null, last = null) {
    const subset = session.turns.filter(t => first === null || t.number >= first && t.number <= last);
    const title = first === null ? '每轮耗时' : first === last ? '第 ' + first + ' 轮' : '第 ' + first + '–' + last + ' 轮';
    const html = '<form id="review-round-search" class="review-round-search"><label for="review-round-number">定位轮次</label><input id="review-round-number" type="number" min="1" inputmode="numeric" placeholder="例如 59"><button class="action-button" type="submit">定位</button></form>' +
      '<p class="review-quiet">每一轮都列在这里，不按时长筛选。点轮号定位原图，点“行动”直接看逐步操作。</p>' +
      (first !== null ? '<button class="back-link" id="review-all-rounds">查看全部 ' + session.turns.length + ' 轮</button>' : '') +
      '<div class="review-round-grid" id="review-round-grid"></div>';
    openDrawer(title, '从本轮开始到结束 · 含轮内等待，不含轮间等待', html);
    const draw = () => {
      const query = $('review-round-number').value.trim();
      const rounds = query ? session.turns.filter(t => String(t.number) === query) : subset;
      $('review-round-grid').innerHTML = rounds.length ? rounds.map(t => '<div class="review-round-card">' +
        '<button data-review-focus-turn="' + t.number + '" title="' + esc(shorten(t.title || '', 100)) + '"><strong>第 ' + t.number + ' 轮</strong><b>' + (t.end === null ? '≥' : '') + reviewDuration(endOf(t) - t.start) + '</b></button>' +
        '<div><button data-review-round-context="' + t.number + '">上下文</button><button data-review-round-path="' + t.number + '">行动 ↗</button></div></div>').join('') : '<p class="review-quiet">没有这个轮号。</p>';
      $('review-round-grid').querySelectorAll('[data-review-focus-turn]').forEach(el => el.onclick = () => reviewFocusTurn(Number(el.dataset.reviewFocusTurn)));
      $('review-round-grid').querySelectorAll('[data-review-round-context]').forEach(el => el.onclick = () => reviewOpenContext(Number(el.dataset.reviewRoundContext)));
      $('review-round-grid').querySelectorAll('[data-review-round-path]').forEach(el => el.onclick = () => reviewEnterPath(Number(el.dataset.reviewRoundPath)));
    };
    $('review-round-number').oninput = draw;
    $('review-round-search').onsubmit = e => { e.preventDefault(); const number = Number($('review-round-number').value); if (brRound(number)) reviewFocusTurn(number); };
    if ($('review-all-rounds')) $('review-all-rounds').onclick = () => reviewOpenDurations();
    draw();
  }
  function reviewFocusTurn(number) {
    const t = brRound(number);
    if (!t) return;
    reviewFocusedTurn = number;
    turnIndex = session.turns.indexOf(t);
    if (view !== 'overview') { view = 'overview'; zoom = null; render(); }
    closeDrawer();
    tlFocusRange(t, t.start, endOf(t));
    tlSelectionOutline(t);
    reviewSyncNavigation();
    tlReadout('第 ' + number + ' 轮 · 总耗时 ' + reviewDuration(endOf(t) - t.start) + '。继续放大进入逐步行动，或点上方“行动路径”。');
  }
  const reviewSetOverviewScaleBase = setOverviewScale;
  setOverviewScale = function(nextScale, viewportX) {
    if (view !== 'overview') {
      if (nextScale < overviewScale) reviewReturnOverview();
      return;
    }
    const viewport = $('graph-scroll'), previous = { scale: overviewScale, left: viewport.scrollLeft, top: viewport.scrollTop, file: reviewFileSelection };
    const x = viewportX ?? viewport.clientWidth / 2;
    reviewSetOverviewScaleBase(nextScale, viewportX);
    if (nextScale <= previous.scale) return;
    const p = overviewProjection, target = semanticZoomTarget(p.layout, viewport.scrollLeft + x, viewport.clientWidth);
    if (!target) return;
    const t = target.turn, time = t.start + Math.max(0, (viewport.scrollLeft + x - target.x) / p.factor);
    const step = t.steps.find(s => s.end >= time) || t.steps.at(-1);
    reviewEnterPath(t.number, step.number);
    reviewOverviewBookmark = previous;
  };
  function reviewZoomOut() {
    if (view === 'path') reviewReturnOverview();
    else setOverviewScale(overviewScale / 2);
  }
  function reviewFitAll() {
    reviewFocusedTurn = null;
    view = 'overview'; zoom = null; closeDrawer();
    overviewScale = 1; render(); $('graph-scroll').scrollLeft = 0;
    reviewSyncNavigation();
  }
  function reviewBindPathZoom() {
    const viewport = $('graph-scroll');
    viewport.addEventListener('wheel', e => {
      if (view !== 'path' || $('canvas').classList.contains('drawer-open') || e.altKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY > 0 && performance.now() - reviewPathEnteredAt > 450) {
        e.preventDefault(); reviewReturnOverview();
      } else if (e.deltaY < 0) e.preventDefault();
    }, { passive: false });
  }
  function reviewStepContext(t, step) {
    const index = reviewContextStepIndex.get(t.number + ':' + step.number);
    if (index === undefined) return null;
    const current = reviewContextRequests[index], prior = reviewContextRequests[index - 1];
    const total = CONTEXT_CATEGORIES.reduce((sum, c) => sum + (current[c.key] || 0), 0);
    const parts = Object.fromEntries(CONTEXT_CATEGORIES.map(c => [c.key, (current[c.key] || 0) - (prior?.[c.key] || 0)]));
    const amount = Object.values(parts).reduce((sum, value) => sum + value, 0);
    return { current, total, amount, parts, initial: !prior };
  }
  const reviewActionScales = new Map();
  function reviewActionScale(t) {
    if (!reviewActionScales.has(t.number)) reviewActionScales.set(t.number, contextDisplayScale(t.steps.map(s => {
      const info = reviewStepContext(t, s);
      return { increase: Math.max(0, info?.amount || 0), decrease: Math.max(0, -(info?.amount || 0)), isBaseline: info?.initial || false };
    })));
    return reviewActionScales.get(t.number);
  }
  function reviewBindActionControls() {
    if (view !== 'path') return;
    const box = document.createElement('div'); box.className = 'br-layers';
    box.innerHTML = [['duration', '耗时'], ['context', '上下文变化'], ['files', '文件']].map(([key, label]) =>
      '<label class="br-layer"><input type="checkbox" data-action-layer="' + key + '"' + (overviewLayers.has(key) ? ' checked' : '') + '>' + label + '</label>').join('');
    $('graph-caption').prepend(box);
    box.querySelectorAll('input').forEach(el => el.onchange = () => {
      if (el.checked) overviewLayers.add(el.dataset.actionLayer); else overviewLayers.delete(el.dataset.actionLayer);
      renderPath(); reviewSyncNavigation();
    });
  }
