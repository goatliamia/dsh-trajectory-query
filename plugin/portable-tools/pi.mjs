import { TOOLS, executeTool } from './tools.mjs';
import { PortableService } from './service.mjs';
import { datasetFromNative } from './sources.mjs';

// No prompt injection, session writes, tool replacement, or full-history watcher.
export default function trajectoryExtension(pi) {
  const sessions = new Map(), timing = new Map();
  function observe(event, ctx) {
    const session = ctx.sessionManager.getSessionId();
    if (!timing.has(session)) timing.set(session, new Map());
    const calls = timing.get(session), list = calls.get(event.toolCallId) || [];
    list.push({ observedAt: Date.now(), event: { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, durationMs: event.durationMs } });
    calls.set(event.toolCallId, list.slice(-2));
    while (calls.size > 2000) calls.delete(calls.keys().next().value);
    while (timing.size > 2) timing.delete(timing.keys().next().value);
  }
  pi.on('tool_execution_start', observe); pi.on('tool_execution_end', observe);
  pi.on('session_shutdown', () => { for (const entry of sessions.values()) entry.service.dispose(); sessions.clear(); timing.clear(); });
  for (const tool of TOOLS) pi.registerTool({ name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
    async execute(_callId, args, signal, _onUpdate, ctx) {
      const id = ctx.sessionManager.getSessionId();
      let entry = sessions.get(id);
      if (!entry) {
        entry = { ctx };
        entry.service = new PortableService({ catalog: () => [{ session: id, host: 'pi', source: 'current selected branch' }], load: async session => {
          if (session && !['current', id].includes(session)) throw Error('Use the current Pi session; bind other files through CLI/MCP');
          const current = entry.ctx, manager = current.sessionManager;
          if (manager.getSessionId() !== id) throw Error('Pi session switched; request a new inspection');
          const entries = manager.getEntries(), active = new Set(pi.getActiveTools());
          const tools = pi.getAllTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters, active: active.has(t.name), exposure: t.exposure, reachesTools: t.reachesTools, source: t.source }));
          const input = { header: { type: 'session', version: 3, id, cwd: current.cwd }, entries, leafId: manager.getLeafId(), capture: [...(timing.get(id)?.values() || [])].flat(),
            source: { name: 'Pi read-only SessionManager', file: manager.getSessionFile() }, scope: { source: 'pi-sdk-current-scope', observedAt: new Date().toISOString(), systemPrompt: current.getSystemPrompt(), tools, model: current.model?.id, provider: current.model?.provider, contextWindow: current.model?.contextWindow ?? null } };
          return datasetFromNative('pi', input);
        } });
        sessions.set(id, entry);
        while (sessions.size > 1) { const old = sessions.keys().next().value; sessions.get(old).service.dispose(); sessions.delete(old); }
      }
      entry.ctx = ctx;
      const result = await executeTool(entry.service, tool.name, args, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { snapshot: result.snapshot, host: 'pi', session: id } };
    },
  });
}
