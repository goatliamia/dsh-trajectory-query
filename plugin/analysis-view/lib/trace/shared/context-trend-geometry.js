// Match the existing SVG's two-decimal geometry exactly. Remove only duplicate
// or collinear points in the same direction; keep corners and reversals.
function compactTrendPolyline(points) {
  const line = [];
  for (const point of points) {
    const next = point.map(value => Math.round(Number(value.toFixed(2)) * 100));
    const last = line.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    while (line.length > 1) {
      const a = line.at(-2), b = line.at(-1);
      const dx = b[0] - a[0], dy = b[1] - a[1], nx = next[0] - b[0], ny = next[1] - b[1];
      if (dx * ny !== dy * nx || dx * nx + dy * ny < 0) break;
      line.pop();
    }
    line.push(next);
  }
  return line.map(([x, y]) => x / 100 + ',' + y / 100);
}
