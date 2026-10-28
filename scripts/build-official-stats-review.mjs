import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { loadSession } from '../analyzers/load-session.mjs';

const root = resolve('.dsh/layout-review');
const page = readFileSync(join(root, 'installed-trace.html'), 'utf8');
const trace = JSON.parse(page.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const session = trace.sessions.find(s => s.id === trace.mainSession);
const installed = join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-experimental-client-ui-stats');
const bundle = readFileSync(join(installed, 'lib/client.js'), 'utf8');
let module;
// Execute the installed module unchanged, with no DOM, network, UI mounting or live service.
vm.runInNewContext(bundle, { window: { __ModuleLoader__: { load(value) { module = value; } } } });
const plugin = module.factory(name => {
  if (['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(name)) return {};
  throw new Error('Unexpected fixture UI dependency: ' + name);
});
const definitions = [], views = [];
plugin.apply({ effect() {}, locale: { bind: () => key => key }, slots: { inject() {} },
  uiConversation: { events: { register: d => definitions.push(d) }, views: { register: d => views.push(d) } },
});
const log = loadSession(process.argv[2] || join(process.env.USERPROFILE, '.dsh/sessions/--D-projects-sql~0020event--', session.id, 'session.v4.jsonl.zstd'));
if (log.id !== session.id) throw new Error('Fixture session mismatch');
const events = log.events.filter(e => e.seq <= session.lastSeq);
const selected = definitions.filter(d => ['stats-step', 'stats-turn-end', 'stats-code-mode', 'stats-compaction'].includes(d.kind));
const contexts = new Map(), roots = new Map();
let currentTurn = null, currentStep = null;
for (const event of events) {
  if (event.type === 'turn/start') { currentTurn = event.data.turn; currentStep = null; }
  if (event.type === 'step/start') { currentTurn = event.data.turn; currentStep = event.data.step; }
  if (event.type === 'tool/call') roots.set(event.data.callId, { turn: event.data.turn, step: event.data.step });
  const rootCall = roots.get(event.data?.rootCallId);
  const turn = event.data?.turn ?? rootCall?.turn ?? currentTurn;
  const step = event.data?.step ?? rootCall?.step ?? currentStep;
  const location = turn == null ? { kind: 'unresolved' } : step == null ? { kind: 'turn', turn: { turn } } : { kind: 'step', turn: { turn }, step: { step } };
  for (const definition of selected) {
    const hit = definition.match(event);
    if (!hit) continue;
    const key = definition.kind + ':' + hit.id, match = { ...hit, event, location };
    let context = contexts.get(key);
    if (!context) { context = { key, kind: definition.kind, id: hit.id, matches: [], state: undefined, start: undefined, definition }; contexts.set(key, context); }
    context.matches.push(match);
    if (hit.role === 'start' && !context.start) { context.start = match; context.state = definition.start(context, match); }
    else context.state = definition.update(context, match);
  }
}
const nodes = [...contexts.values()].map(c => c.definition.buildViewNode(c)).filter(Boolean);
const builder = views.find(v => v.target === 'stats').create();
const snapshot = builder.replace({ nodes });
// The standalone preview replays the installed official projection units unchanged.
// In DSH the view reads these finished values through useProjection instead.
const meter = join(installed, '../dsh-token-meter');
const { contextPressureProjectionDefinition: pressureDefinition } = await import(pathToFileURL(join(meter, 'lib/types/usage-projection.js')));
const { contextBreakdownProjectionDefinition: breakdownDefinition } = await import(pathToFileURL(join(meter, 'lib/types/breakdown-projection.js')));
const project = definition => definition.wire.view(events.reduce((state, event) => definition.apply(state, event), definition.init()));
const context = { pressure: project(pressureDefinition), breakdown: project(breakdownDefinition), source: '@deepseek-ai/dsh-token-meter' };
if (snapshot.turns.length !== session.turns.length) throw new Error('Official stats turn coverage mismatch: ' + snapshot.turns.length);
const output = { session: session.id, cutoffSeq: session.lastSeq, source: {
  name: '@deepseek-ai/dsh-experimental-client-ui-stats', version: JSON.parse(readFileSync(join(installed, 'package.json'))).version,
  sha256: createHash('sha256').update(bundle).digest('hex'),
  mode: 'Offline replay through the installed Definitions and stats view builder; no metric formulas copied.',
  definitions: selected.map(d => d.kind),
}, snapshot, context };
writeFileSync(join(root, 'official-stats.json'), JSON.stringify(output));
console.log(JSON.stringify({ turns: snapshot.turns.length, steps: snapshot.stepCount, source: output.source.name, version: output.source.version,
  turn35: snapshot.turns.find(t => t.turn === 35)?.steps.slice(0, 2).map(s => ({ step: s.step, wall: s.wall, tool: s.tool, toolWall: s.toolWall, calls: s.calls.length })) }));
