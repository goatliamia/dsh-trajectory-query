import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { loadSession } from '../analyzers/load-session.mjs';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { projectOperations } from '../docs/demo/tool-study/model.mjs';
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
const id = 'session-2f91dbd3-1dff-4ea2-af09-f1065a89336b';
const source = option('--source') || join(process.env.USERPROFILE, '.dsh/sessions/--D-projects-math-to-engineering--', id, 'session.v4.jsonl.zstd');
const workspace = option('--workspace') || 'D:/projects/math-to-engineering';
const loaded = loadSession(source), { events } = loaded;
const base = buildTracePayload(events, loaded.id).sessions[0];
const projected = projectOperations(events, { workspace });
const readOptional = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const recent = readOptional('.dsh/perf-staged/context-state.json'), history = readOptional('.dsh/perf-staged/replayed-history.json');
const old = readOptional('.dsh/perf-staged/live-details.json');
const contextRequests = [...(history || []), ...(recent?.requests || [])].sort((a,b) => a.seq - b.seq);
const callsByTurn = new Map();
for (const call of projected.calls) { if (!callsByTurn.has(call.turn)) callsByTurn.set(call.turn, []); callsByTurn.get(call.turn).push(call); }
const turns = base.turns.map(turn => ({ number: turn.number, start: turn.start, end: turn.end, title: turn.title.slice(0,180),
  steps: turn.steps.map(s => ({ number:s.number,start:s.start,end:s.end })), calls: (callsByTurn.get(turn.number) || []).map(c => c.seq) }));
const candidates = turns.map(turn => { const calls = callsByTurn.get(turn.number) || []; return { number:turn.number,steps:turn.steps.length,calls:calls.length, families:new Set(calls.map(c=>c.family)).size,read:calls.some(c=>c.name==='read' && c.status==='returned'),grep:calls.some(c=>c.name==='grep' && c.files.length),write:calls.some(c=>c.family==='write') }; });
const mixed = candidates.filter(t=>t.steps>=3&&t.steps<=8&&t.families>=3&&t.read&&t.grep).sort((a,b)=>a.steps-b.steps||a.number-b.number)[0] || candidates.find(t=>t.grep&&t.read);
const commands = candidates.filter(t=>t.steps>=3&&t.steps<=7&&t.write&&t.families>=3).sort((a,b)=>b.families-a.families||a.steps-b.steps)[0];
const data = { schema:1, id:loaded.id,title:base.title,workspace, counts:{...projected.counts,turns:turns.length,steps:turns.reduce((n,t)=>n+t.steps.length,0),files:projected.files.length},
  presets:{mixed:mixed?.number||1,commands:commands?.number||1}, turns, ...projected, contextRequests,
  current:recent?.head?.current||recent?.current||old?.payload?.context?.current||null };
data.counts = {...data.counts,turns:turns.length,steps:turns.reduce((n,t)=>n+t.steps.length,0),files:projected.files.length};
const out = resolve('.dsh/tool-study');mkdirSync(out,{recursive:true});
writeFileSync(join(out,'session.json'),JSON.stringify(data));
writeFileSync(join(out,'manifest.json'),JSON.stringify({source,session:loaded.id,...data.counts,presets:data.presets,greps:projected.calls.filter(c=>c.name==='grep').length},null,2));
console.log(JSON.stringify({output:out,...data.counts,presets:data.presets,bytes:readFileSync(join(out,'session.json')).length}));
