export function changedLines(before, after) {
  const lines = text => text === '' ? [] : String(text).replace(/\r\n/g, '\n').split('\n');
  const a = lines(before), b = lines(after), rows = [];
  const add = (kind, i, j) => rows.push({ kind, before: kind === 'add' ? null : i + 1,
    after: kind === 'remove' ? null : j + 1, text: kind === 'add' ? b[j] : a[i] });
  if ((a.length + 1) * (b.length + 1) > 400000) {
    let left = 0, endA = a.length, endB = b.length;
    while (left < Math.min(a.length, b.length) && a[left] === b[left]) { add('same', left, left); left++; }
    while (endA > left && endB > left && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    for (let i = left; i < endA; i++) add('remove', i, left);
    for (let j = left; j < endB; j++) add('add', endA, j);
    for (let i = endA, j = endB; i < a.length; i++, j++) add('same', i, j);
    return rows;
  }
  const stride = b.length + 1, lcs = new Uint16Array((a.length + 1) * stride);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    lcs[i * stride + j] = a[i] === b[j] ? lcs[(i + 1) * stride + j + 1] + 1 : Math.max(lcs[(i + 1) * stride + j], lcs[i * stride + j + 1]);
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { add('same', i, j); i++; j++; }
    else if (i < a.length && (j === b.length || lcs[(i + 1) * stride + j] >= lcs[i * stride + j + 1])) { add('remove', i, j); i++; }
    else { add('add', i, j); j++; }
  }
  return rows;
}
export function compactDiff(rows, context = 3) {
  const visible = new Set();
  rows.forEach((row, i) => { if (row.kind !== 'same') for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) visible.add(j); });
  const result = [];
  let hidden = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!visible.has(i)) { hidden++; continue; }
    if (hidden) { result.push({ kind: 'fold', count: hidden }); hidden = 0; }
    result.push(rows[i]);
  }
  if (hidden) result.push({ kind: 'fold', count: hidden });
  return result;
}
