import { selectPortableEvidence, inspectData, usageRow, toolName } from './analysis.mjs';
import { reportTable } from '../trajectory-tools/lib/report-data.js';

export function portableReportData(data, query, source) {
  const { session, context, turns, calls, usage, turnNumbers } = selectPortableEvidence(data, query);
  const coverage = { host: data.host, context: data.payload.evidence?.context,
    grain: data.host === 'pi' ? 'assistant-cycle / recorded native calls' : data.host === 'claude' ? 'assistant-record / message usage deduplicated by ID' : 'visible-action / response usage; not hidden model steps',
    focusedMetrics: query.focus ? 'Owning turns, not tool/file/skill attribution' : null };
  const evidence = seq => Number.isSafeInteger(seq) ? [{ session: data.session, log: data.logId, seq }] : [];
  const table = (kind, rows, fields) => reportTable({ source, kind, rows, fields, coverage,
    columnInfo: { wallMs: { label: '原生动作观测跨度', basis: 'observed' } } });
  if (query.view === 'context') return table('context', context.requests.filter(r => turnNumbers.has(r.turn)).map(r => ({
    ...r, id: 'context:' + r.seq, evidence: evidence(r.seq),
  })), ['turn', 'step', 'time', 'system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total']);
  if (query.view === 'cost') return table('usage', usage.map((r, i) => {
    const own = usageRow(data.host, r), turn = data.host !== 'codex' ? r.turn : session.turns.find(t => t.id === r.turnId)?.number;
    return { id: 'usage:' + (r.responseId || r.seq || i), turn, step: data.host !== 'codex' ? r.step : null,
      uncachedInputTokens: own.uncachedInput, cacheReadTokens: own.cachedInput,
      cacheWriteTokens: own.cacheWrite, outputTokens: own.output, evidence: evidence(r.seq) };
  }), ['turn', 'step', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']);
  if (query.view === 'repeats') throw Error('Select repeats in the summary, then bind original records to a sequence figure');
  if (query.view === 'io') {
    if (query.groupBy) {
      const rows = inspectData(data, query).rows;
      return table('groups', rows.map((r, i) => ({ id: 'group:' + i, name: r.tool, file: r.file,
        calls: query.groupBy === 'tool' ? r.count : null, operations: query.groupBy === 'file' ? r.count : null, errors: r.errors, returnedCharacters: r.returnedTextCharacters,
        evidence: (r.positions || []).flatMap(p => evidence(p.read?.seq)),
      })), [query.groupBy === 'tool' ? 'name' : 'file', query.groupBy === 'tool' ? 'calls' : 'operations', 'errors', 'returnedCharacters']);
    }
    return table('calls', calls.map(c => ({ id: 'call:' + c.seq, turn: c.turn, step: c.step, name: toolName(c), status: c.status,
      start: c.precise ? c.start : null, end: c.precise ? c.end : null, nativeDurationMs: c.durationMs,
      returnedCharacters: c.result ? c.result.text.length + (c.result.omitted || 0) : null,
      evidence: [...evidence(c.seq), ...evidence(c.resultSeq)],
    })), ['turn', 'step', 'name', 'status', 'start', 'end', 'nativeDurationMs', 'returnedCharacters']);
  }
  return table('steps', turns.flatMap(t => t.steps.map(s => ({ id: 'step:' + t.number + ':' + s.number,
    turn: t.number, step: s.number, start: s.endObserved ? s.start : null, end: s.endObserved ? s.end : null,
    wallMs: s.endObserved && Number.isFinite(s.start) && Number.isFinite(s.end) ? s.end - s.start : null,
    evidence: evidence(s.assistantSeq ?? s.seq),
  }))), ['turn', 'step', 'start', 'end', 'wallMs']);
}
