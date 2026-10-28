  // A single inspector: action and observed result first, evidence on demand.
  reviewRenderStepSummary = function(t, step) {
    const panel = $('step-panel');
    const identity = [session.id, t.number, step.number, overviewLayers.has('duration'), overviewLayers.has('context'), 'inspector'].join(':');
    if (panel.dataset.detailKey === identity) return;
    panel.dataset.detailKey = identity;
    const info = reviewStepContext(t, step), insight = stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts);
    const index = t.steps.indexOf(step);
    panel.className = 'step-panel on geist-step'; panel.style.display = '';
    panel.setAttribute('aria-label', '所选步骤详情');
    const render = fact => {
      const lines = value => value ? String(value).split(/\r?\n/).length : 0;
      const size = fact.preview && !fact.preview.partial
        ? (fact.preview.before ? '替换片段 ' + lines(fact.preview.before) + ' → ' + lines(fact.preview.after) + ' 行' : '写入内容 ' + lines(fact.preview.after) + ' 行') : '';
      return '<article class="geist-operation" data-tone="' + fact.tone + '"><div class="geist-operation-copy"><h3>' + esc(fact.title) + '</h3>' +
        '<p>' + esc(fact.outcome) + '</p>' + (size ? '<span class="geist-operation-size">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? '原计划 · ' : '') + size + '</span>' : '') + '</div>' +
        (fact.preview ? '<button class="geist-diff-action" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? '查看原计划' : '查看差异') + ' <span aria-hidden="true">↗</span></button>' : '') + '</article>';
    };
    panel.innerHTML = '<header class="geist-step-meta"><span><b>第 ' + step.number + ' 步</b>' +
      (overviewLayers.has('duration') ? '<span>' + preciseTime(step.end - step.start) + '</span>' : '') +
      (insight.calls.length > 1 ? '<span>' + insight.calls.length + ' 项操作</span>' : '') + '</span>' +
      '<nav class="geist-step-navigation" aria-label="逐步浏览"><button data-inspector-nav="-1" aria-label="上一步"' + (index === 0 ? ' disabled' : '') + '>←</button><button data-inspector-nav="1" aria-label="下一步" title="' + esc(insight.following ? '下一步 · ' + insight.following.text : '已到本轮末步') + '"' + (index === t.steps.length - 1 ? ' disabled' : '') + '>→</button></nav></header>' +
      '<div class="geist-operations">' + (insight.calls.length ? insight.calls.map(render).join('') :
        '<article class="geist-operation"><div class="geist-operation-copy"><h3>回复</h3><p>' + esc(insight.reply || '没有记录到本步的文字回复。') + '</p></div></article>') + '</div>' +
      (insight.links.length ? '<div class="geist-step-recovery">' + insight.links.map(link => '<button class="geist-text-action recovery" data-insight-step="' + link.step + '">' + esc(link.text) + ' ↗</button>').join('') + '</div>' : '') +
      '<footer class="geist-step-evidence"><button class="geist-text-action quiet" id="review-panel-details">输入与依据 ↗</button><button class="geist-text-action quiet" id="panel-record">原始记录 ↗</button></footer>';
    $('panel-record').onclick = () => showStep(index);
    $('review-panel-details').onclick = () => reviewOpenStepDetail(t, step, insight, info);
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
    panel.querySelectorAll('[data-inspector-nav]').forEach(el => el.onclick = () => {
      const direction = Number(el.dataset.inspectorNav), next = t.steps[index + direction];
      if (!next) return;
      reviewJumpToStep(t, next.number);
      panel.querySelector('[data-inspector-nav="' + direction + '"]:not(:disabled)')?.focus({ preventScroll: true });
    });
  };
