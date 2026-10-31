// Preview-only bridge. Components never read these private files. This bridge
// invokes the real registered read-only tools over explicitly bound frozen logs.
import {readFileSync} from 'node:fs';
import {apply} from '../plugin/trajectory-tools/lib/index.js';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {buildInjectionIndex} from '../analyzers/context-evidence.mjs';
export function reportFixture(key){
  if(!['repair','long'].includes(key))throw Error('Unknown frozen report fixture');
  const root='.dsh/diagnostic-pilot/'+key+'/',meta=JSON.parse(readFileSync(root+'meta.json','utf8'));
  const events=readFileSync(root+'events.jsonl','utf8').trim().split('\n').map(JSON.parse);
  let captured={};
  if(key==='long'){
    const page=readFileSync('.dsh/context-trend-study-source.html','utf8'),payload=JSON.parse(page.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    if(payload.mainSession!==meta.session||payload.sessions[0].lastSeq!==events.at(-1).seq)throw Error('Captured context does not match the frozen log cut');
    // Match the installed projection's retained window. Historical backfill is
    // a separate explicit read, not a larger permanent inspection cache.
    const requests=[...payload.context.requests].sort((a,b)=>a.seq-b.seq);
    const bySeq=new Map(events.map(e=>[e.seq,e]));
    if(requests.some(r=>{const event=bySeq.get(r.seq);return event?.type!=='assistant/message'||event.time!==r.time||event.data.turn!==r.turn||event.data.step!==r.step;}))throw Error('Captured context rows do not match the frozen responses');
    captured={contextTimeline:{requests},contextPressure:payload.officialStats.context.pressure,contextBreakdown:payload.officialStats.context.breakdown};
  }
  const tools=new Map(),disposers=[];
  apply({tools:{register(tool){tools.set(tool.name,tool);return()=>{};}},effect(fn){disposers.push(fn());},get(name){
    if(name==='sessionQuery')return {async observeSession(id){if(id!==meta.session)throw Error('Unbound session');return {header:{id,version:4,cwd:meta.cwd},events,source:'persisted',[Symbol.dispose](){}};}};
    // The preview's optional projections are captured at exactly this cut.
    // Intermediate chunks carry no captured projection; no live state is folded.
    if(name==='sessionProjections')return {restore(checkpoint,batch){return {checkpoint:{},snapshot:{asOfSeq:batch.at(-1).seq,values:batch.at(-1).seq===events.at(-1).seq?captured:{}}};}};
  }},{reconcile:false});
  return {session:meta.session,execute:async(name,args,signal)=>{if(!tools.has(name))throw Error('Unknown tool');return tools.get(name).execute({session:meta.session,...args},{signal:signal||new AbortController().signal});},
    async assemblySnapshots({fromTurn=10,toTurn=22}={}){
      const require=createRequire(import.meta.url),sdk=createRequire(require.resolve('@deepseek-ai/dsh-token-meter/package.json'));
      const {SurfaceManager}=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-session/surface')).href);
      const endings=events.filter(e=>e.type==='turn/end'&&e.data.turn>=fromTurn&&e.data.turn<=toTurn);
      if(!endings.length)throw Error('No assembly study turns in the frozen log');
      const index=buildInjectionIndex({session:meta.session,events,SurfaceManager,asOfSeq:endings.at(-1).seq});
      const replacement=index.records.filter(record=>record.replacement&&record.admitted?.turn>=fromTurn&&record.admitted.turn<=toTurn).sort((a,b)=>a.admitted.seq-b.admitted.seq)[0];
      const cuts=[...new Set([...endings.map(e=>e.seq),...(replacement?[replacement.admitted.seq-1,replacement.admitted.seq]:[])])].sort((a,b)=>a-b);
      return cuts.map(cut=>{
        const injections=buildInjectionIndex({session:meta.session,events,SurfaceManager,asOfSeq:cut});
        const header=events.findLast(e=>e.seq<=cut&&e.type==='request/header'),tools=header?.data.header?.tools;
        const step=events.findLast(e=>e.seq<=cut&&e.type==='step/start')?.data||{};
        const label='第 '+step.turn+' 轮 · 第 '+step.step+' 步'+(cut===replacement?.admitted.seq?' · 替换后':cut===replacement?.admitted.seq-1?' · 替换前':' · 轮末');
        return {cut:injections.cut,position:step,label,injections,structure:{headSystemSeq:injections.slots[0]?.role==='system'?injections.slots[0].seq:null,
          headerSeq:header?.seq??null,toolCount:Array.isArray(tools)?tools.length:null,toolsKey:Array.isArray(tools)?createHash('sha256').update(JSON.stringify(tools)).digest('hex'):null}};
      });
    },
    dispose(){for(const fn of disposers)fn?.();}};
}
