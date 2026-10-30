export const REPORT_SCHEMA = 'trajectory-report/1';
export const DATA_SCHEMA = 'trajectory-data/1';
export const COMPONENTS = Object.freeze({
  bar: { fields: ['label', 'value'], purpose: '比较投入在轮次、工具或来源之间的分布' },
  histogram: { fields: ['value'], purpose: '观察常见耗时与长尾，选择要展开的范围' },
  scatter: { fields: ['x', 'y'], purpose: '比较相近条件的记录，选择异常或代表性样本' },
  timeline: { fields: ['label', 'start', 'end'], purpose: '按真实区间观察先后、重叠与等待' },
  sequence: { fields: [], purpose: '将有原文位置的行动、反馈和转折放在一起' },
  context: { fields: ['x'], purpose: '查看构成随轮次变化，或聚焦几种来源' },
  comparison: { fields: [], purpose: '将两个实际切点的同一组指标放在同一尺度比较' },
});
const numericUnit = unit => !['text', 'turn', 'step', 'identifier'].includes(unit);
export function validateDataset(data) {
  if (data?.schema !== DATA_SCHEMA || !data.id || !Array.isArray(data.rows) || !data.columns) throw Error('Invalid report dataset');
  const source = data.source;
  if (!source?.host || !source.session || !source.snapshot || typeof source.log !== 'string' || !source.log) throw Error('Dataset is missing its frozen source identity');
  const ids = new Set();
  for (const row of data.rows) {
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw Error('Missing or duplicate dataset row ID');
    ids.add(row.id);
    for (const [key, column] of Object.entries(data.columns)) {
      const value = row[key];
      if (value == null) continue;
      if (numericUnit(column.unit) && (typeof value !== 'number' || !Number.isFinite(value))) throw Error('Non-numeric measurement: ' + key);
    }
    for (const ref of row.evidence || []) if (ref.session !== source.session || ref.log !== source.log || !Number.isSafeInteger(ref.seq) || ref.seq < 0 || typeof source.cut === 'number' && ref.seq > source.cut) throw Error('Evidence belongs to another source');
  }
  return data;
}
export function bindFigure(spec, datasets) {
  const component = COMPONENTS[spec?.type];
  if (!component) throw Error('Unknown report component: ' + spec?.type);
  const allowed = new Set(['id','type','data','fields','title','subtitle','note','readout','select','limit','sort','orientation','groupBy','highlight','bins','sample','series','layers','annotations','color','rows','nodes']);
  for (const key of Object.keys(spec)) if (!allowed.has(key)) throw Error('Unknown component option: ' + key);
  if (spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > 200)) throw Error('Component limit must be 1..200');
  if (spec.bins && spec.bins.length > 32) throw Error('Use at most 32 histogram bins');
  if (spec.nodes && spec.nodes.length > 30) throw Error('Use at most 30 sequence nodes');
  let data = validateDataset(datasets[spec.data]);
  if (spec.select) {
    for (const key of Object.keys(spec.select.where || {})) if (!data.columns[key]) throw Error('Unknown selection column');
    const wanted = spec.select.rows && new Set(spec.select.rows);
    if (wanted && [...wanted].some(id => !data.rows.some(row => row.id === id))) throw Error('Selected row is not in this dataset');
    const rows = data.rows.filter(row => (!wanted || wanted.has(row.id)) && Object.entries(spec.select.where || {}).every(([key, value]) => row[key] === value));
    data = { ...data, rows };
  }
  for (const role of component.fields) if (!spec.fields?.[role] || !data.columns[spec.fields[role]]) throw Error('Missing component field: ' + role);
  for (const role of Object.keys(spec.fields || {})) if (![...component.fields, ...(spec.type === 'bar' ? ['detail'] : [])].includes(role) || !data.columns[spec.fields[role]]) throw Error('Unknown component field: ' + role);
  if (spec.groupBy && (spec.type !== 'bar' || spec.groupBy !== spec.fields.label)) throw Error('Group additive bars by their label column');
  if (spec.orientation && !['horizontal','vertical'].includes(spec.orientation)) throw Error('Unknown bar orientation');
  if (spec.sort && !['source','descending'].includes(spec.sort)) throw Error('Unknown figure sort');
  const numberField = key => { if (!data.columns[key] || !numericUnit(data.columns[key].unit)) throw Error('Expected a numeric column: ' + key); };
  if (['bar', 'histogram'].includes(spec.type)) numberField(spec.fields.value);
  if (spec.type === 'scatter') { numberField(spec.fields.x); numberField(spec.fields.y); if (spec.color) { numberField(spec.color.field); if (!Number.isFinite(spec.color.threshold)) throw Error('Invalid color threshold'); } }
  if (spec.type === 'timeline') {
    if ([spec.fields.start, spec.fields.end].some(k => data.columns[k].unit !== 'timestamp-ms')) throw Error('Timeline requires two observed timestamp columns');
  }
  if (spec.type === 'context') {
    if (data.kind !== 'context') throw Error('Context requires a recorded composition dataset');
    for (const key of spec.series || []) if (data.columns[key]?.unit !== 'tokens' || data.columns[key]?.basis !== 'estimated') throw Error('Context series requires source estimates');
  }
  if (spec.type === 'comparison') {
    if (!Array.isArray(spec.rows) || spec.rows.length !== 2 || spec.rows.some(id => !data.rows.some(row => row.id === id))) throw Error('Comparison requires two recorded row IDs');
    if (!spec.series?.length) throw Error('Comparison needs named numeric columns');
    spec.series.forEach(numberField);
    if (new Set(spec.series.map(k => data.columns[k].unit)).size !== 1) throw Error('Comparison columns need the same unit');
  }
  if (spec.type === 'sequence') {
    let previous = -Infinity;
    for (const node of spec.nodes || []) {
      const row = data.rows.find(row => row.id === node.row);
      if (!row) throw Error('Sequence node has no recorded row: ' + node.row);
      if (Number.isFinite(row.time)) { if (row.time < previous) throw Error('Evidence sequence must follow recorded time'); previous = row.time; }
    }
  }
  for (const annotation of spec.annotations || []) if (!data.rows.some(row => row.id === annotation.row)) throw Error('Annotation has no recorded anchor');
  return { spec, data };
}

export function groupSum(data, by, value) {
  if (data.columns[value]?.aggregate !== 'sum') throw Error('This measurement is not additive: ' + value);
  if (!data.columns[by]) throw Error('Unknown grouping column');
  const groups = new Map();
  for (const row of data.rows) {
    const key = row[by]; if (key == null) continue;
    if (!groups.has(key)) groups.set(key, { id: 'group:' + key, [by]: key, [value]: null, known: 0, unknown: 0, evidence: [] });
    const g = groups.get(key);
    if (row[value] == null) g.unknown++; else { g[value] = (g[value] ?? 0) + row[value]; g.known++; }
    if (g.evidence.length < 12) g.evidence.push(...(row.evidence || []).slice(0, 12 - g.evidence.length));
  }
  return { ...data, kind: 'groups', rows: [...groups.values()], coverage: { ...data.coverage, aggregation: 'Sum of known values; unknown counts retained per group' } };
}
