import { TOOLS, executeTool } from './tools.mjs';
import { PortableService } from './service.mjs';
import { datasetFromNative } from './sources.mjs';
import {generateTraceView} from '../../view/generate.mjs';
import {serveViewFile,openViewBrowser} from '../../view/serve.mjs';

// No prompt injection, session writes, tool replacement, or full-history watcher.
export default function trajectoryExtension(pi) {
  const sessions = new Map(), timing = new Map();
  function viewInput(ctx){
    const manager=ctx.sessionManager,id=manager.getSessionId(),active=new Set(pi.getActiveTools());
    return {header:{type:'session',version:3,id,cwd:ctx.cwd},entries:manager.getEntries(),leafId:manager.getLeafId(),
      capture:[...(timing.get(id)?.values()||[])].flat(),source:{name:'Pi read-only SessionManager',file:manager.getSessionFile()},
      scope:{source:'pi-sdk-current-scope',observedAt:new Date().toISOString(),systemPrompt:ctx.getSystemPrompt(),
        tools:pi.getAllTools().map(t=>({name:t.name,description:t.description,parameters:t.parameters,active:active.has(t.name),exposure:t.exposure,reachesTools:t.reachesTools,source:t.source})),
        model:ctx.model?.id,provider:ctx.model?.provider,contextWindow:ctx.model?.contextWindow??null}};
  }
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
  pi.registerCommand?.('trajectory',{
    description:'打开当前分支的轨迹树视图（路径、上下文、工具与文件）',
    async handler(args,ctx){
      if(args.trim()&&!['--no-open'].includes(args.trim())){ctx.ui.notify('用法：/trajectory [--no-open]','warning');return;}
      try{
        const view=await generateTraceView({host:'pi',input:viewInput(ctx)}),{url}=await serveViewFile(view.output);
        if(args.trim()!=='--no-open')await openViewBrowser(url);
        ctx.ui.notify('轨迹树 · '+url,'info');
      }catch(error){ctx.ui.notify('轨迹树：'+error.message,'error');}
    },
  });
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
          return datasetFromNative('pi', viewInput(current));
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
