import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSession } from '../analyzers/load-session.mjs';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { describeCall } from '../docs/demo/layout-review/step-insight.mjs';
import { collectToolResults } from '../docs/demo/layout-review/tool-result-model.mjs';
import { replaySkillEvidence } from '../analyzers/dsh-skill-evidence.mjs';
import { pathToFileURL } from 'node:url';

const root = resolve('.dsh/layout-review');
const page = readFileSync(join(root, 'installed-trace.html'), 'utf8');
const payload = JSON.parse(page.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const main = payload.sessions.find(s => s.id === payload.mainSession);
const sessionsRoot = join(process.env.USERPROFILE, '.dsh/sessions/--D-projects-sql~0020event--');
const log = loadSession(join(sessionsRoot, main.id, 'session.v4.jsonl.zstd'));
const events = log.events.filter(e => e.seq <= main.lastSeq), until = events.at(-1)?.time;
const locate = time => {
  const t = main.turns.find(t => time <= (t.end ?? Infinity)) || main.turns.at(-1);
  const step = t.steps.find(s => time <= s.end) || t.steps.at(-1);
  return { turn: t.number, step: step?.number };
};
const skillEvents = events.flatMap(e => {
  const source = e.data?.source || e.data?.message?.source;
  if (!['skill-catalog', 'skill-invocation'].includes(source?.kind)) return [];
  return [{ id: 'skill:' + e.seq, seq: e.seq, time: e.time, ...locate(e.time), source: 'dsh-record',
    kind: source.kind === 'skill-catalog' ? 'catalog' : 'explicit-skill-reference',
    name: source.name, entries: source.entries?.map(s => ({ name: s.name, description: s.description })) || [],
  }];
});
// DSH's native skill tool returns skill_content directly. It need not produce a
// separate file read or skill-invocation message, so both evidence paths matter.
for (const t of main.turns) for (const step of t.steps) for (const call of step.calls) {
  if (call.name !== 'skill' || call.status !== 'returned') continue;
  const name = call.result?.text?.match(/<skill_content\s+name="([^"]+)"/)?.[1];
  if (!name) continue;
  skillEvents.push({ id: 'skill-tool:' + call.seq, seq: call.seq, resultSeq: call.resultSeq,
    time: call.end ?? call.start, turn: t.number, step: step.number, name,
    kind: 'skill-tool-load', status: 'returned', source: 'dsh-skill-tool',
    baseDirectory: call.result.text.match(/Base directory for this skill:\s*([^\r\n]+)/)?.[1] || null });
}
skillEvents.sort((a, b) => a.time - b.time || a.seq - b.seq);
const officialRoot = join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session');
const { SurfaceManager } = await import(pathToFileURL(join(officialRoot, 'lib/types/surface.js')));
const contextRequests = JSON.parse(readFileSync(join(root, 'context-data.json'), 'utf8')).requests;
const skillAnalysis = replaySkillEvidence(events, skillEvents.filter(e => e.kind === 'skill-tool-load'), contextRequests.map(r => r.seq), SurfaceManager);
skillAnalysis.version = JSON.parse(readFileSync(join(officialRoot, 'package.json'), 'utf8')).version;
const kind = step => !step.calls.length ? 'reply' : /read|grep|glob/.test(step.calls[0].name) ? 'read' : /edit|write|patch/.test(step.calls[0].name) ? 'write' : /search|query/.test(step.calls[0].name) ? 'query' : 'run';
const agentBranches = events.filter(e => e.type === 'subagent/catalog').map(e => {
  const id = e.data.childId, reports = main.communications.filter(c => c.childId === id).map(c => ({ time: c.time, kind: c.kind === 'subagent-settled' ? 'completed' : 'report', text: c.content.text.slice(0, 5000) }));
  const file = /^[a-zA-Z0-9-]+$/.test(id) ? join(sessionsRoot, id, 'session.v4.jsonl.zstd') : null;
  const child = file && existsSync(file) ? buildTracePayload(loadSession(file).events.filter(e => e.time <= until), id).sessions[0] : null;
  const childCalls = child?.turns.flatMap(t => t.steps.flatMap(s => s.calls)) || [];
  const childFacts = Object.fromEntries(childCalls.map(c => [c.seq, describeCall(c)]));
  const childFiles = childCalls.flatMap(c => {
    const kind = ['read', 'read_image', 'read_file'].includes(c.name) ? 'read' : ['edit', 'write', 'write_file'].includes(c.name) ? 'change' : null;
    return kind && childFacts[c.seq].target ? [{ seq: c.seq, kind, path: childFacts[c.seq].target }] : [];
  });
  const results = child ? collectToolResults(child, childFacts, childFiles) : [];
  const launch = main.turns.flatMap(t => t.steps.flatMap(s => s.calls.map(c => ({ t, s, c })))).find(({ c }) => c.name === 'subagent' && c.result?.text?.includes(id));
  const steps = child?.turns.flatMap(t => t.steps.map(s => ({ id: id + ':' + t.number + ':' + s.number, number: s.number,
    start: s.start, end: s.end, label: s.calls.length ? s.calls.map(c => describeCall(c).title).join(' · ') : '整理回复', kind: kind(s),
    status: s.calls.some(c => c.status === 'error') ? 'error' : 'returned',
    detail: s.calls.map(c => ({ seq: c.seq, name: c.name, target: c.target, status: c.status, outcome: describeCall(c).outcome, result: c.result?.text?.slice(0, 1500) })),
  }))) || [];
  return { id, name: e.data.label || '子代理', title: e.data.label || '子任务', start: e.data.childCreatedAt || e.time,
    end: child?.turns.at(-1)?.end ?? null, returnTime: reports.at(-1)?.time ?? null,
    turn: launch?.t.number ?? locate(e.time).turn, step: launch?.s.number, seq: launch?.c.seq ?? e.seq,
    status: reports.some(r => r.kind === 'completed') ? 'completed' : 'unknown', steps, results, reports, source: 'dsh-record',
  };
});
writeFileSync(join(root, 'actor-data.json'), JSON.stringify({ session: main.id, cutoffSeq: main.lastSeq, skillEvents, skillAnalysis, agentBranches }));
console.log(JSON.stringify({ skills: skillEvents.length, branches: agentBranches.length, childSteps: agentBranches.reduce((n, b) => n + b.steps.length, 0) }));
