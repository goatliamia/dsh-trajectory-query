import assert from 'node:assert/strict';
import { InspectionService } from '../plugin/trajectory-tools/lib/inspect-service.js';
import { PortableService } from '../plugin/portable-tools/service.mjs';
import { collectDataset,collectRecords } from './collect.mjs';
import { bindFigure,validateDataset,groupSum } from './contract.mjs';
import { renderFigure } from './components.mjs';
import { reportTable } from '../plugin/trajectory-tools/lib/report-data.js';
import { reportAssets,renderReport } from './render.mjs';
import vm from 'node:vm';

const content=text=>[{type:'text',text}];
const events=[];const add=(type,data)=>{const seq=events.length;events.push({seq,time:1000+seq*100,type,data});return seq;};
add('turn/start',{turn:1});add('step/start',{turn:1,step:1});
const response1=add('assistant/message',{turn:1,step:1,message:{content:content('one')},usage:{inputTokens:8,cacheReadTokens:50,outputTokens:3},stream:[]});
add('step/end',{turn:1,step:1});add('turn/end',{turn:1,reason:{kind:'completed'}});
add('turn/start',{turn:2});add('step/start',{turn:2,step:1});
const response2=add('assistant/message',{turn:2,step:1,message:{content:content('two')},usage:{inputTokens:11,cacheReadTokens:100,outputTokens:4},stream:[]});
add('step/end',{turn:2,step:1});add('turn/end',{turn:2,reason:{kind:'completed'}});
let loads=0;
const contextRows=[response1,response2].map((seq,i)=>({seq,turn:i+1,step:1,time:events[seq].time,system:3,tools:2,user:5,inject:0,skill:0,assistant:i?null:7,tool:9,total:i?null:26}));
const service=new InspectionService({identify:()=> ({id:'log-fixture',events:events.length,minSeq:0,maxSeq:events.at(-1).seq}),load:async()=>{loads++;return {header:{id:'fixture',version:4},events};},ctx:{get:()=>({restore(checkpoint,batch){return {checkpoint:{},snapshot:{values:{contextTimeline:{requests:contextRows}}}};}})}});
try{
 const first=await service.query({session:'fixture',view:'cost',format:'data',limit:1});
 assert.equal(first.rows[0].uncachedInputTokens,8);assert.equal(first.rows[0].cacheWriteTokens,null);
 assert.equal(first.columns.uncachedInputTokens.basis,'reported');assert.ok(first.nextCursor);
 const next=await service.query({cursor:first.nextCursor});assert.equal(next.rows[0].uncachedInputTokens,11);assert.equal(loads,1);
 assert.equal(next.source.snapshot,first.source.snapshot);
 await assert.rejects(()=>service.query({cursor:first.nextCursor,format:'summary'}),/Cursor/);
 await assert.rejects(()=>service.query({snapshot:first.source.snapshot,view:'cost',format:'data',sort:'input'}),/source order/);
 const execute=(_,args)=>service.query(args);
 const full=await collectDataset(execute,{tool:'trajectory_inspect',args:{snapshot:first.source.snapshot,view:'cost'}});
 validateDataset(JSON.parse(JSON.stringify(full)));
 assert.equal(full.source.log,'log-fixture','Log identity survives a JSON/MCP/browser boundary');
 assert.equal(full.rows.length,2);assert.equal(groupSum(full,'turn','uncachedInputTokens').rows[1].uncachedInputTokens,11);
 const ctx=await collectDataset(execute,{tool:'trajectory_inspect',args:{snapshot:first.source.snapshot,view:'context'}});
 assert.equal(ctx.rows[1].assistant,null);assert.equal(ctx.rows[1].total,null);
 assert.match(renderFigure({type:'context',data:'ctx',fields:{x:'turn'}},{ctx}),/缺值留空/);
 assert.throws(()=>groupSum(ctx,'turn','assistant'),/not additive/);
 const mixed=reportTable({source:full.source,kind:'groups',fields:['calls','uncachedInputTokens'],rows:[{id:'one',calls:1,uncachedInputTokens:8},{id:'two',calls:2,uncachedInputTokens:11}]});
 assert.throws(()=>bindFigure({type:'comparison',data:'mixed',rows:['one','two'],series:['calls','uncachedInputTokens']},{mixed}),/same unit/);
 const changed=structuredClone(full);changed.rows[0].evidence[0].log='different';assert.throws(()=>validateDataset(changed),/another source/);
 const drifting=async(_,args)=>{const page=await service.query({...args,limit:1});if(page.offset)page.source.log='changed';return page;};
 await assert.rejects(()=>collectDataset(drifting,{tool:'trajectory_inspect',args:{snapshot:first.source.snapshot,view:'cost'}}),/identity/);
 await assert.rejects(()=>collectDataset(execute,{tool:'trajectory_inspect',args:{snapshot:first.source.snapshot,view:'cost'}},{maxRows:1}),/budget/);
 new vm.Script(reportAssets().runtime);
 const report=renderReport({markdown:'demo',datasets:{use:full,unused:{secret:'NOT_FOR_EXPORT'}},figures:{f:{id:'f',type:'bar',data:'use',fields:{label:'turn',value:'uncachedInputTokens'}}},compile:()=>({blocks:[{html:'<p>[[figure:f]]</p>'}],map:{}})});
 assert.ok(!report.html.includes('NOT_FOR_EXPORT'),'Unused datasets are not silently bundled');
 assert.ok(!report.html.includes("url('/fonts/"),'Offline report embeds its fonts');
}finally{service.dispose();}

// The portable host must not invent TTFT or precise intervals from an API-only
// action. Existing host units remain different from DSH official steps.
const data={host:'codex',session:'portable',logId:'portable-log',fingerprint:'a'.repeat(64),records:[],synthetic:false,
 payload:{sessions:[{turns:[{id:'turn-1',number:1,start:1,end:3,prompts:[],steps:[{number:1,seq:0,assistantSeq:0,start:1,end:3,endObserved:false,calls:[],retries:[]}]}]}],context:{fileOperations:[],skillEvents:[],usage:[],requests:[]},evidence:{context:'visible-text-estimate'}}};
const portable=new PortableService({load:async()=>data});
try{const page=await portable.call('trajectory_inspect',{format:'data',view:'latency'});assert.equal(page.rows[0].wallMs,null);assert.equal(page.columns.ttftMs,undefined);assert.equal(page.columns.wallMs.basis,'observed');}finally{portable.dispose();}
const piData=structuredClone(data);piData.host='pi';piData.session='pi-fixture';piData.logId='pi-log';piData.records=[{seq:1,turn:1,kind:'assistant',body:{message:'original Pi body'}}];piData.payload.context.usage=[{seq:1,turn:1,step:1,usage:{input:8,cacheRead:4,output:5}}];
const pi=new PortableService({load:async()=>piData});
try{const page=await pi.call('trajectory_inspect',{format:'data',view:'cost'});assert.equal(page.rows[0].uncachedInputTokens,8);assert.equal(page.rows[0].cacheWriteTokens,null);assert.equal(page.source.host,'pi');const records=await collectRecords((name,args)=>pi.call(name,args),page.source,[1]);assert.match(records.rows[0].text,/original Pi body/);assert.equal(records.rows[0].omittedCharacters,0);}finally{pi.dispose();}
console.log('Report data: frozen pages, nulls, source identity, units, bounded collection and portable timing semantics passed.');
