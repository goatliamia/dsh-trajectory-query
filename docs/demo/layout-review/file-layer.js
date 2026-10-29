  let reviewFileOperations = data.context?.fileOperations || [];
  let reviewFileSelection = null, reviewFileGroups = [], reviewFilesInScope = [], reviewFilePoints = [], reviewFileTouchGroups = [];
  let reviewFilePositions = new Map(), reviewFileGeometry = null;
  let reviewActionFileFrame = null, reviewFilesFramePending = false;
  function reviewRefreshActionFiles() {
    if (reviewFilesFramePending) return;
    reviewFilesFramePending = true;
    requestAnimationFrame(() => {
      reviewFilesFramePending = false;
      if (view !== 'path' || !reviewActionFileFrame || !$('review-files-layer')) return;
      const { t, x, base, gutter, height } = reviewActionFileFrame, vp = $('graph-scroll');
      $('review-files-layer').innerHTML = reviewActionFiles(t, x, base, vp.scrollLeft + gutter, vp.scrollLeft + vp.clientWidth - gutter, height);
      reviewFilesBind();
    });
  }
  function reviewFileLabel(members) {
    if (typeof geistSkillMaterialLabel === 'function') { const label = geistSkillMaterialLabel(members); if (label) return label; }
    if (members.length === 1) {
      // 单独显示一个文件时,先给它的身份:读 / 改 / 受阻,再给次数。
      const f = members[0].file;
      const kind = f.changes.length ? '改' : f.reads.length ? '读' : f.failed.length ? '受阻' : '待确认';
      const count = f.changes.length || f.reads.length || f.failed.length;
      return '[' + kind + '] ' + f.label + (count ? ' · ' + count : '');
    }
    const first = [...members].sort((a, b) => b.file.operations.length - a.file.operations.length)[0].file;
    return first.label.split('/').at(-1) + ' 等 ' + members.length + ' 个';
  }
  function reviewFileIcon(x, y) {
    return '<path d="M' + x + ' ' + (y - 5) + 'h5l3 3v8h-8zM' + (x + 5) + ' ' + (y - 5) + 'v3h3" class="review-file-icon"/>';
  }
  function reviewTrimFileLabel(text, width) {
    let label = text, removed = 0;
    while (label.length > 1 && reviewMeasure(label) > width - 30) {
      removed++;
      const keep = Math.max(1, text.length - removed), before = Math.ceil(keep / 2), after = Math.floor(keep / 2);
      label = text.slice(0, before) + '…' + (after ? text.slice(-after) : '');
      if (removed >= text.length) return '…';
    }
    return label;
  }
  function reviewFileLayer(scope, point, base, left, right, height, obstacles = { read: [], change: [] }, lowerY = height - 44, bounds = { left, right }) {
    reviewFileGroups = []; reviewFilePoints = []; reviewFilePositions = new Map();
    reviewFileGeometry = { base, left, right, height };
    reviewFilesInScope = fileObjects(reviewFileOperations, scope);
    const materialFiles = typeof geistSkillMaterials === 'function' ? geistSkillMaterials(reviewFilesInScope, scope) : reviewFilesInScope;
    if (!overviewLayers.has('files') && !materialFiles.some(f => f.skillId)) return '';
    const items = materialFiles.filter(file => overviewLayers.has('files') || file.skillId).map(file => {
      const coordinates = file.operations.map(o => ({ operation: o, x: point(o) })).filter(p => Number.isFinite(p.x));
      coordinates.forEach(p => { reviewFilePositions.set(p.operation.seq, p.x); reviewFilePoints.push({ ...p, file }); });
      const a = Math.min(...coordinates.map(p => p.x)), b = Math.max(...coordinates.map(p => p.x));
      return { file, x: (a + b) / 2, start: a, end: b };
    }).filter(item => Number.isFinite(item.x));
    let html = '<g class="review-file-object-layer">';
    for (const lane of ['read', 'change']) {
      const y = lane === 'read' ? 84 : lowerY;
      const packed = packFileObjects(items.filter(item => item.file.lane === lane), {
        left: bounds.left + 4, right: bounds.right - 4, measure: reviewMeasure, label: reviewFileLabel,
        obstacles: obstacles[lane] || [],
      });
      if (packed.some(p => !p.hidden)) html += brText(bounds.left - 9, y + 4, lane === 'read' ? '材料' : '修改', 'review-file-lane-label ' + lane, 'end');
      for (const p of packed) {
        if (p.hidden || p.right < left - 60 || p.left > right + 60) continue;
        const index = reviewFileGroups.length; reviewFileGroups.push({ ...p, y, lane });
        const selected = p.members.some(m => m.file.id === reviewFileSelection);
        const label = reviewTrimFileLabel(p.label, p.width);
        html += brGroup('class="review-file-object ' + lane + (selected ? ' selected' : '') + '" data-file-group="' + index + '" aria-pressed="' + selected + '"',
          '<rect x="' + p.left + '" y="' + (y - 10) + '" width="' + p.width + '" height="20" rx="4" class="review-file-body"/>' +
          reviewFileIcon(p.left + 8, y) + brText(p.left + 23, y + 3.5, label, 'review-file-name', 'start'),
          p.members.length === 1 ? p.members[0].file.path + '；点击突出它的读写位置' : p.members.length + ' 个文件集中在这里；点击选择文件');
      }
    }
    html += '<g id="review-file-touch-layer">' + reviewFileTouchMarkup() + '</g></g>';
    return html;
  }
  function reviewOverviewFiles(layout, mapTime, base, left, right, height) {
    const scope = new Set(layout.map(l => l.turn.number));
    const obstacles = overviewLayers.has('context') ? (reviewContextData.boundaries || []).filter(e => e.kind === 'compaction').map(e => ({ left: mapTime(e.time) - 15, right: mapTime(e.time) + 15 })) : [];
    return reviewFileLayer(scope, o => mapTime(o.time), base, left, right, height, { read: obstacles }, height - 44, { left: layout[0]?.x ?? 54, right: layout.at(-1)?.end ?? right });
  }
  function reviewActionFiles(t, x, base, left, right, height) {
    const indices = new Map(t.steps.map((s, i) => [s.number, i]));
    const lower = [];
    if (overviewLayers.has('context')) for (const [index, step] of t.steps.entries()) {
      const info = reviewStepContext(t, step), amount = info ? Object.values(info.parts).reduce((sum, value) => sum + Math.max(0, -value), 0) : 0;
      if (amount) lower.push({ left: x(index) - 40, right: x(index) + 40 });
    }
    const halfGap = t.steps.length > 1 ? (x(1) - x(0)) / 2 : 56;
    return reviewFileLayer(new Set([t.number]), o => indices.has(o.step) ? x(indices.get(o.step)) : NaN, base, left, right, height, { change: lower }, base + 78, { left: x(0) - halfGap, right: x(t.steps.length - 1) + halfGap });
  }
  function reviewFileTouchMarkup() {
    reviewFileTouchGroups = [];
    if (!overviewLayers.has('files') || !reviewFileSelection || !reviewFileGeometry) return '';
    const { base, left, right } = reviewFileGeometry;
    const groups = fileTouchClusters(reviewFilePoints.filter(p => p.file.id === reviewFileSelection));
    let html = '';
    for (const p of groups.filter(p => p.x >= left - 10 && p.x <= right + 10)) {
      const index = reviewFileTouchGroups.length; reviewFileTouchGroups.push(p);
      const read = p.kind === 'read', y = base + (read ? -18 : 18), tone = p.members.some(m => m.operation.status === 'error') ? 'failed' : read ? 'read' : 'change';
      const body = '<path d="M' + p.x + ' ' + (base + (read ? -4 : 4)) + 'V' + y + '" class="review-file-tick"/>' +
        (read ? '<circle cx="' + p.x + '" cy="' + y + '" r="3.5" class="review-file-touch-dot"/>' : '<rect x="' + (p.x - 3.5) + '" y="' + (y - 3.5) + '" width="7" height="7" rx="1.5" class="review-file-touch-dot"/>');
      const first = p.members[0].operation;
      html += brGroup('class="review-file-touch ' + tone + '" data-file-touch="' + index + '"', body + (p.members.length > 1 ? '<circle cx="' + p.x + '" cy="' + y + '" r="6" class="review-file-touch-ring"/>' : ''),
        p.members.length > 1 ? p.members.length + ' 次相邻' + (read ? '读取' : '写入/修改') + '；点击展开' : '第 ' + first.turn + ' 轮 / 第 ' + first.step + ' 步 · ' + (read ? '读取' : '写入/修改') + (first.status === 'returned' ? '已返回' : '未成功或未确认'));
    }
    return html;
  }
  function reviewSelectFile(id) {
    reviewFileSelection = id;
    if (reviewOverviewBookmark) reviewOverviewBookmark.file = id;
    reviewApplyFileFocus();
    reviewFileStatus();
  }
  function reviewClearFileSelection() {
    reviewSelectFile(null);
    $('graph-scroll').focus({ preventScroll: true });
  }
  function reviewApplyFileFocus() {
    const enabled = overviewLayers.has('files');
    $('canvas').classList.toggle('review-files-on', enabled);
    const selected = enabled && reviewFilesInScope.some(f => f.id === reviewFileSelection) ? reviewFileOperations.filter(o => fileIdentity(o.path) === reviewFileSelection) : [];
    $('canvas').classList.toggle('review-file-focused', selected.length > 0);
    const steps = new Set(selected.map(o => o.turn + ':' + o.step)), seqs = new Set(selected.map(o => o.seq));
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      const chosen = group.members.some(m => m.file.id === reviewFileSelection);
      const related = view === 'path' && group.members.some(m => m.file.operations.some(o => o.step === turn().steps[selectedStep]?.number));
      el.classList.toggle('selected', chosen); el.classList.toggle('step-related', related);
      el.setAttribute('aria-pressed', String(chosen));
      const selectedFile = group.members.find(m => m.file.id === reviewFileSelection)?.file;
      el.querySelector('.review-file-name').textContent = reviewTrimFileLabel(selectedFile ? '✓ ' + selectedFile.label : group.label, group.width);
      el.querySelector('title').textContent = selectedFile ? '已选：' + selectedFile.path + (group.members.length > 1 ? '；本组共 ' + group.members.length + ' 个文件，点击可换选' : '；点击查看读写位置') :
        group.members.length === 1 ? group.members[0].file.path + '；点击突出它的读写位置' : group.members.length + ' 个文件集中在这里；点击选择文件';
    });
    $('graph').querySelectorAll('.review-action-step').forEach(el => el.classList.toggle('file-related', steps.has(turn().number + ':' + turn().steps[Number(el.dataset.step)]?.number)));
    $('graph').querySelectorAll('[data-review-branch]').forEach(el => {
      const group = reviewBranchesNow[Number(el.dataset.reviewBranch)];
      el.classList.toggle('file-related', group.members.some(m => [...m.e.failureSeqs, ...m.e.readSeqs, ...m.e.pairs.map(p => p.successSeq)].some(seq => seqs.has(seq))));
    });
    const layer = $('review-file-touch-layer');
    if (layer) layer.innerHTML = reviewFileTouchMarkup();
    reviewBindFileTouches();
  }
  function reviewBindFileTouches() {
    $('graph').querySelectorAll('[data-file-touch]').forEach(el => {
      const open = () => {
        const cluster = reviewFileTouchGroups[Number(el.dataset.fileTouch)];
        if (cluster.members.length > 1) {
          const file = reviewFilesInScope.find(f => f.id === reviewFileSelection);
          reviewOpenFileHistory(file, cluster.members.map(p => p.operation)); return;
        }
        const op = cluster.members[0].operation;
        if (view === 'path' && turn().number === op.turn) reviewJumpToStep(turn(), op.step);
        else reviewEnterPath(op.turn, op.step);
      };
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }
  function reviewFilesBind() {
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      const open = () => {
        if (group.members.length > 1) { reviewOpenFilePicker(group.members.map(m => m.file)); return; }
        const file = group.members[0].file; reviewSelectFile(file.id); reviewOpenFileHistory(file);
      };
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    reviewApplyFileFocus(); reviewFileStatus();
    if (typeof geistBindSkillMaterials === 'function') geistBindSkillMaterials();
  }
  function reviewFileStatus() {
    let status = $('review-file-status');
    if (!status) { status = document.createElement('div'); status.id = 'review-file-status'; status.className = 'review-file-status'; $('graph-caption').append(status); }
    status.setAttribute('aria-hidden', String(!overviewLayers.has('files')));
    const selected = reviewFilesInScope.find(f => f.id === reviewFileSelection);
    const key = [view, reviewFileSelection, ...reviewFilesInScope.map(f => f.id + ':' + f.operations.length)].join('|');
    if (status.dataset.key === key) return;
    status.dataset.key = key;
    status.innerHTML = selected
      ? '<strong title="' + esc(selected.path) + '">' + esc(selected.label) + '</strong><span>' + (view === 'path' ? '本轮 · ' : '全程 · ') + '读 ' + selected.reads.length + ' 次 · 写入/修改 ' + selected.changes.length + ' 次' + (selected.failed.length ? ' · ' + selected.failed.length + ' 次受阻' : '') + '</span><button id="review-file-history">全程记录 ↗</button><button id="review-file-clear" aria-label="取消文件选择" title="取消选择（Esc）">× 取消选择</button>'
      : '<span>上方读取 · 下方写入/修改</span><button id="review-file-all">' + (view === 'overview' ? '全程 ' : '本轮 ') + reviewFilesInScope.length + ' 个文件 ↗</button><span class="review-file-source-note">按已记录的操作</span>';
    if ($('review-file-all')) $('review-file-all').onclick = () => reviewOpenFilePicker(reviewFilesInScope);
    if ($('review-file-clear')) $('review-file-clear').onclick = reviewClearFileSelection;
    if ($('review-file-history')) $('review-file-history').onclick = () => reviewOpenFileHistory(selected);
  }
  function reviewOpenFilePicker(files) {
    reviewOpenDetail({ title: '这段执行涉及的文件', subtitle: '选择文件，查看它在整段会话中的修改过程',
      html: '<div class="review-file-list">' + (files.length ? files.map((f, i) => '<button data-pick-file="' + i + '"><strong>' + esc(f.label) + '</strong><span>读取 ' + f.reads.length + ' 次 · 写入/修改 ' + f.changes.length + ' 次' + (f.failed.length ? ' · 受阻 ' + f.failed.length + ' 次' : '') + '</span><small>' + esc(f.path) + '</small></button>').join('') : '<p class="review-file-evidence-note">这段执行没有记录直接的文件读写操作。</p>') + '</div>',
      bind: () => $('review-detail-body').querySelectorAll('[data-pick-file]').forEach(el => el.onclick = () => { const file = files[Number(el.dataset.pickFile)]; reviewCloseDetail(); reviewSelectFile(file.id); reviewOpenFileHistory(file); }) });
  }
  function reviewOpenFileHistory(file, operations = file.operations) {
    reviewOpenDetail({ title: file.label, subtitle: '形成过程 · ' + operations.length + ' 条读写记录',
      html: '<div class="review-file-history">' + operations.map(op => '<button data-file-step="' + op.seq + '"><span class="' + op.kind + '">' + (op.kind === 'read' ? '读取' : '写入/修改') + '</span><div><strong>第 ' + op.turn + ' 轮 · 第 ' + op.step + ' 步</strong><small>' + esc(reviewContextData.callFacts?.[op.seq]?.outcome || (op.status === 'returned' ? '工具已返回' : op.status === 'error' ? '操作受阻' : '结果未记录')) + '</small></div><span>查看这一步 ↗</span></button>').join('') + '</div>' +
        '<p class="review-file-evidence-note">按文件工具的操作记录展示；本预览尚未接入最终文件差异。</p>',
      bind: () => $('review-detail-body').querySelectorAll('[data-file-step]').forEach(el => el.onclick = () => {
        const op = file.operations.find(o => o.seq === Number(el.dataset.fileStep));
        reviewCloseDetail();
        if (view === 'path' && turn().number === op.turn) reviewJumpToStep(turn(), op.step);
        else reviewEnterPath(op.turn, op.step);
      }) });
  }
  function reviewMarkBranchFiles(events) {
    if (!overviewLayers.has('files')) return;
    const seqs = new Set(events.flatMap(e => [...e.failureSeqs, ...e.readSeqs, ...e.pairs.map(p => p.successSeq)]));
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      el.classList.toggle('branch-related', group.members.some(m => m.file.operations.some(o => seqs.has(o.seq))));
    });
  }
