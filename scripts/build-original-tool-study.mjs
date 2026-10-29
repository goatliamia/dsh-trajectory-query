// Reuse the installed renderer byte-for-byte, with preview-only tool semantics.
// No plugin asset, DSH configuration or running component is changed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadSession } from '../analyzers/load-session.mjs';
import { projectOperations } from '../docs/demo/tool-study/model.mjs';
import { analyzeTraceOverview } from '../plugin/analysis-view/lib/trace-build.js';
import { describeCall } from '../docs/demo/layout-review/step-insight.mjs';
import { renderTracePage } from '../plugin/analysis-view/lib/index.js';
const fixture = readFileSync('.dsh/perf-staged/current-trace.html','utf8');
const payload = JSON.parse(fixture.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const id=payload.mainSession, source=join(process.env.USERPROFILE,'.dsh/sessions/--D-projects-math-to-engineering--',id,'session.v4.jsonl.zstd');
const {events}=loadSession(source), bySeq=new Map(events.map(e=>[e.seq,e]));
const projection=projectOperations(events,{workspace:'D:/projects/math-to-engineering'});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const session=payload.sessions.find(s=>s.id===id),byStep=new Map();
for(const operation of projection.calls){
  const native=bySeq.get(operation.seq),args=native?.data?.arguments;
  const hash=createHash('sha256').update(operation.name+'\0'+JSON.stringify(canonical(typeof args==='string'?JSON.parse(args):args||{}))).digest('hex');
  const target=['read','write'].includes(operation.family)?operation.files[0]?.path:null;
  const call={id:operation.id,seq:operation.seq,name:operation.name,nativeName:operation.name,signature:hash,target:target||null,
    args:{text:operation.args,omitted:operation.argsOmitted},result:{text:operation.text,omitted:operation.textOmitted},start:operation.start??operation.end,end:operation.end,
    resultSeq:operation.resultSeq,status:operation.status==='pending'?'unknown':operation.status,error:operation.error||null,
    inner:operation.inner,rootSeq:operation.rootSeq,startSeq:operation.startSeq};
  const key=operation.turn+':'+operation.step;if(!byStep.has(key))byStep.set(key,[]);byStep.get(key).push(call);
}
// Keep outer Code Mode errors as their own recorded failures when the wrapper
// itself failed after invoking children. Parent and child event IDs stay distinct.
for(const turn of session.turns)for(const step of turn.steps){
  const calls=byStep.get(turn.number+':'+step.number)||[];
  for(const old of step.calls)if(old.status==='error'&&!calls.some(c=>c.seq===old.seq))calls.push(old);
  step.calls=calls.sort((a,b)=>a.seq-b.seq);step.errors=calls.filter(c=>c.status==='error').length;
}
for(const turn of session.turns){turn.calls=turn.steps.reduce((n,s)=>n+s.calls.length,0);turn.errors=turn.steps.reduce((n,s)=>n+s.errors,0);}
session.totals.calls=session.turns.reduce((n,t)=>n+t.calls,0);session.totals.errors=session.turns.reduce((n,t)=>n+t.errors,0);
session.diagnostics.unresolvedCalls=session.turns.flatMap(t=>t.steps.flatMap(s=>s.calls)).filter(c=>c.status==='unknown').length;
session.overview=analyzeTraceOverview(session);
const operations=new Map(projection.calls.map(c=>[c.seq,c]));
const facts={};
for(const turn of session.turns)for(const step of turn.steps)for(const call of step.calls){
  const operation=operations.get(call.seq),fact=describeCall(call);
  facts[call.seq]=operation?{...fact,title:operation.title+(operation.subject?' · '+operation.subject:''),outcome:operation.summary,
    tone:call.status==='error'?'bad':call.status==='unknown'?'unknown':'normal',study:{family:operation.family,subject:operation.subject,files:operation.files,metrics:operation.metrics,search:operation.search}}:fact;
}
const fileOperations=projection.calls.flatMap(call=>call.files.map(file=>({
  turn:call.turn,step:call.step,seq:call.seq,resultSeq:call.resultSeq,time:call.end??call.start,kind:file.access==='write'?'change':'read',path:file.path,
  tool:call.name,status:call.status==='pending'?'unknown':call.status,access:file.access,matchLines:file.lines?.length||0,recordedPath:false,
})));
const requests=JSON.parse(readFileSync('.dsh/perf-staged/context-state.json')).requests;
const history=JSON.parse(readFileSync('.dsh/perf-staged/replayed-history.json'));
payload.context={...payload.context,callFacts:facts,fileOperations,requests:[...history,...requests].sort((a,b)=>a.seq-b.seq)};
delete payload.context.historyRequests;delete payload.traceStage;delete payload.traceLoad;
const meter=join(process.env.APPDATA,'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/types');
const {contextPressureProjectionDefinition:pressure}=await import(pathToFileURL(join(meter,'usage-projection.js')));
const {contextBreakdownProjectionDefinition:breakdown}=await import(pathToFileURL(join(meter,'breakdown-projection.js')));
const project=def=>def.wire.view(events.reduce((state,event)=>def.apply(state,event),def.init()));
payload.officialStats={context:{pressure:project(pressure),breakdown:project(breakdown)}};
payload.toolStudy={presets:{mixed:65,commands:113},counts:projection.counts};
const seam="  $('review-return').onclick=reviewReturnOverview;";
let renderer=readFileSync('plugin/analysis-view/lib/trace/page.js','utf8');
if(!renderer.includes(seam))throw Error('Original renderer boot seam changed');
renderer=renderer.replace(seam,()=>readFileSync('docs/demo/tool-study/original-overlay.js','utf8')+'\n'+seam);
let template=readFileSync('plugin/analysis-view/lib/trace/page.html','utf8');
template=template.replace('</head>','<style>'+readFileSync('docs/demo/tool-study/original-overlay.css','utf8')+'</style></head>');
const html=renderTracePage(payload,{template,renderer});
const out=resolve('.dsh/tool-study');mkdirSync(out,{recursive:true});writeFileSync(join(out,'original.html'),html);
writeFileSync(join(out,'original-data.json'),JSON.stringify(payload));
console.log(JSON.stringify({output:join(out,'original.html'),turns:session.turns.length,calls:session.totals.calls,files:fileOperations.length,bytes:Buffer.byteLength(html)}));
