// Build the 路径 page the way the Host route builds it and check it is self-consistent.
// This is the offline counterpart of /analysis-view/trace: same payload, same renderer.
//
//   node scripts/check-trace-page.mjs [session.jsonl.zstd]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { loadSession } from '../analyzers/load-session.mjs';
import { renderTracePage } from '../plugin/analysis-view/lib/index.js';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { traceActors, traceContext } from '../plugin/analysis-view/lib/trace-context.js';

const home = process.env.USERPROFILE;
const sessions = resolve(home, '.dsh/sessions/--D-projects-sql~0020event--');
// Default to the session written most recently in this workspace.
const latest = readdirSync(sessions)
  .filter(name => name.startsWith('session-'))
  .map(name => ({ name, at: statSync(resolve(sessions, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at)[0];
const file = process.argv[2] || resolve(sessions, latest.name, 'session.v4.jsonl.zstd');
const log = loadSession(file);
const events = log.events;

const payload = buildTracePayload(events, log.id);
payload.context = traceContext(events, payload);
Object.assign(payload.context, await traceActors(events, payload, payload.context.skillEvents, async childId => {
  try {
    return loadSession(resolve(sessions, childId, 'session.v4.jsonl.zstd')).events;
  } catch {
    return [];
  }
}));

const started = Date.now();
const html = renderTracePage(payload);
const elapsed = Date.now() - started;

// The embedded payload must parse on its own: session text may contain the placeholders.
const open = html.indexOf('<script id="trace-data" type="application/json">');
const close = html.indexOf('</script>', open);
const embedded = html.slice(html.indexOf('>', open) + 1, close);
const parsed = JSON.parse(embedded);
if (parsed.mainSession !== log.id) throw new Error('Embedded payload belongs to another session');
for (const script of html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);

const out = resolve('.dsh/layout-review/trace-page-check.html');
writeFileSync(out, html);
console.log(JSON.stringify({
  session: log.id, turns: parsed.sessions[0].turns.length, events: events.length,
  context: Object.keys(parsed.context), calls: Object.keys(parsed.context.callFacts).length,
  files: parsed.context.fileOperations.length, boundaries: parsed.context.boundaries.length,
  skills: parsed.context.skillEvents.length, branches: parsed.context.agentBranches.length,
  skillRecords: parsed.context.skillAnalysis ? parsed.context.skillAnalysis.records.length : 0,
  bytes: html.length, ms: elapsed, out,
}, null, 2));
