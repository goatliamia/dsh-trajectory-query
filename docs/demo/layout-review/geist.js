  // Visual adaptation only: semantic categories and recorded values remain unchanged.
  for (const category of CONTEXT_CATEGORIES) category.color = 'var(--chart-' + category.key + ')';
  reviewMeasure = function(text) {
    tlContext.font = '12px ' + getComputedStyle(document.body).getPropertyValue('--sans');
    return tlContext.measureText(String(text)).width;
  };
  let geistLegendOpen = false;
  // 开合状态只有一个来源:图例的 hidden 与按钮的 aria-expanded 都从这里同步。
  function geistSyncLegend() {
    const legend = $('geist-legend'), toggle = $('geist-legend-toggle');
    if (!legend) return;
    legend.hidden = !geistLegendOpen;
    if (toggle) toggle.setAttribute('aria-expanded', String(geistLegendOpen));
  }
  function geistArrangeCaption() {
    geistRenderContextOverview();
    geistBindLayout();
    const caption = $('graph-caption');
    if (!caption) return;
    let legend = $('geist-legend');
    if (!legend) {
      const switches = caption.querySelector('.br-layers');
      if (switches) {
        const row = document.createElement('div'); row.className = 'geist-observe-row';
        const label = document.createElement('span'); label.className = 'geist-section-label'; label.textContent = '观察';
        row.append(label, switches); caption.prepend(row);
      }
      legend = document.createElement('div'); legend.id = 'geist-legend'; legend.className = 'geist-legend';
      caption.append(legend);
      const toggle = document.createElement('button'); toggle.id = 'geist-legend-toggle'; toggle.className = 'geist-text-action quiet';
      toggle.textContent = '符号说明'; toggle.setAttribute('aria-controls', legend.id);
      toggle.onclick = () => { geistLegendOpen = !geistLegendOpen; geistSyncLegend(); };
      caption.querySelector('.geist-observe-row')?.append(toggle);
      // Controls belong to the canvas; the inspector follows without another card.
      if (caption.nextElementSibling !== $('step-panel')) $('step-panel').before(caption);
      geistPlaceFileStatus();
    }
    // 每次重绘都会重建图例元素;不重新收进来,它们就留在外面,点"收起"收掉的只是一个空盒子。
    for (const element of [...caption.children]) {
      if (element === legend) continue;
      if (element.matches('.br-key,.review-overlay-key')) legend.append(element);
    }
    caption.querySelector('.br-key')?.classList.add('geist-symbols');
    geistSyncLegend();
  }
  const geistOverviewBase = renderOverview;
  renderOverview = function(...args) { const value = geistOverviewBase(...args); geistArrangeCaption(); return value; };
  const geistActionBase = renderActionPath;
  renderActionPath = function(...args) { const value = geistActionBase(...args); geistArrangeCaption(); return value; };
  // Re-measure labels once the self-hosted font is ready; preserve the viewport.
  document.fonts.ready.then(() => {
    const vp = $('graph-scroll'), left = vp.scrollLeft, top = vp.scrollTop;
    if (view === 'path') renderActionPath(); else renderOverview({ plotOnly: true });
    vp.scrollLeft = left; vp.scrollTop = top;
  });
