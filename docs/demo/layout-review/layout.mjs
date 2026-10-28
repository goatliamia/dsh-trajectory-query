// Screen-space annotation layout. Events retain their original anchors and identity.
// A cluster is a presentation container, never a new incident or causal relation.
export function layoutAnnotations(items, options) {
  const { left, right, rows = 3, gap = 14, minDistance = 8, maxShift = 64, describe } = options;
  if (!(right > left) || rows < 1) throw new Error('Invalid layout bounds');
  let groups = [];
  for (const item of [...items].sort((a, b) => a.x - b.x || String(a.id).localeCompare(String(b.id)))) {
    if (!Number.isFinite(item.x)) throw new Error('Non-finite event anchor');
    const previous = groups.at(-1);
    // Limit the entire group's span; proximity is not transitively chained.
    if (previous && item.x - previous[0].x <= minDistance) previous.push(item);
    else groups.push([item]);
  }
  let merges = items.length - groups.length;
  for (;;) {
    const occupied = Array.from({ length: rows }, () => []);
    const channels = Array.from({ length: rows }, () => []);
    const placed = [];
    let failed = -1;
    for (let i = 0; i < groups.length; i++) {
      const members = groups[i], info = describe(members);
      const width = Math.min(right - left, Math.max(20, info.width));
      const anchor = members[Math.floor((members.length - 1) / 2)].x;
      const ideal = Math.max(left, Math.min(right - width, anchor - width / 2));
      let best = null;
      for (let row = 0; row < rows; row++) {
        const above = occupied.slice(0, row).flat();
        const candidates = [anchor, ...above.flatMap(b => [b.left - 9, b.right + 9])];
        const routeX = candidates.filter(x => Math.abs(x - anchor) <= 28 && above.every(b => x <= b.left - 8 || x >= b.right + 8))
          .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)[0];
        // A short clear stem is part of the reservation. Do not accept a layout
        // that needs a long detour around several unrelated annotations.
        if (routeX === undefined) continue;
        const boxes = [...occupied[row], ...channels[row].map(x => ({ left: x - 8, right: x + 8 }))].sort((a, b) => a.left - b.left);
        let edge = left;
        for (let k = 0; k <= boxes.length; k++) {
          const end = k < boxes.length ? Math.min(right, boxes[k].left - gap) : right;
          if (end - edge >= width - 0.001) {
            const x = Math.max(edge, Math.min(end - width, ideal));
            const shift = Math.abs(x - ideal);
            if (shift <= maxShift) {
              const cost = row * 26 + shift + Math.abs(routeX - anchor);
              if (!best || cost < best.cost) best = { left: x, right: x + width, row, cost, routeX };
            }
          }
          if (k < boxes.length) edge = Math.max(edge, boxes[k].right + gap);
        }
      }
      if (!best) { failed = i; break; }
      const box = { ...info, ...best, width, anchor, members, id: members.map(m => m.id).join('|') };
      occupied[box.row].push(box);
      for (let row = 0; row < box.row; row++) channels[row].push(box.routeX);
      placed.push(box);
    }
    if (failed < 0) return { nodes: placed, merges, rows: placed.length ? Math.max(...placed.map(n => n.row)) + 1 : 0 };
    // Collapse only a local pair around the collision, and rerun the deterministic sweep.
    // This bounds height even for hundreds of events at precisely the same time.
    let pair;
    if (failed === 0) pair = 0;
    else if (failed === groups.length - 1) pair = failed - 1;
    else {
      const before = groups[failed][0].x - groups[failed - 1].at(-1).x;
      const after = groups[failed + 1][0].x - groups[failed].at(-1).x;
      pair = before <= after ? failed - 1 : failed;
    }
    if (groups.length < 2) throw new Error('Annotation does not fit');
    groups.splice(pair, 2, [...groups[pair], ...groups[pair + 1]]);
    merges++;
  }
}

// The packing pass reserves a short, clear stem through all earlier rows.
// Routing therefore needs no long cross-chart detours and never cuts through labels.
export function routeAnnotations(nodes, { baseline, firstY, rowGap = 66, height = 42 }) {
  const boxes = nodes.map(n => ({ ...n, top: firstY + n.row * rowGap, bottom: firstY + n.row * rowGap + height }));
  const routes = [];
  for (const box of [...boxes].sort((a, b) => a.row - b.row || a.anchor - b.anchor)) {
    const x = box.routeX ?? box.anchor;
    const points = [[box.anchor, baseline], [box.anchor, baseline + 8], [x, baseline + 8]];
    const target = Math.max(box.left + 12, Math.min(box.right - 12, box.anchor));
    const approach = box.top - 10;
    points.push([x, approach], [target, approach], [target, box.top]);
    routes.push({ id: box.id, points, box });
  }
  return { boxes, routes };
}

export function roundedPath(points, radius = 5) {
  const clean = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (!clean.length) return '';
  let path = 'M' + clean[0].join(' ');
  for (let i = 1; i < clean.length - 1; i++) {
    const p = clean[i], before = clean[i - 1], after = clean[i + 1];
    const d1 = Math.hypot(p[0] - before[0], p[1] - before[1]);
    const d2 = Math.hypot(after[0] - p[0], after[1] - p[1]);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const a = p.map((v, k) => v + (before[k] - v) * r / d1);
    const b = p.map((v, k) => v + (after[k] - v) * r / d2);
    path += ' L' + a.join(' ') + ' Q' + p.join(' ') + ' ' + b.join(' ');
  }
  return path + (clean.length > 1 ? ' L' + clean.at(-1).join(' ') : '');
}
