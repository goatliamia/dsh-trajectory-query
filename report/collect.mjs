import { validateDataset, DATA_SCHEMA } from './contract.mjs';
import { reportTable } from '../plugin/trajectory-tools/lib/report-data.js';
import {collectSummaryDataset} from './summary-data.mjs';

// execute is supplied by the host: registered DSH tools, Pi extension, MCP,
// or a local read-only service. The model never has to relay these pages.
export async function collectDataset(execute, query, { maxRows = 20000, maxBytes = 8 * 1024 * 1024, signal } = {}) {
  if (query.tool !== 'trajectory_inspect') throw Error('Dataset query must use trajectory_inspect');
  if (!query.args?.snapshot) throw Error('Bind a previously inspected snapshot before exporting');
  if (query.table) return collectSummaryDataset(execute,query,{maxRows,maxBytes,signal});
  const args = { ...query.args, format: 'data', sort: 'time', limit: 500 };
  let cursor, table, sourceKey, bytes = 0, expectedOffset = 0;
  const seen = new Set();
  do {
    signal?.throwIfAborted();
    if (cursor && seen.has(cursor)) throw Error('Repeated data cursor'); if (cursor) seen.add(cursor);
    const page = await execute(query.tool, { ...args, ...(cursor ? { cursor } : {}) }, signal);
    if (page?.ok === false) throw Error(page.error?.message || page.error || 'Dataset query failed');
    if (page?.schema !== DATA_SCHEMA) throw Error('The tool does not provide report data format');
    const key = JSON.stringify([page.id, page.source, page.columns, page.totalRows]);
    if (sourceKey && sourceKey !== key) throw Error('Dataset identity or shape changed while exporting');
    if (page.source.snapshot !== args.snapshot || page.offset !== expectedOffset) throw Error('Dataset page does not match the requested snapshot/offset');
    sourceKey = key;
    table ||= { ...page, rows: [], nextCursor: undefined, nextOffset: undefined, offset: undefined };
    bytes += JSON.stringify(page.rows).length * 2;
    if (table.rows.length + page.rows.length > maxRows || bytes > maxBytes) throw Error('Dataset export exceeds its bounded budget; choose a narrower scope');
    table.rows.push(...page.rows); expectedOffset += page.rows.length; cursor = page.nextCursor;
    if (cursor && !page.rows.length) throw Error('Data cursor made no progress');
  } while (cursor);
  if (table.rows.length !== table.totalRows) throw Error('Incomplete dataset export');
  return validateDataset(table);
}

export async function collectReport(execute, sources, options = {}) {
  const datasets = {}; let bytes = 0;
  if (Object.keys(sources).length > (options.maxDatasets ?? 12)) throw Error('Too many report datasets');
  for (const [name, query] of Object.entries(sources)) {
    datasets[name] = await collectDataset(execute, query, options);
    bytes += JSON.stringify(datasets[name]).length * 2;
    if (bytes > (options.maxTotalBytes ?? 16 * 1024 * 1024)) throw Error('Report data exceeds its total budget');
  }
  return datasets;
}

export async function collectRecords(execute, source, seqs, { signal } = {}) {
  if (!Array.isArray(seqs) || seqs.length > 30 || seqs.some(n => !Number.isSafeInteger(n) || n < 0 || typeof source.cut === 'number' && n > source.cut)) throw Error('Select at most 30 evidence positions within this cut');
  const rows = [];
  for (const seq of [...new Set(seqs)]) {
    signal?.throwIfAborted();
    const dsh = source.host === 'dsh';
    const packet = await execute('trajectory_read', { session: source.session, snapshot: source.snapshot, seq, ...(dsh ? { format: 'linked' } : { linked: true }) }, signal);
    if (packet?.ok === false) throw Error('Original-record read failed');
    if (packet.session !== source.session || packet.snapshot !== source.snapshot || (dsh ? packet.log?.id ?? packet.log : packet.logId) !== source.log || dsh && packet.cut !== source.cut) throw Error('Record read belongs to another source cut');
    const record = (dsh ? packet.records : packet.linked)?.find(row => row.seq === seq);
    if (!record) throw Error('Selected evidence was not returned');
    const bodyRead = dsh ? record.body : { tool: 'trajectory_read', args: { session: source.session, snapshot: source.snapshot, logId: source.log, seq, field: 'body' } };
    rows.push({ id: 'record:' + seq, turn: packet.turn ?? null, time: record.time ?? null, kind: dsh ? record.type : record.kind,
      text: dsh ? record.text?.text ?? null : record.text ?? null,
      omittedCharacters: dsh ? record.text?.omitted ?? null : record.length == null ? null : Math.max(0, record.length - (record.text?.length || 0)),
      evidence: [{ session: source.session, log: source.log, seq, ...(bodyRead ? { read: bodyRead } : {}) }] });
  }
  return reportTable({ source: { ...source, query: { records: seqs } }, kind: 'records', rows,
    fields: ['turn', 'time', 'kind', 'text', 'omittedCharacters'], coverage: { text: source.host === 'dsh' ? 'Bounded verbatim text excerpts from linked reads' : 'Bounded native body excerpts from linked reads; JSON may be present', fullBody: 'Complete body remains available through trajectory_read' } });
}
