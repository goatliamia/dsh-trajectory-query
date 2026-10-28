  let geistCanvasGesture = false;
  function bindOverviewViewport() {
    if (overviewViewportBound) return;
    overviewViewportBound = true;
    const viewport = $('graph-scroll');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', '执行路径画布，可左右拖动或用方向键平移');
    let drag = null, suppressClickUntil = 0, wheelFrame = 0, pendingScale = 1, pendingX = 0;
    const blocked = () => $('canvas').classList.contains('drawer-open') || Boolean($('review-detail-overlay'));
    viewport.addEventListener('wheel', e => {
      if (blocked() || e.altKey || drag?.moved) return;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault(); viewport.scrollLeft += e.deltaX || e.deltaY; return;
      }
      if (view !== 'overview') return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1);
      pendingScale = Math.max(1, Math.min(1024, (wheelFrame ? pendingScale : overviewScale) * Math.exp(-delta * .0018)));
      pendingX = e.clientX - viewport.getBoundingClientRect().left;
      if (!wheelFrame) wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0; if (view === 'overview' && !drag?.moved) setOverviewScale(pendingScale, pendingX);
      });
    }, { passive: false });
    viewport.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !e.isPrimary || blocked() || viewport.scrollWidth <= viewport.clientWidth + 1) return;
      const box = viewport.getBoundingClientRect();
      if (e.clientX >= box.left + viewport.clientWidth || e.clientY >= box.top + viewport.clientHeight) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, moved: false };
      geistCanvasGesture = true;
    });
    window.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        drag.moved = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('geist-dragging');
      }
      if (drag.moved) { e.preventDefault(); viewport.scrollLeft = drag.left - dx; }
    }, { passive: false });
    const end = e => {
      if (!drag || e.pointerId !== undefined && drag.id !== e.pointerId) return;
      const current = drag; drag = null;
      geistCanvasGesture = false;
      if (current.moved) { suppressClickUntil = performance.now() + 250; e.preventDefault(); }
      if (viewport.hasPointerCapture(current.id)) viewport.releasePointerCapture(current.id);
      viewport.classList.remove('geist-dragging');
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    viewport.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', end);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) { e.preventDefault(); end(e); } });
    for (const type of ['click', 'dblclick']) viewport.addEventListener(type, e => {
      if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    viewport.addEventListener('dblclick', e => {
      if (view === 'overview' && !e.target.closest('[data-overview-turn],[data-key-round],[data-overview-child],[data-branch-action]')) {
        e.preventDefault(); setOverviewScale(1);
      }
    });
  }
