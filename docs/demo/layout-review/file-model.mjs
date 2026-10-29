export function fileIdentity(path) {
  const slash = String(path).replace(/\\/g, '/');
  const normalized = slash.replace(/\/{2,}/g, '/').replace(/^\//, slash.startsWith('//') ? '//' : '/');
  return /^(?:[a-z]:\/|\/\/)/i.test(String(path).replace(/\\/g, '/')) ? normalized.toLowerCase() : normalized;
}
const fileObjectCache = new WeakMap();
export function fileObjects(operations, turns = null) {
  const cacheKey = turns ? [...turns].sort((a, b) => a - b).join(',') : '*';
  let cache = fileObjectCache.get(operations);
  if (cache?.length === operations.length && cache.values.has(cacheKey)) return cache.values.get(cacheKey);
  if (!cache || cache.length !== operations.length) { cache = { length: operations.length, values: new Map() }; fileObjectCache.set(operations, cache); }
  const groups = new Map();
  for (const operation of operations) {
    if (turns && !turns.has(operation.turn)) continue;
    const id = fileIdentity(operation.path);
    let file = groups.get(id);
    if (!file) groups.set(id, file = { id, path: operation.path, operations: [] });
    file.operations.push(operation);
  }
  const files = [...groups.values()];
  for (const file of files) {
    file.operations.sort((a, b) => a.seq - b.seq);
    file.reads = file.operations.filter(o => o.kind === 'read' && o.status === 'returned');
    file.changes = file.operations.filter(o => o.kind === 'change' && o.status === 'returned');
    file.failed = file.operations.filter(o => o.status === 'error');
    file.pending = file.operations.filter(o => o.status === 'unknown');
    file.lane = file.changes.length || !file.reads.length && file.operations.some(o => o.kind === 'change') ? 'change' : 'read';
    file.label = file.path.replace(/\\/g, '/').split('/').at(-1);
  }
  const suffixes = new Map();
  for (const file of files) {
    file.parts = file.path.replace(/\\/g, '/').split('/');
    for (let n = 1; n <= file.parts.length; n++) { const key = file.parts.slice(-n).join('/').toLowerCase(); suffixes.set(key, (suffixes.get(key) || 0) + 1); }
  }
  for (const file of files) {
    let count = 1;
    while (count < file.parts.length && suffixes.get(file.parts.slice(-count).join('/').toLowerCase()) > 1) count++;
    file.label = file.parts.slice(-count).join('/'); delete file.parts;
  }
  files.sort((a, b) => a.operations[0].seq - b.operations[0].seq);
  if (cache.values.size >= 16) cache.values.clear(); cache.values.set(cacheKey, files);
  return files;
}
export function packFileObjects(items, { left, right, measure, label, obstacles = [], gap = 8 }) {
  if (!items.length) return [];
  let groups = items.map(item => [item]).sort((a, b) => a[0].x - b[0].x || a[0].file.id.localeCompare(b[0].file.id));
  const free = [[left, right]];
  for (const box of [...obstacles].sort((a, b) => a.left - b.left)) {
    for (let i = free.length - 1; i >= 0; i--) {
      const [a, b] = free[i];
      if (box.right + gap <= a || box.left - gap >= b) continue;
      free.splice(i, 1, ...[[a, Math.min(b, box.left - gap)], [Math.max(a, box.right + gap), b]].filter(([lo, hi]) => hi > lo));
    }
  }
  // Keep every member accessible through the file picker when the entire lane is occupied.
  const widest = Math.max(0, ...free.map(([a, b]) => b - a));
  if (widest < 62) return [{ members: groups.flat(), hidden: true }];
  for (;;) {
    const placed = groups.map(members => {
      const text = label(members), desired = Math.min(166, Math.max(62, measure(text) + 36));
      const width = Math.min(desired, widest);
      const anchor = members.reduce((sum, item) => sum + item.x, 0) / members.length;
      const candidates = free.filter(([a, b]) => b - a >= width).map(([a, b]) => Math.max(a + width / 2, Math.min(b - width / 2, anchor)));
      const cx = candidates.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0] ?? (left + right) / 2;
      return { members, label: text, width, cx, left: cx - width / 2, right: cx + width / 2 };
    });
    let collision = -1;
    for (let i = 1; i < placed.length; i++) if (placed[i].left < placed[i - 1].right + gap) { collision = i; break; }
    if (collision < 0 || groups.length === 1) return placed;
    groups.splice(collision - 1, 2, [...groups[collision - 1], ...groups[collision]]);
  }
}

export function fileTouchClusters(points, gap = 24) {
  const result = [];
  for (const kind of ['read', 'change']) {
    const groups = points.filter(p => p.operation.kind === kind).sort((a, b) => a.x - b.x || a.operation.seq - b.operation.seq)
      .map(p => ({ members: [p], x: p.x, kind }));
    for (let i = 1; i < groups.length;) {
      if (groups[i].x - groups[i - 1].x >= gap) { i++; continue; }
      const members = [...groups[i - 1].members, ...groups[i].members];
      groups.splice(i - 1, 2, { members, x: members.reduce((sum, p) => sum + p.x, 0) / members.length, kind });
      i = Math.max(1, i - 1);
    }
    result.push(...groups);
  }
  return result;
}

// A file's history is session-wide; the viewport/selected turn only marks a position in it.
export function fileChangeHistory(operations, path) {
  const id = fileIdentity(path);
  const file = fileObjects(operations.filter(op => fileIdentity(op.path) === id))[0];
  if (!file) return null;
  const rounds = new Map();
  for (const op of file.operations) {
    if (!rounds.has(op.turn)) rounds.set(op.turn, { turn: op.turn, operations: [], reads: 0, changes: 0, failed: 0, pending: 0 });
    const round = rounds.get(op.turn); round.operations.push(op);
    if (op.status === 'returned') round[op.kind === 'read' ? 'reads' : 'changes']++;
    else if (op.status === 'error') round.failed++;
    else round.pending++;
  }
  return { ...file, rounds: [...rounds.values()], changeRounds: [...rounds.values()].filter(r => r.operations.some(op => op.kind === 'change')) };
}
