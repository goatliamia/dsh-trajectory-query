import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { evidenceCut, readCompositionEvidence, buildInjectionIndex, readInjectionEvidence, observeContextEvidence } from './context-evidence.mjs';
const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const llm = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const { SurfaceManager } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session/surface')).href);
const user = (kind, value, more = {}) => llm.createUserMessage({source:{kind,...more},content:[{type:'text',text:value}]});
let seq = 0;
const e = (type, data, intent = {}) => ({seq:seq++,time:1000+seq,type,data,...intent});
const queued = user('tool-jobs','same-prefix'.repeat(70)+'A'), canceled = user('agent-instructions','obsolete');
const snapA = user('runtime-context','A',{form:'snapshot',sections:[{name:'sandbox:policy',text:'A'}]});
const snapB = user('runtime-context','B',{form:'snapshot',sections:[{name:'sandbox:policy',text:'B'}]});
const events = [
  e('system/message',{turn:1,step:1,message:llm.createSystemMessage('system')},{surfaceOp:'append'}),
  e('agent/inbox/spliced',{target:'next-step',start:0,inserted:[queued]}),
  e('agent/inbox/spliced',{target:'next-step',start:0,removedCount:1,inserted:[]}),
  e('step/start',{turn:1,step:1}),
  e('user/message',queued,{surfaceOp:'append'}),
  e('user/message',snapA,{surfaceOp:'append'}),
  e('user/message',snapB,{surfaceOp:'append'}),
  e('agent/inbox/spliced',{target:'next-turn',start:0,inserted:[canceled]}),
  e('agent/inbox/spliced',{target:'next-turn',start:0,removedCount:1,inserted:[],outcome:'canceled'}),
  e('user/message',user('user','actual question'),{surfaceOp:'append'}),
  e('compaction/summary',{shadowedRange:{start:4,end:6},shadowedSeqs:[4,5,6],shadowedTokenCount:30}),
  e('user/message',user('compaction','summary'),{surfaceOp:{op:'replace',startSeq:4,endSeq:6},sourceEventSeqs:[4,5,6]}),
];
const build = (rows=events,at=rows.at(-1).seq) => buildInjectionIndex({session:'fixture',events:rows,SurfaceManager,asOfSeq:at});
assert.equal(build(events,1).records.find(r=>r.producer==='tool-jobs').presence,'pending');
assert.equal(build(events,2).records.find(r=>r.producer==='tool-jobs').presence,'claimed-uncommitted');
const admitted=build(events,6), job=admitted.records.find(r=>r.producer==='tool-jobs');
assert.equal(job.queued.seq,1); assert.equal(job.queued.exitSeq,2); assert.equal(job.admitted.seq,4);
assert.equal(job.callerApi,null,'next-step does not manufacture inject/steer identity');
assert.equal(job.payloadChangedOnAdmission,false);
assert.equal(admitted.records.find(r=>r.admitted?.seq===5).laterSnapshotSeq,6);
assert.equal(admitted.records.find(r=>r.admitted?.seq===5).presence,'retained','superseded does not mean physically removed');
assert.equal(admitted.records.find(r=>r.admitted?.seq===6).queued,null,'direct snapshot is not declared lost for lack of queue');
const final=build();
assert.equal(final.records.find(r=>r.producer==='agent-instructions').presence,'canceled');
assert.equal(final.records.find(r=>r.admitted?.seq===4).shadowedAt,11);
assert.equal(final.records.find(r=>r.admitted?.seq===4).presence,'shadowed');
assert.deepEqual(final.slots.map(s=>s.seq),[0,11,9],'replacement order comes from the official surface, not sorted seq');
assert.deepEqual(final.records.find(r=>r.admitted?.seq===11).replacement.sourceEventSeqs,[4,5,6]);
const duplicate=structuredClone(events.slice(0,5));
duplicate[1].data.inserted.push(structuredClone(duplicate[1].data.inserted[0]));
duplicate[2].data.removedCount=2;
const ambiguous=build(duplicate);
assert.equal(ambiguous.records.filter(r=>r.presence==='claimed-uncommitted').length,2);
assert.equal(ambiguous.records.find(r=>r.admitted?.seq===4).queueCorrelation,'ambiguous-message-id');
assert.equal(ambiguous.records.find(r=>r.admitted?.seq===4).queued,null,'duplicate claimed identities cannot choose a delivery path');
assert.equal(final.slots[0].categoryBasis,'role-source-display-only');
const header=events.length;
const declarations=[...events,e('request/header',{turn:2,step:1,header:{tools:[{name:'history_query',description:'Query history',parameters:{type:'object',properties:{}}}]}}),e('developer/message',{turn:2,step:1,headerSeq:header,
  message:llm.createDeveloperMessage({source:{kind:'tool-registry'},content:[{type:'tool-addition',toolName:'history_query'}]})},{surfaceOp:'append'})];
const declaration=build(declarations).records.find(r=>r.producer==='tool-registry');
assert.deepEqual(declaration.declarationHeader,{seq:header,resolved:true});
assert.deepEqual(declaration.toolChanges,[{type:'tool-addition',toolName:'history_query'}]);
assert.ok(declaration.evidence.includes(header),'tool definitions stay owned by their recorded request header');
const changed=structuredClone(events); changed[4].data=structuredClone(changed[4].data); changed[4].data.content[0].text='same-prefix'.repeat(70)+'B';
assert.equal(build(changed,4).records.find(r=>r.producer==='tool-jobs').payloadChangedOnAdmission,true,'same length and excerpt cannot establish equal payload');
const page=readInjectionEvidence(final,{producer:'tool-jobs',limit:1}); page.items[0].producer='mutated';
assert.equal(final.records.find(r=>r.admitted?.seq===4).producer,'tool-jobs');
assert.throws(()=>build(events.slice(2)),/complete contiguous/);
assert.throws(()=>readInjectionEvidence(final,{limit:201}),/page/);
const cut=evidenceCut('fixture',events), projections={asOfSeq:cut.asOfSeq,values:{
  contextPressure:{pressureTokens:1000,projectedTokens:1200,contextWindow:2000},
  contextBreakdown:{systemTokens:10,toolsTokens:20,messageTokens:30},
  contextTimeline:{ok:true,current:{system:1,tools:2,user:3,inject:4,skill:5,assistant:6,tool:7},nodes:[]},
}};
const composition=readCompositionEvidence({cut,projections});
assert.equal(composition.estimate.total,28); assert.equal(composition.occupancy.reportedInputTokens,1000);
assert.equal(composition.occupancy.projectedInputTokens,1200,'reported input, projection and source estimates stay separate');
assert.equal(composition.estimate.source.name,'dsh-context/contextTimeline');
projections.values.contextTimeline.unsupported=true;
assert.equal(readCompositionEvidence({cut,projections}).estimate.total,60,'unsupported enrichment falls back to official breakdown');
const unavailable=readCompositionEvidence({cut,projections:{asOfSeq:cut.asOfSeq,values:{contextBreakdown:{systemTokens:1}}}});
assert.equal(unavailable.available,false);
assert.equal(unavailable.estimate.total,null,'missing data must not become a zero or partial context total');
assert.throws(()=>readCompositionEvidence({cut,projections:{...projections,asOfSeq:0}}),/cut differ/);
let released=0, restores=0;
const ctx={get:name=>name==='sessionQuery'?{async observeSession(id,options){assert.equal(options.projectionMode,'none');return{header:{id},events,cursor:cut.asOfSeq,inheritedEventCount:2,[Symbol.dispose](){released++}}}}:
  name==='sessionProjections'?{restore(checkpoint,batch,floor,header,inherited){restores++;assert.equal(inherited,2);return{checkpoint:{},snapshot:{asOfSeq:batch.at(-1).seq,values:{contextBreakdown:{systemTokens:10,toolsTokens:20,messageTokens:30}}}}}}:undefined};
const observed=await observeContextEvidence(ctx,'fixture',{SurfaceManager});
assert.deepEqual(observed.composition.cut,observed.injections.cut); assert.equal(released,1); assert.equal(restores,1);
await observeContextEvidence(ctx,'fixture',{SurfaceManager,parts:['injections']});
assert.equal(restores,1,'injection-only reads do not run composition projections'); assert.equal(released,2);
const broken={get:name=>name==='sessionProjections'?{restore(){throw Error('projection failed')}}:ctx.get(name)};
const degraded=await observeContextEvidence(broken,'fixture',{SurfaceManager});
assert.equal(degraded.composition.available,false); assert.ok(degraded.composition.coverage.error);
assert.ok(degraded.injections.slots.length); assert.equal(released,3);
console.log('PASS context evidence: native positions, queue/admission/cancellation, payload identity, snapshots vs retention, cut coherence, official estimates, detached reads and lease disposal');
