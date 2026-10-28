import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeZstdSession } from '../experiments/corpus/decode-session.mjs';
import { analyzeTraceOverview } from './trace-overview-analysis.mjs';

// The demo uses execution history, not the current compacted message surface.
// A replacement result belongs to an old call: counting it again fabricates duration.
const isReplacement = e => e.surfaceOp && typeof e.surfaceOp === 'object';
const key = (turn, step, id) => JSON.stringify([turn, step, id]);
const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const excerpt = (text, limit = 1800) => ({ text: String(text || '').slice(0, limit), omitted: Math.max(0, String(text || '').length - limit) });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const argumentSignature = (name, args) => {
  let normalized;
  try { normalized = JSON.stringify(canonical(typeof args === 'string' ? JSON.parse(args) : args)); }
  catch { normalized = String(args ?? ''); }
  return createHash('sha256').update(name + '\0' + normalized).digest('hex');
};
const argumentTarget = args => {
  try {
    const value=typeof args==='string'?JSON.parse(args):args;
    const target=value?.file_path??value?.path??value?.filePath;
    if(typeof target!=='string')return null;
    const normalized=target.replace(/\\+/g,'/').replace(/\/+/g,'/');
    return /^[A-Za-z]:\//.test(normalized)?normalized.toLowerCase():normalized;
  } catch { return null; }
};

export function projectSession(rows, source = {}) {
  const header = rows.find(e => e.type === 'session');
  if (!header) throw new Error('Missing session header');
  if (header.version !== 4) throw new Error('Use a normalized session.v4.jsonl.zstd source');
  const events = rows.filter(e => Number.isFinite(e.seq)).sort((a, b) => a.seq - b.seq);
  const turns = [], turnIndex = new Map(), steps = new Map(), calls = new Map();
  const diagnostics = { replacementEventsExcluded: 0, unmatchedResults: 0, duplicateResults: 0, unresolvedCalls: 0 };
  let currentTurn;
  const getStep = (turn, step) => steps.get(key(turn, step, 'step'));
  for (const e of events) {
    const d = e.data || {};
    if (isReplacement(e)) { diagnostics.replacementEventsExcluded++; continue; }
    if (e.type === 'turn/start') {
      currentTurn = { number: d.turn, seq: e.seq, start: e.time, end: null, endSeq: null, reason: null, prompts: [], steps: [], markers: [] };
      turns.push(currentTurn); turnIndex.set(d.turn, currentTurn);
      continue;
    }
    const turn = turnIndex.get(d.turn) || currentTurn;
    if (!turn) continue;
    if (e.type === 'user/message' && d.source?.kind === 'user') {
      const text = textOf(d.content).trim();
      if (text) turn.prompts.push({ seq: e.seq, time: e.time, ...excerpt(text, 2600) });
    } else if (e.type === 'step/start') {
      const step = { number: d.step, seq: e.seq, start: e.time, end: null, endSeq: null, assistantSeq: null, assistantTime: null, reply: null, calls: [], retries: [], markers: [] };
      turn.steps.push(step); steps.set(key(d.turn, d.step, 'step'), step);
    } else if (e.type === 'step/end') {
      const step = getStep(d.turn, d.step);
      if (step) { step.end = e.time; step.endSeq = e.seq; }
    } else if (e.type === 'assistant/message') {
      const step = getStep(d.turn, d.step);
      if (step) {
        step.assistantSeq = e.seq; step.assistantTime = e.time;
        const text = textOf(d.message?.content).trim();
        if (text) step.reply = excerpt(text, 2000);
      }
    } else if (e.type === 'tool/call') {
      const step = getStep(d.turn, d.step);
      if (!step) throw new Error(`Call outside a step at seq ${e.seq}`);
      const id = key(d.turn, d.step, d.callId);
      if (calls.has(id)) throw new Error(`Duplicate call at seq ${e.seq}`);
      const call = { id: d.callId, seq: e.seq, name: d.name, signature: argumentSignature(d.name, d.arguments), target: argumentTarget(d.arguments), args: excerpt(d.arguments, 2200), start: e.time, end: null, resultSeq: null, status: 'unknown', error: null, result: null };
      step.calls.push(call); calls.set(id, call);
    } else if (e.type === 'tool/result') {
      const id = d.message?.toolCallId ?? d.message?.source?.callId ?? d.callId;
      const call = calls.get(key(d.turn, d.step, id));
      if (!call) { diagnostics.unmatchedResults++; continue; }
      if (call.resultSeq !== null) { diagnostics.duplicateResults++; continue; }
      if (e.time < call.start) throw new Error(`Result predates call ${id}`);
      call.end = e.time; call.resultSeq = e.seq;
      call.status = d.error || d.message?.isError ? 'error' : 'returned';
      call.error = d.error || null; call.result = excerpt(textOf(d.message?.content), 2400);
    } else if (e.type === 'llm/retry') {
      const step = getStep(d.turn, d.step);
      if (step) step.retries.push({ seq: e.seq, time: e.time, delayMs: d.delayMs, failure: d.failure });
    } else if (['compaction/start', 'compaction/end', 'subagent/catalog'].includes(e.type)) {
      const marker = { type: e.type, seq: e.seq, time: e.time, childId: d.childId, label: d.label };
      turn.markers.push(marker);
      const step = turn.steps.at(-1); if (step) step.markers.push(marker);
    } else if (e.type === 'turn/end') {
      turn.end = e.time; turn.endSeq = e.seq; turn.reason = d.reason;
    }
  }
  for (const turn of turns) {
    for (const step of turn.steps) {
      step.endObserved = step.end !== null;
      if (step.end === null) step.end = Math.max(step.start, step.assistantTime || step.start, ...step.calls.map(c => c.end || c.start));
      if (step.end < step.start) throw new Error('Negative step duration');
      step.errors = step.calls.filter(c => c.status === 'error').length;
      diagnostics.unresolvedCalls += step.calls.filter(c => c.end === null).length;
    }
    turn.calls = turn.steps.reduce((n, s) => n + s.calls.length, 0);
    turn.errors = turn.steps.reduce((n, s) => n + s.errors, 0);
    turn.title = turn.prompts[0]?.text || (turn.reason?.kind === 'aborted' ? '本轮被停止' : '继续执行');
  }
  const title = events.filter(e => e.type === 'session/title').at(-1)?.data?.title || header.id;
  const communications = events.filter(e => !isReplacement(e) && e.type === 'user/message' && ['agent-message', 'team-message', 'subagent-settled'].includes(e.data?.source?.kind)).map(e => ({
    seq: e.seq, time: e.time, kind: e.data.source.kind, childId: e.data.source.senderSessionId || e.data.source.senderId || null,
    content: excerpt(textOf(e.data.content), 1800),
  }));
  return { id: header.id, title, parentSession: header.parentSession || null, source, firstSeq: events[0]?.seq, lastSeq: events.at(-1)?.seq, eventCount: events.length, diagnostics, turns, communications,
    totals: { turns: turns.length, steps: turns.reduce((n, t) => n + t.steps.length, 0), calls: calls.size, errors: [...calls.values()].filter(c => c.status === 'error').length } };
}

function load(file) {
  const bytes = readFileSync(file);
  const rows = decodeZstdSession(bytes).toString('utf8').split('\n').filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON at line ${index + 1}`); }
  });
  return { rows, session: projectSession(rows, { file: resolve(file), format: rows[0]?.version, sha256: createHash('sha256').update(bytes).digest('hex') }) };
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = option('--source');
  if (!source) throw new Error('Usage: node scripts/build-trace-main-demo.mjs --source <session.v4.jsonl.zstd> [--out <demo.html>]');
  const { rows, session } = load(source);
  const sessions = [session];
  const childIds = [...new Set(rows.filter(e => e.type === 'subagent/catalog').map(e => e.data.childId))];
  for (const id of childIds) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) continue;
    const childPath = join(dirname(dirname(source)), id, 'session.v4.jsonl.zstd');
    if (existsSync(childPath)) {
      const child = load(childPath).session;
      if (child.parentSession === session.id) sessions.push(child);
    }
  }
  if (session.diagnostics.unmatchedResults || session.diagnostics.duplicateResults) throw new Error('Unresolved result pairing: ' + JSON.stringify(session.diagnostics));
  for(const projected of sessions)projected.overview=analyzeTraceOverview(projected);
  const payload = { schema: 1, generatedAt: new Date().toISOString(), mainSession: session.id, sessions };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const template = readFileSync(join(repo, 'docs/demo/trace-main.template.html'), 'utf8')
    .replace('</style>', () => readFileSync(join(repo,'docs/demo/trace-main.branches.css'),'utf8') + '\n</style>')
    .replace('/*__TRACE_RENDERER__*/', () => ['trace-main.graph.js','trace-main.panorama.js','trace-main.scene.js','trace-main.branches.js'].map(file=>readFileSync(join(repo,'docs/demo',file),'utf8')).join('\n'));
  if (template.split('/*__TRACE_DATA__*/').length !== 2) throw new Error('Expected exactly one data slot');
  const out = resolve(option('--out') || join(repo, 'docs/demo/trace-main.real.html'));
  writeFileSync(out, template.replace('/*__TRACE_DATA__*/', () => json));
  console.log(JSON.stringify({ out, bytes: readFileSync(out).length, sessions: sessions.map(s => ({ id: s.id, totals: s.totals, diagnostics: s.diagnostics })) }, null, 2));
}
