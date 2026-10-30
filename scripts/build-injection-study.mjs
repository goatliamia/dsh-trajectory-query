// Offline fixture builder. Real excerpts stay under the Git-ignored .dsh/.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadSession } from '../analyzers/load-session.mjs';
import { evidenceCut, readCompositionEvidence, buildInjectionIndex } from '../analyzers/context-evidence.mjs';
import { buildRequestContextIndex, readRequestContextEvidence } from '../analyzers/request-context-evidence.mjs';

const option = name => { const i=process.argv.indexOf(name); return i<0?null:process.argv[i+1]; };
if (!option('--source')) throw Error('Use --source <session.v4.jsonl.zstd>');
const require=createRequire(import.meta.url), sdk=createRequire(require.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const importFile = file => import(pathToFileURL(file).href);
const {SurfaceManager}=await importFile(sdk.resolve('@deepseek-ai/dsh-session/surface'));
const {lastAssistantStreamChunk}=await importFile(sdk.resolve('@deepseek-ai/dsh-llm'));
const meterRoot=dirname(sdk.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const breakdown=await importFile(join(meterRoot,'lib/types/breakdown-projection.js'));
const usage=await importFile(join(meterRoot,'lib/types/usage-projection.js'));
const definitions=[breakdown.contextBreakdownProjectionDefinition,usage.contextPressureProjectionDefinition,usage.tokenUsageProjectionDefinition];
const contextRoot=option('--context-plugin') || join(process.env.USERPROFILE,'.dsh/profiles/web/node_modules/dsh-context');
let contextSource=null;
try {
  const plugin=await importFile(join(contextRoot,'lib/index.js')), found=new Map();
  plugin.apply({fiber:{name:'offline-injection-study'},get(){},inject(){},on(){},effect(){},sessionProjections:{register(d){found.set(d.key,d);return()=>{}}}},{});
  if(found.has('contextTimeline')){
    definitions.push(found.get('contextTimeline'));
    contextSource={name:'dsh-context/contextTimeline',version:JSON.parse(readFileSync(join(contextRoot,'package.json'))).version,
      hash:createHash('sha256').update(readFileSync(join(contextRoot,'lib/index.js'))).digest('hex')};
  }
}catch(error){console.log(JSON.stringify({contextEnrichment:'unavailable',reason:error.message}));}
const started=performance.now(), loaded=loadSession(option('--source')), {events}=loaded;
const full=buildInjectionIndex({session:loaded.id,events,SurfaceManager});
const requestIndex=buildRequestContextIndex({session:loaded.id,events,SurfaceManager,lastAssistantStreamChunk});
const notice=full.records.find(r=>r.producer==='tool-jobs'&&r.admitted);
const runtime=full.records.filter(r=>r.producer==='runtime-context'&&r.admitted);
const canceled=full.records.find(r=>r.presence==='canceled');
const replaced=full.records.find(r=>r.replacement?.meteringSeq!=null);
const latest=full.records.findLast(r=>r.presence==='retained'&&r.producer!=='user'&&r.role!=='system');
const cases=[{id:'latest',title:'最新上下文',subtitle:'完整长对话的最终切点',seq:events.at(-1).seq,selected:latest?.id},
  notice&&{id:'notice',title:'后台通知',subtitle:'一条通知从队列进入上下文',seq:notice.admitted.seq,selected:notice.id},
  runtime.length&&{id:'snapshot',title:'快照更新',subtitle:'具名运行时快照；保留与替换状态单独核对',seq:runtime[Math.min(1,runtime.length-1)].admitted.seq,selected:runtime[Math.min(1,runtime.length-1)].id},
  canceled&&{id:'canceled',title:'取消投递',subtitle:'入队内容被撤回，未正式提交',seq:canceled.queued.exitSeq,selected:canceled.id},
  replaced&&{id:'before',title:'替换之前',subtitle:'同一次替换之前的上下文',seq:replaced.admitted.seq-1,selected:full.records.find(r=>r.admitted?.seq===replaced.replacement.startSeq)?.id,selectedSeq:replaced.replacement.startSeq},
  replaced&&{id:'after',title:'替换之后',subtitle:'相同内容范围被新节点取代',seq:replaced.admitted.seq,selected:replaced.id},
].filter(Boolean);
const out=resolve('.dsh/injection-study'); mkdirSync(out,{recursive:true}); mkdirSync(join(out,'evidence'),{recursive:true});mkdirSync(join(out,'receipts'),{recursive:true});
const meterVersion=JSON.parse(readFileSync(join(meterRoot,'package.json'))).version;
const sources={contextBreakdown:{name:'@deepseek-ai/dsh-token-meter/contextBreakdown',version:meterVersion},
  contextPressure:{name:'@deepseek-ai/dsh-token-meter/contextPressure',version:meterVersion},...(contextSource?{contextTimeline:contextSource}:{})};
const states=new Map(definitions.map(d=>[d.key,d.init()])); let cursor=0;
const evidenceSeqs=new Set();
const receiptSeqs=new Set();
function includeReceiptEvidence(value){
  for(const r of [value.request,value.previous])if(r){
    for(const seq of r.settlementSeqs)evidenceSeqs.add(seq);
    if(r.header)evidenceSeqs.add(r.header.seq);
    for(const replacement of r.logicalChange?.replacements||[])evidenceSeqs.add(replacement.seq);
  }
}
for(const item of [...cases].sort((a,b)=>a.seq-b.seq)){
  while(cursor<=item.seq){const e=events[cursor++];for(const d of definitions)states.set(d.key,d.apply(states.get(d.key),e));}
  const values=Object.fromEntries(definitions.map(d=>[d.key,d.wire.view(states.get(d.key))]));
  const cut=evidenceCut(loaded.id,events,item.seq), composition=readCompositionEvidence({cut,projections:{asOfSeq:item.seq,values},sources});
  const t=performance.now(), index=buildInjectionIndex({session:loaded.id,events,SurfaceManager,asOfSeq:item.seq,nodeCategories:composition.nodeCategories});
  const structureMs=Math.round(performance.now()-t);
  const point=events.slice(0,item.seq+1).findLast(e=>e.type==='step/start');
  const chosen=index.records.find(r=>r.id===item.selected), baseline=readRequestContextEvidence(requestIndex,{contextCut:cut});
  const receipt=readRequestContextEvidence(requestIndex,{contextCut:cut,surfaceSeq:chosen?.admitted?.seq,excluded:chosen?.presence==='canceled'});
  const header=events.slice(0,item.seq+1).findLast(e=>e.type==='request/header'), tools=header?.data.header?.tools;
  const structure={headerSeq:header?.seq??null,toolCount:Array.isArray(tools)?tools.length:null,
    toolNames:(tools||[]).slice(0,8).map(t=>t.name),deferredCount:Array.isArray(tools)?tools.filter(t=>t.deferLoading===true).length:null,
    headSystemSeq:index.slots[0]?.role==='system'?index.slots[0].seq:null};
  const data={id:item.id,title:item.title,subtitle:item.subtitle,selected:item.selected,selectedSeq:item.selectedSeq,cut,position:point?.data||null,composition,injections:index,structure,requestEvidence:receipt,requestBaseline:baseline};
  includeReceiptEvidence(receipt);includeReceiptEvidence(baseline);
  for(const r of index.records){for(const seq of r.evidence)evidenceSeqs.add(seq);if(r.shadowedAt!=null)evidenceSeqs.add(r.shadowedAt);}
  for(const slot of index.slots){evidenceSeqs.add(slot.seq);receiptSeqs.add(slot.seq);}
  for(const record of index.records)if(record.admitted)receiptSeqs.add(record.admitted.seq);
  const raw=Buffer.from(JSON.stringify(data)), compressed=gzipSync(raw,{level:1});
  writeFileSync(join(out,item.id+'.json'),raw);writeFileSync(join(out,item.id+'.json.gz'),compressed);
  item.bytes=raw.length;item.gzipBytes=compressed.length;item.messages=index.slots.length;item.structureMs=structureMs;item.snapshotMs=Math.round(performance.now()-t);
}
for(const seq of receiptSeqs){
  const receipt=readRequestContextEvidence(requestIndex,{contextCut:{session:loaded.id,asOfSeq:seq},surfaceSeq:seq});
  includeReceiptEvidence(receipt);
  writeFileSync(join(out,'receipts',seq+'.json'),JSON.stringify(receipt));
}
for(const seq of evidenceSeqs){
  const event=events[seq], raw=JSON.stringify(event,null,2), max=24000;
  const usage=event.type==='assistant/message'&&event.data.usage!==undefined?event.data.usage:lastAssistantStreamChunk(event.data.stream||[],'usage')?.usage;
  writeFileSync(join(out,'evidence',seq+'.json'),JSON.stringify({seq,type:event.type,
    ...(usage?{facts:{turn:event.data.turn,step:event.data.step,usage}}:{}),raw:raw.slice(0,max),omitted:Math.max(0,raw.length-max)}));
}
const manifest={session:loaded.id,sdkVersion:meterVersion,sourceLabel:'真实长对话 · 原始持久事件',cases,
  records:full.summary,interfaces:{composition:'readCompositionEvidence',injections:'buildInjectionIndex / readInjectionEvidence'},
  note:'离线真实记录。消息位置属于 Harness 逻辑历史，不代表实际 token 位置或模型采纳。'};
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest));
console.log(JSON.stringify({output:out,milliseconds:Math.round(performance.now()-started),cases:cases.map(c=>({id:c.id,cut:c.seq,messages:c.messages,kib:Math.round(c.bytes/1024),gzipKib:Math.round(c.gzipBytes/1024),structureMs:c.structureMs,snapshotMs:c.snapshotMs})),evidenceFiles:evidenceSeqs.size,manifestBytes:statSync(join(out,'manifest.json')).size}));
