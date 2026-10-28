import { layoutAnnotations, routeAnnotations, roundedPath } from './layout.mjs';
const $ = id => document.getElementById(id);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const duration = ms => ms < 1000 ? Math.round(ms) + ' 毫秒' : ms < 60000 ? (ms / 1000).toFixed(1) + ' 秒' : Math.round(ms / 60000) + ' 分钟';
const axisTime = ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
const clock = time => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(time);
const measureContext = document.createElement('canvas').getContext('2d');
const measure = (text, size = 11) => { measureContext.font = size + 'px "Segoe UI", "Microsoft YaHei", sans-serif'; return measureContext.measureText(text).width; };
const text = (x, y, value, cls, anchor = 'start') => '<text x="' + x + '" y="' + y + '" class="' + cls + '" text-anchor="' + anchor + '">' + esc(value) + '</text>';
const retryIcon = (x, y) => '<g transform="translate(' + x + ' ' + y + ')" class="retry-glyph"><path d="M3 -3 A4.1 4.1 0 1 0 4 2 M3 -6 V-2 H-1"/></g>';
let original, current, sample = 'real', zoom = 1, projection, errorLayout, retryLayout, selection = null;
let drag = null, suppressClick = false, wheelFrame = 0, pendingZoom = 1, pendingX = 0;
const viewport = $('viewport');

function denseSample(source) {
  const turns = structuredClone(source.turns), episodes = [], retries = [];
  for (let i = 0; i < 160; i++) {
    const t = turns[(i < 80 ? 5 + Math.floor(i / 10) : 18 + (i * 13) % (turns.length - 19))];
    const fraction = i < 80 ? .45 + (i % 10) * .002 : .2 + (i % 5) * .12;
    const at = t.start + (t.end - t.start) * fraction, complete = i % 5 !== 0;
    episodes.push({
      id: 'synthetic-' + i, turn: t.number, firstError: at, start: at - 100, end: at + 20,
      failedCount: 1 + i % 3, complete, confirmedCount: complete ? 1 + i % 3 : 0,
      unconfirmedCount: complete ? 0 : 1 + i % 3, resolvedAt: complete ? Math.min(t.end, at + 4500) : null,
      condition: ['FS_NOT_OBSERVED', 'TOOL_TIMEOUT', 'TOOL_ERROR:test'][i % 3],
      label: ['修改受阻', '请求超时', '工具报错'][i % 3], reason: '用于检查布局的合成事件', synthetic: true,
      summary: complete ? '原操作随后成功' : '后续结果待确认', steps: [i + 1],
      sequence: [{ kind: 'failure', time: at, label: '合成失败记录', seqs: [] }, { kind: complete ? 'success' : 'unknown', time: Math.min(t.end, at + 4500), label: complete ? '合成后续成功' : '后续结果待确认', seqs: [] }],
    });
  }
  for (let i = 0; i < 48; i++) {
    const t = turns[i < 24 ? 6 + Math.floor(i / 6) : (i * 7) % turns.length];
    retries.push({ id: 'synthetic-retry-' + i, turn: t.number, step: i + 1, time: t.start + (t.end - t.start) * (.25 + i % 6 * .01), delayMs: 1000 + i % 4 * 500, code: 'SAMPLE_RETRY', synthetic: true });
  }
  return { ...source, title: '密集分叉压力样本', turns, episodes, retries, totals: { ...source.totals, errors: episodes.reduce((n, e) => n + e.failedCount, 0) } };
}

function describeErrors(members) {
  const events = members.map(m => m.event), turns = [...new Set(events.map(e => e.turn))].sort((a, b) => a - b);
  const unknown = events.filter(e => !e.complete).length;
  const title = events.length === 1 ? String(events[0].turn).padStart(2, '0') + ' · ' + events[0].label : events.length + ' 处受阻';
  const range = turns.length === 1 ? '第 ' + turns[0] + ' 轮' : '第 ' + turns[0] + '–' + turns.at(-1) + ' 轮';
  const meta = events.length === 1 ? events[0].failedCount + ' 次 · ' + (unknown ? '结果待确认' : '原操作成功') : range + ' · ' + (unknown ? unknown + ' 处待确认' : '均有后续成功');
  return { title, meta, unknown, width: Math.ceil(Math.max(measure(title), measure(meta, 9)) + 37) };
}
function describeRetries(members) { return { count: members.length, width: 33 + measure(String(members.length), 10) }; }

function makeProjection() {
  const width = Math.max(280, viewport.clientWidth), margin = 32, gap = 2;
  const total = current.turns.reduce((n, t) => n + Math.max(0, t.end - t.start), 0);
  const factor = Math.max(60, width - margin * 2 - gap * (current.turns.length - 1)) / Math.max(1, total) * zoom;
  let x = margin, active = 0;
  const turns = current.turns.map(t => {
    const start = x, length = Math.max(0, t.end - t.start);
    x += length * factor + gap;
    const row = { ...t, x: start, right: x - gap, active };
    active += length;
    return row;
  });
  const byTurn = new Map(turns.map(t => [t.number, t]));
  return { width, margin, factor, total, turns, fullWidth: Math.max(width, x - gap + margin),
    xAt: (number, time) => { const t = byTurn.get(number); return t.x + Math.max(0, Math.min(t.end - t.start, time - t.start)) * factor; } };
}
function isSelected(node, type) { return selection?.type === type && node.members.some(m => selection.ids.includes(m.id)); }

function render() {
  projection = makeProjection();
  const p = projection, height = viewport.clientHeight, baseline = 105 + Math.max(0, height - 376) * .2;
  const bounds = { left: p.margin, right: p.fullWidth - p.margin };
  errorLayout = layoutAnnotations(current.episodes.map(e => ({ id: e.id, x: p.xAt(e.turn, e.firstError), event: e })), { ...bounds, rows: 3, minDistance: 9, gap: 14, maxShift: 58, describe: describeErrors });
  retryLayout = layoutAnnotations(current.retries.map(e => ({ id: e.id, x: p.xAt(e.turn, e.time), event: e })), { ...bounds, rows: 1, minDistance: 12, gap: 9, maxShift: 24, describe: describeRetries });
  const routed = routeAnnotations(errorLayout.nodes, { ...bounds, baseline: baseline + 4, firstY: baseline + 35, rowGap: 62, height: 42 });
  const axisY = height - 30;
  let svg = '<title>执行路径</title><desc>时间锚点固定，错误标签最多三层。密集位置以数量显示，选择后可展开全部事件。请求重试使用独立的灰色计数标记。</desc>';
  svg += text(p.margin, 22, '请求重试', 'small') + text(p.margin + 63, 22, current.retries.length + ' 次', 'axis');
  svg += '<path d="M' + p.margin + ' ' + axisY + 'H' + (p.fullWidth - p.margin) + '" class="graph-grid"/>';
  const tickSize = [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000, 1200000].find(v => v * p.factor > 70) || 1200000;
  let lastTick = -Infinity;
  for (const t of p.turns) {
    for (let at = Math.ceil(t.active / tickSize) * tickSize; at <= t.active + t.end - t.start; at += tickSize) {
      const x = t.x + (at - t.active) * p.factor;
      if (x - lastTick < 65) continue;
      lastTick = x;
      svg += '<path d="M' + x + ' ' + axisY + 'v4" class="graph-grid"/>' + text(x, axisY + 18, axisTime(at), 'axis', 'middle');
    }
    svg += '<g data-turn="' + t.number + '" role="button" tabindex="0" aria-label="聚焦第 ' + t.number + ' 轮"><title>第 ' + t.number + ' 轮 · ' + duration(t.end - t.start) + ' · ' + t.calls + ' 次调用</title><rect x="' + t.x + '" y="' + (baseline - 8) + '" width="' + Math.max(2, t.right - t.x) + '" height="16" fill="transparent"/><path d="M' + t.x + ' ' + baseline + 'H' + Math.max(t.x + .5, t.right) + '" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity=".65"/>';
    if (t.right - t.x > 36) svg += text((t.x + t.right) / 2, baseline - 15, String(t.number).padStart(2, '0') + (t.right - t.x > 110 ? ' · ' + duration(t.end - t.start) : ''), 'turn-label', 'middle');
    if (zoom > 8) for (const step of t.stepTimes) {
      const a = p.xAt(t.number, step.start), b = p.xAt(t.number, step.end);
      svg += '<path d="M' + a + ' ' + (baseline - 3) + 'v6" stroke="var(--paper)" stroke-width="1"/>';
      if (b - a > 48) svg += text((a + b) / 2, baseline + 17, '步 ' + step.number, 'axis', 'middle');
    }
    svg += '</g>';
  }
  // All connectors are below labels in paint order, and are routed around their rectangles.
  for (const route of routed.routes) {
    const selected = isSelected(route.box, 'error');
    svg += '<path d="' + roundedPath(route.points) + '" class="route' + (selected ? ' selected' : '') + '"/>';
    const marks = route.box.members.map(m => m.x);
    if (marks.length > 1) svg += '<path d="M' + Math.min(...marks) + ' ' + (baseline + 4) + 'H' + Math.max(...marks) + '" stroke="var(--red)" stroke-opacity=".35" stroke-width="1.5"/>';
    // Exact positions are retained even when several labels share a presentation group.
    for (const x of marks) svg += '<path d="M' + x + ' ' + (baseline - 3) + 'v6" class="tick"/>';
  }
  routed.boxes.forEach((n, index) => {
    const selected = isSelected(n, 'error'), multiple = n.members.length > 1;
    const label = n.title + '，' + n.meta + (multiple ? '，点击查看全部事件' : '，点击查看记录');
    svg += '<g class="node' + (multiple ? ' cluster' : '') + (selected ? ' selected' : '') + '" data-error="' + index + '" role="button" tabindex="0" aria-label="' + esc(label) + '"><title>' + esc(label) + '</title><rect class="node-surface" x="' + n.left + '" y="' + n.top + '" width="' + n.width + '" height="42" rx="5"/>';
    svg += '<circle cx="' + (n.left + 12) + '" cy="' + (n.top + 14) + '" r="2.5" fill="var(--red)"/>';
    svg += text(n.left + 23, n.top + 18, n.title, 'node-title');
    svg += text(n.left + 23, n.top + 32, n.meta, 'node-meta');
    if (!n.unknown) svg += '<path d="M' + (n.left + 8.5) + ' ' + (n.top + 29) + 'l2 2 4 -4" fill="none" stroke="var(--green)" stroke-width="1.4"/>';
    svg += '</g>';
  });
  retryLayout.nodes.forEach((n, index) => {
    const y = baseline - 56, cx = (n.left + n.right) / 2, selected = isSelected(n, 'retry');
    const waits = n.members.reduce((sum, m) => sum + m.event.delayMs, 0);
    svg += '<g class="retry-node' + (selected ? ' selected' : '') + '" data-retry="' + index + '" role="button" tabindex="0" aria-label="' + n.members.length + ' 次请求重试，退避等待合计 ' + duration(waits) + '"><title>' + n.members.length + ' 次请求重试 · 点击查看原因和退避等待</title><path d="M' + n.anchor + ' ' + (baseline - 5) + 'V' + (y + 28) + 'L' + cx + ' ' + (y + 22) + '" class="retry-tick"/><rect class="retry-surface" x="' + n.left + '" y="' + y + '" width="' + n.width + '" height="22" rx="11"/>';
    svg += retryIcon(n.left + 12, y + 11) + text(n.left + 24, y + 14, n.members.length, 'retry-count') + '</g>';
  });
  $('graph').setAttribute('width', p.fullWidth);
  $('graph').setAttribute('height', height);
  $('graph').setAttribute('viewBox', '0 0 ' + p.fullWidth + ' ' + height);
  $('graph').innerHTML = svg;
  $('fit').textContent = zoom === 1 ? '全览' : zoom.toFixed(zoom < 10 ? 1 : 0) + '×';
  $('zoom-out').disabled = zoom <= 1; $('zoom-in').disabled = zoom >= 128;
  $('view-info').textContent = current.turns.length + ' 轮 · ' + duration(p.total);
  $('coverage').textContent = (sample === 'dense' ? '合成压力样本 · ' : '真实快照 · ') + current.episodes.length + ' 处受阻 / ' + current.totals.errors + ' 次失败 → ' + errorLayout.nodes.length + ' 个可展开入口';
  renderMini();
}

function renderMini() {
  const p = projection;
  const ratio = Math.min(1, viewport.clientWidth / p.fullWidth);
  const left = viewport.scrollLeft / p.fullWidth;
  $('minimap').innerHTML = current.episodes.map(e => '<i class="mini-mark" style="left:' + p.xAt(e.turn, e.firstError) / p.fullWidth * 100 + '%"></i>').join('') + '<i class="mini-window" style="left:' + left * 100 + '%;width:' + ratio * 100 + '%"></i>';
  $('minimap').setAttribute('aria-valuenow', Math.round(left / Math.max(.0001, 1 - ratio) * 100));
  const visible = p.turns.filter(t => t.right >= viewport.scrollLeft + 20 && t.x <= viewport.scrollLeft + viewport.clientWidth - 20);
  $('range-label').textContent = zoom === 1 ? '整段会话' : visible.length ? '轮 ' + visible[0].number + '–' + visible.at(-1).number : '时间窗口';
}
function setZoom(value, localX = viewport.clientWidth / 2) {
  const p = projection, world = viewport.scrollLeft + localX;
  const turn = p.turns.find(t => world <= t.right) || p.turns.at(-1);
  const time = turn.start + Math.max(0, Math.min(turn.end - turn.start, (world - turn.x) / p.factor));
  zoom = Math.max(1, Math.min(128, value));
  render();
  viewport.scrollLeft = zoom === 1 ? 0 : projection.xAt(turn.number, time) - localX;
  renderMini();
}
function focusEvents(events, type) {
  const position = e => projection.xAt(e.turn, type === 'retry' ? e.time : e.firstError);
  const a = Math.min(...events.map(position)), b = Math.max(...events.map(e => projection.xAt(e.turn, type === 'retry' ? e.time + e.delayMs : e.resolvedAt ?? e.end)));
  const desired = Math.min(128, Math.max(zoom * 1.7, zoom * viewport.clientWidth * .7 / Math.max(1, b - a)));
  setZoom(desired, (a + b) / 2 - viewport.scrollLeft);
  const center = events.reduce((n, e) => n + position(e), 0) / events.length;
  viewport.scrollLeft = Math.max(0, center - viewport.clientWidth * .4);
  renderMini();
}

function select(type, events) {
  selection = { type, ids: events.map(e => e.id) };
  render();
  renderDetails();
  $('announcement').textContent = '已选择 ' + events.length + (type === 'retry' ? ' 次请求重试' : ' 处受阻');
}
function renderDetails() {
  if (!selection) {
    $('detail').innerHTML = '<svg class="empty-icon" viewBox="0 0 210 58" aria-hidden="true"><path d="M10 22H200 M66 22V41Q66 47 72 47H129" fill="none" stroke="var(--line)" stroke-width="1.5"/><circle cx="66" cy="22" r="3" fill="var(--accent)"/><rect x="129" y="36" width="61" height="22" rx="4" fill="var(--tint)"/><path d="M138 47h42" stroke="var(--route)"/></svg><p class="empty-title">从一处受阻开始</p><div class="empty-copy">选择分叉，查看发生了什么、后续是否成功。<br>带数量的入口保留了其中每一条事件。</div><div class="empty-rule">上方的 ↻ 表示模型请求重试。<br>选择标记可查看次数、原因和等待时间。</div>';
    return;
  }
  const source = selection.type === 'retry' ? current.retries : current.episodes;
  const events = source.filter(e => selection.ids.includes(e.id));
  const multiple = events.length > 1, retry = selection.type === 'retry';
  let html = '<div class="detail-kicker">' + (sample === 'dense' ? '合成样本' : '会话原始记录') + ' / ' + (retry ? '模型请求' : '工具执行') + '</div>';
  html += '<h2>' + (retry ? events.length + ' 次请求重试' : multiple ? events.length + ' 处受阻' : esc(events[0].label)) + '</h2>';
  if (retry) {
    html += '<div class="detail-meta">退避等待合计 ' + duration(events.reduce((n, e) => n + e.delayMs, 0)) + '<br>等待来自重试事件的 delayMs。</div>';
  } else {
    const completed = events.filter(e => e.complete).length;
    html += '<div class="detail-meta">' + events.reduce((n, e) => n + e.failedCount, 0) + ' 次失败调用 · ' + completed + '/' + events.length + ' 处有后续成功' + (multiple ? '<br>这些事件在当前比例下合并展示。' : '<br>' + esc(events[0].summary)) + '</div>';
  }
  html += '<button class="focus-button" id="focus-selection">放大这段时间 <span style="float:right">↗</span></button>';
  if (retry) {
    html += '<div class="event-list">' + events.map(e => '<div class="event-row"><strong>第 ' + e.turn + ' 轮 · 第 ' + e.step + ' 步</strong><span>' + esc(e.code) + ' · 等待 ' + duration(e.delayMs) + '</span><span>' + clock(e.time) + (e.seq === undefined ? ' · 合成记录' : ' · seq ' + e.seq) + '</span></div>').join('') + '</div>';
  } else if (multiple) {
    html += '<div class="event-list">' + events.map(e => '<button class="event-row" data-detail-event="' + esc(e.id) + '"><strong><i class="status-dot' + (e.complete ? ' done' : '') + '"></i>第 ' + e.turn + ' 轮 · ' + esc(e.label) + '</strong><span>' + e.failedCount + ' 次失败 · ' + esc(e.summary) + '</span></button>').join('') + '</div>';
  } else {
    const e = events[0];
    html += '<ol class="flow">' + e.sequence.map(s => '<li class="' + esc(s.kind) + '">' + esc(s.label) + '<small>' + clock(s.time) + (s.seqs?.length ? '<br>seq ' + s.seqs.join(', ') : '') + '</small></li>').join('') + '</ol>';
    html += '<div class="detail-meta">第 ' + e.turn + ' 轮 · 步 ' + e.steps.join('、') + '<br>' + esc(e.condition) + '</div>';
  }
  $('detail').innerHTML = html;
  $('focus-selection').onclick = () => focusEvents(events, selection.type);
  $('detail').querySelectorAll('[data-detail-event]').forEach(button => button.onclick = () => select('error', [current.episodes.find(e => e.id === button.dataset.detailEvent)]));
}
function chooseSample(next) {
  sample = next; current = next === 'real' ? original : denseSample(original);
  selection = null; zoom = 1; viewport.scrollLeft = 0;
  $('title').textContent = current.title;
  $('subtitle').textContent = next === 'real' ? current.turns.length + ' 轮 · ' + current.totals.steps.toLocaleString() + ' 步 · ' + current.totals.calls.toLocaleString() + ' 次工具调用' : '沿用真实会话时间轴 · 160 处合成受阻 · 48 次合成重试';
  document.querySelectorAll('[data-sample]').forEach(b => { b.classList.toggle('selected', b.dataset.sample === next); b.setAttribute('aria-pressed', b.dataset.sample === next); });
  render(); renderDetails();
}
function activateGraph(event) {
  if (suppressClick) return;
  const target = event.target.closest('[data-error],[data-retry],[data-turn]');
  if (!target) return;
  if (target.dataset.error !== undefined) select('error', errorLayout.nodes[Number(target.dataset.error)].members.map(m => m.event));
  else if (target.dataset.retry !== undefined) select('retry', retryLayout.nodes[Number(target.dataset.retry)].members.map(m => m.event));
  else {
    const turn = current.turns.find(t => t.number === Number(target.dataset.turn));
    focusEvents([{ turn: turn.number, firstError: turn.start, end: turn.end }], 'error');
  }
}
$('graph').addEventListener('click', activateGraph);
$('graph').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateGraph(e); } });
$('clear-selection').onclick = () => { selection = null; render(); renderDetails(); };
document.querySelectorAll('[data-sample]').forEach(b => b.onclick = () => chooseSample(b.dataset.sample));
$('zoom-in').onclick = () => setZoom(zoom * 1.8);
$('zoom-out').onclick = () => setZoom(zoom / 1.8);
$('fit').onclick = $('reset').onclick = () => setZoom(1);
viewport.addEventListener('scroll', () => { if (projection) renderMini(); });
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { viewport.scrollLeft += e.deltaX || e.deltaY; return; }
  pendingZoom = Math.max(1, Math.min(128, (wheelFrame ? pendingZoom : zoom) * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * .0018)));
  pendingX = e.clientX - viewport.getBoundingClientRect().left;
  if (!wheelFrame) wheelFrame = requestAnimationFrame(() => { wheelFrame = 0; setZoom(pendingZoom, pendingX); });
}, { passive: false });
viewport.addEventListener('pointerdown', e => { if (e.button === 0) drag = { id: e.pointerId, x: e.clientX, left: viewport.scrollLeft, moved: false }; });
viewport.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const delta = e.clientX - drag.x;
  if (!drag.moved && Math.abs(delta) > 5) { drag.moved = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); }
  if (drag.moved) { viewport.scrollLeft = drag.left - delta; e.preventDefault(); }
});
const stopDrag = e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved) { suppressClick = true; setTimeout(() => suppressClick = false, 180); }
  if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
  drag = null; viewport.classList.remove('dragging');
};
viewport.addEventListener('pointerup', stopDrag); viewport.addEventListener('pointercancel', stopDrag);
viewport.addEventListener('dblclick', e => { if (!e.target.closest('[role=button]')) setZoom(1); });
const panMini = e => { const rect = $('minimap').getBoundingClientRect(); viewport.scrollLeft = (e.clientX - rect.left) / rect.width * projection.fullWidth - viewport.clientWidth / 2; };
$('minimap').addEventListener('pointerdown', e => { $('minimap').setPointerCapture(e.pointerId); panMini(e); });
$('minimap').addEventListener('pointermove', e => { if ($('minimap').hasPointerCapture(e.pointerId)) panMini(e); });
$('minimap').addEventListener('pointerup', e => { if ($('minimap').hasPointerCapture(e.pointerId)) $('minimap').releasePointerCapture(e.pointerId); });
$('minimap').addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); viewport.scrollLeft = e.key === 'Home' ? 0 : e.key === 'End' ? projection.fullWidth : viewport.scrollLeft + (e.key === 'ArrowRight' ? 1 : -1) * viewport.clientWidth * .25; } });
function toggleBaseline(open) { $('baseline').hidden = !open; $('baseline-toggle').setAttribute('aria-expanded', open); if (open) $('baseline').querySelector('iframe').src = '/baseline'; }
$('baseline-toggle').onclick = () => toggleBaseline($('baseline').hidden);
$('baseline-close').onclick = () => toggleBaseline(false);
let resizeFrame = 0;
new ResizeObserver(() => { if (!original) return; cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); }).observe(viewport);
try {
  const response = await fetch('/data.json');
  if (!response.ok) throw new Error('会话快照读取失败');
  original = await response.json();
  await document.fonts.ready;
  chooseSample('real');
} catch (error) { $('title').textContent = '暂时无法打开预览'; $('subtitle').textContent = error.message; }
