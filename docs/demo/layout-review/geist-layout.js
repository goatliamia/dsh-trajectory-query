  // Spend the available height on the data ranges, not on centering a fixed SVG.
  let geistOverviewFrame;
  function geistOverviewGeometry() {
    geistRenderContextOverview();
    const canvas = $('canvas'), header = $('geist-context-overview'), caption = $('graph-caption');
    const controlsHeight = Math.max(48, caption.getBoundingClientRect().height);
    const actorReserve = typeof geistActorReserve === 'function' ? geistActorReserve() : 0;
    const available = canvas.clientHeight - header.getBoundingClientRect().height - controlsHeight - actorReserve - 12;
    const context = overviewLayers.has('context');
    // 页面的实际高度是对话区给的:先跟着可用高度走,不为了满高而把底部挤出视口。
    const height = Math.round(Math.max(240, Math.min(context ? 620 : 410, available)));
    const pixels = context ? Math.max(40, Math.min(actorReserve ? 84 : 108, (height - 204) / 2)) : 108;
    reviewContextScale.pixels = pixels;
    return { height, base: context ? 124 + pixels : 208 };
  }
  let geistLayoutObserver, geistLayoutFrame = 0, geistLayoutMeasure = '';
  function geistBindLayout() {
    if (geistLayoutObserver) return;
    geistLayoutObserver = new ResizeObserver(() => {
      cancelAnimationFrame(geistLayoutFrame);
      geistLayoutFrame = requestAnimationFrame(() => {
        if (view !== 'overview') return;
        const signature = [$('canvas').clientWidth, $('canvas').clientHeight, $('geist-context-overview').getBoundingClientRect().height, $('graph-caption').getBoundingClientRect().height].map(n => Math.round(n)).join(':');
        if (signature === geistLayoutMeasure) return;
        geistLayoutMeasure = signature;
        const geometry = geistOverviewGeometry();
        if (Math.abs((overviewProjection?.mainY || 0) - geometry.base) > 1) renderOverview({ plotOnly: true });
      });
    });
    for (const el of [$('canvas'), $('geist-context-overview'), $('graph-caption')]) if (el) geistLayoutObserver.observe(el);
  }
