  // Selection belongs to an explicit control, never to canvas pointer gestures.
  const geistFileStatusBase = reviewFileStatus;
  reviewFileStatus = function() {
    geistFileStatusBase();
    const status = $('review-file-status');
    if (!status) return;
    status.classList.add('geist-file-selection-bar');
    status.setAttribute('aria-label', '当前文件选择');
    status.classList.toggle('is-selected', Boolean($('review-file-clear')));
    geistPlaceFileStatus();
  };
  function geistPlaceFileStatus() {
    const status = $('review-file-status'), caption = $('graph-caption'), row = caption?.querySelector('.geist-observe-row');
    if (!status || !row) return;
    const selected = status.classList.contains('is-selected');
    if (selected) row.after(status);
    else row.insertBefore(status, $('geist-legend-toggle'));
    const fileButton = $('review-file-all');
    if (fileButton) fileButton.title = '查看文件记录 · 上方读取，下方写入/修改';
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || !reviewFileSelection || geistCanvasGesture) return;
    if ($('review-detail-overlay') || $('canvas').classList.contains('drawer-open')) return;
    if (e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
    e.preventDefault();
    reviewClearFileSelection();
  }, true);
