// Run the installed official stats definitions unchanged, without mounting UI.
// Absence/incompatible definitions are reported by the caller, never replaced
// by a second timing/token formula. This is also the standalone demo's reader.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/estimate';

let units;
function definitions() {
  if (units) return units;
  const require = createRequire(import.meta.url);
  let path;
  try { path = require.resolve('@deepseek-ai/dsh-experimental-client-ui-stats/client'); }
  catch { path = createRequire(require.resolve('@deepseek-ai/dsh-token-meter/package.json')).resolve('@deepseek-ai/dsh-experimental-client-ui-stats/client'); }
  const source = readFileSync(path, 'utf8');
  let module;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value; } } } }, { timeout: 2000 });
  if (!module?.factory) throw Error('Official stats module registration changed');
  const plugin = module.factory(name => {
    if (['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(name)) return {};
    throw Error('Unsupported official stats dependency: ' + name);
  });
  const events = [], views = [];
  plugin.apply({ effect() {}, locale: { bind: () => key => key }, slots: { inject() {} },
    uiConversation: { events: { register: d => events.push(d) }, views: { register: d => views.push(d) } } });
  const selected = events.filter(d => ['stats-step', 'stats-turn-end', 'stats-code-mode', 'stats-compaction'].includes(d.kind));
  const view = views.find(v => v.target === 'stats');
  if (selected.length !== 4 || !view) throw Error('Official stats definition contract changed');
  units = { selected, view, hash: createHash('sha256').update(source).digest('hex') };
  return units;
}

export function replayOfficialStats(events) {
  const { selected, view, hash } = definitions(), contexts = new Map(), roots = new Map();
  let turn = null, step = null;
  for (const event of events) {
    const d = event.data || {};
    if (event.type === 'turn/start') { turn = d.turn; step = null; }
    if (event.type === 'step/start') { turn = d.turn; step = d.step; }
    if (event.type === 'tool/call') roots.set(d.callId, { turn: d.turn, step: d.step });
    const root = roots.get(d.rootCallId), t = d.turn ?? root?.turn ?? turn, s = d.step ?? root?.step ?? step;
    const location = t == null ? { kind: 'unresolved' } : s == null ? { kind: 'turn', turn: { turn: t } } : { kind: 'step', turn: { turn: t }, step: { step: s } };
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
  return { source: '@deepseek-ai/dsh-experimental-client-ui-stats', hash, snapshot: view.create().replace({ nodes }) };
}

export { estimateToolsTokens };
