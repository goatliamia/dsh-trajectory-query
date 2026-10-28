  let reviewDetailStack = [], reviewDetailOrigin = null;
  function reviewCloseDetail() {
    const overlay = $('review-detail-overlay');
    overlay?.remove(); reviewDetailStack = [];
    if (reviewDetailOrigin?.isConnected) reviewDetailOrigin.focus({ preventScroll: true });
    reviewDetailOrigin = null;
  }
  function reviewOpenDetail(detail, nested = false) {
    let overlay = $('review-detail-overlay');
    if (!overlay) {
      reviewDetailOrigin = document.activeElement;
      overlay = document.createElement('div'); overlay.id = 'review-detail-overlay'; overlay.className = 'review-detail-overlay';
      overlay.innerHTML = '<section class="review-detail-window" role="dialog" aria-modal="true" aria-labelledby="review-detail-title"><header><button id="review-detail-back" aria-label="返回上一层">‹</button><div><h2 id="review-detail-title"></h2><p id="review-detail-subtitle"></p></div><button id="review-detail-close" aria-label="关闭详情">×</button></header><div class="review-detail-body" id="review-detail-body"></div></section>';
      document.body.append(overlay);
      overlay.onclick = e => { if (e.target === overlay) reviewCloseDetail(); };
      $('review-detail-close').onclick = reviewCloseDetail;
      $('review-detail-back').onclick = () => { reviewDetailStack.pop(); reviewPaintDetail(); };
      overlay.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reviewCloseDetail(); }
        if (e.key === 'Tab') {
          const items = [...overlay.querySelectorAll('button:not([disabled]), [tabindex="0"], a[href]')].filter(el => !el.hidden && el.getClientRects().length);
          const first = items[0], last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      };
    }
    if (nested && reviewDetailStack.length) reviewDetailStack.at(-1).scroll = $('review-detail-body').scrollTop;
    reviewDetailStack = nested ? [...reviewDetailStack, detail] : [detail];
    reviewPaintDetail();
  }
  function reviewPaintDetail() {
    const detail = reviewDetailStack.at(-1);
    $('review-detail-title').textContent = detail.title;
    $('review-detail-subtitle').textContent = detail.subtitle || '';
    $('review-detail-back').hidden = reviewDetailStack.length < 2;
    $('review-detail-body').innerHTML = detail.html;
    detail.bind?.();
    $('review-detail-body').scrollTop = detail.scroll || 0;
    $('review-detail-close').focus({ preventScroll: true });
  }
  function reviewOpenChange(t, step, fact, nested = false) {
    const preview = fact.preview;
    if (!preview) return;
    const rows = changedLines(preview.before, preview.after), removed = rows.filter(r => r.kind === 'remove').length, added = rows.filter(r => r.kind === 'add').length;
    const folded = compactDiff(rows), hasFolds = folded.some(row => row.kind === 'fold');
    const planned = fact.tone === 'bad' || fact.tone === 'unknown';
    const detail = {
      title: planned ? '原计划改动' : '改动对比',
      subtitle: (fact.target || fact.title) + ' · 第 ' + t.number + ' 轮 / 第 ' + step.number + ' 步',
      html: '<div class="review-change-status" data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</div>' +
        '<div class="review-diff-toolbar"><span><b class="removed">− ' + removed + ' 行</b><b class="added">+ ' + added + ' 行</b></span>' +
        (hasFolds ? '<button id="review-diff-toggle">显示全部片段</button>' : '<span class="review-diff-complete">' + (preview.partial ? '截取片段' : '完整替换片段') + '</span>') + '</div>' +
        '<p class="review-diff-note">本次替换片段对比，非整文件；“原 / 新”是对应片段中的行号。</p>' +
        (preview.partial ? '<p class="review-change-status">片段过长，当前为截取内容；行数统计仅针对展示部分。</p>' : '') +
        '<div class="review-diff-scroller" tabindex="0" aria-label="改动内容"><div class="review-diff-column-key"><span>原</span><span>新</span><span></span><span>改动片段</span></div><div id="review-diff-lines" class="review-diff-lines"></div></div>',
      bind: () => {
        const render = () => {
          const visible = detail.all ? rows : folded;
          if ($('review-diff-toggle')) $('review-diff-toggle').textContent = detail.all ? '只看改动附近' : '显示全部片段';
          $('review-diff-lines').innerHTML = visible.map(row => row.kind === 'fold'
            ? '<button class="review-diff-fold">展开 ' + row.count + ' 行未改动内容</button>'
            : '<div class="review-diff-row ' + row.kind + '"><span class="review-diff-line-number">' + (row.before ?? '') + '</span><span class="review-diff-line-number">' + (row.after ?? '') + '</span><span class="review-diff-sign">' + (row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '') + '</span><code>' + esc(row.text || ' ') + '</code></div>').join('');
          $('review-diff-lines').querySelectorAll('.review-diff-fold').forEach(el => el.onclick = () => { detail.all = true; render(); });
        };
        if ($('review-diff-toggle')) $('review-diff-toggle').onclick = () => { detail.all = !detail.all; render(); };
        render();
      },
    };
    reviewOpenDetail(detail, nested);
  }
  function reviewOpenStepDetail(t, step, insight, info) {
    const html = '<div class="review-detail-section"><h3>' + insight.input.label + '</h3><p>' + esc(insight.input.text) + '</p></div>' +
      insight.calls.map(fact => '<div class="review-detail-section"><h3>' + esc(fact.title) + '</h3><p data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</p>' +
        (fact.detail ? '<p class="review-detail-muted">' + esc(fact.detail) + '</p>' : '') +
        (fact.preview ? '<button class="review-detail-link" data-detail-change="' + fact.seq + '">' + (fact.tone === 'bad' ? '查看原计划改动' : '查看改动对比') + ' ↗</button>' : '') + '</div>').join('') +
      (insight.reply ? '<div class="review-detail-section"><h3>回复摘录</h3><p>' + esc(insight.reply) + '</p></div>' : '') +
      (insight.links.length ? '<div class="review-detail-section"><h3>后续记录</h3>' + insight.links.map(l => '<button class="review-detail-link" data-detail-step="' + l.step + '">' + esc(l.text) + ' ↗</button>').join('<br>') + '<p class="review-detail-muted">依据同一轮中工具与完整参数一致的失败、成功记录。</p></div>' : '') +
      (insight.following ? '<div class="review-detail-section"><h3>接下来</h3><button class="review-detail-link" data-detail-step="' + insight.following.step + '">第 ' + insight.following.step + ' 步 · ' + esc(insight.following.text) + ' ↗</button></div>' : '') +
      (info ? '<div class="review-detail-section"><h3>本步请求上下文</h3><p>已有 ≈' + reviewTokens(info.total) + ' tokens；' + (info.initial ? '首次载入 ' : '相比上次请求 ') + reviewSigned(info.amount) + '。</p><p class="review-detail-muted">请求发出前的估算构成，不含本次回复。</p></div>' : '') +
      '<button class="review-detail-link" id="review-detail-record">查看调用与返回原文 ↗</button>';
    reviewOpenDetail({ title: '第 ' + step.number + ' 步 · 前后文与依据', subtitle: '第 ' + t.number + ' 轮 · ' + reviewActionStepLabel(step), html,
      bind: () => {
        $('review-detail-body').querySelectorAll('[data-detail-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.detailChange)), true));
        $('review-detail-body').querySelectorAll('[data-detail-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.detailStep)));
        $('review-detail-record').onclick = () => { reviewCloseDetail(); showStep(t.steps.indexOf(step)); };
      } });
  }
