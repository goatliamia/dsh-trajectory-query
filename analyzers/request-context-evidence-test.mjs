import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { requestUsageEvidence, buildRequestContextIndex, readRequestContextEvidence } from './request-context-evidence.mjs';
const require=createRequire(import.meta.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const llm=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const {SurfaceManager}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session/surface')).href);
const user=text=>llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text}]});
const assistant=text=>llm.createAssistantMessage({source:{kind:'model',provider:'test',model:'m'},content:[{type:'text',text}]});
let n=0;
const e=(type,data,extra={})=>({seq:n++,time:1000+n,type,data,...extra});
const usage=(input,cache,write=0)=>({inputTokens:input,cacheReadTokens:cache,cacheWriteTokens:write,outputTokens:20,totalTokens:input+cache+write+20});
const events=[
  e('system/message',{turn:1,step:1,message:llm.createSystemMessage('system')},{surfaceOp:'append'}),
  e('request/header',{turn:1,step:1,header:{tools:[]}}),
  e('step/start',{turn:1,step:1}),
  e('user/message',user('Q'),{surfaceOp:'append'}),
  e('assistant/message',{turn:1,step:1,message:assistant('A'),stream:[],usage:usage(100,900)},{surfaceOp:'append'}),
  e('step/start',{turn:1,step:2}),
  e('user/message',user('notice'),{surfaceOp:'append'}),
  e('assistant/message',{turn:1,step:2,message:assistant('B'),stream:[],usage:usage(200,1000)},{surfaceOp:'append'}),
  e('user/message',user('Q summary'),{surfaceOp:{op:'replace',startSeq:3,endSeq:3},sourceEventSeqs:[3]}),
  e('step/start',{turn:1,step:3}),
  e('assistant/attempt',{turn:1,step:3,stream:[{type:'chunk',time:1011,chunk:{type:'usage',usage:usage(1000,200)}}]}),
  e('llm/retry-started',{turn:1,step:3}),
  e('assistant/message',{turn:1,step:3,message:assistant('C'),stream:[],usage:usage(100,1200)},{surfaceOp:'append'}),
];
const build=rows=>buildRequestContextIndex({session:'fixture',events:rows,SurfaceManager,lastAssistantStreamChunk:llm.lastAssistantStreamChunk});
const index=build(events);
assert.equal(index.requests.length,4,'explicit retry gets another settlement group');
const append=readRequestContextEvidence(index,{contextCut:{session:'fixture',asOfSeq:6},surfaceSeq:6});
assert.equal(append.relation,'first-observed-input'); assert.equal(append.receiptAfterContextCut,true);
assert.equal(append.request.settlementSeq,7); assert.equal(append.request.usage.cacheRate,1000/1200);
assert.equal(append.request.logicalChange.appendOnly,true); assert.equal(append.request.logicalChange.unchangedPrefixMessages,2);
const replaced=readRequestContextEvidence(index,{contextCut:{session:'fixture',asOfSeq:8},surfaceSeq:8});
assert.equal(replaced.request.settlementSeq,10); assert.equal(replaced.request.logicalChange.firstChangedOrdinal,1);
assert.equal(replaced.request.logicalChange.replacementCount,1); assert.equal(replaced.request.usage.source,'assistant/attempt.data.stream:last-usage');
assert.equal(replaced.request.usage.cacheRate,200/1200);
const canceled=readRequestContextEvidence(index,{contextCut:{session:'fixture',asOfSeq:6},excluded:true});
assert.equal(canceled.relation,'not-admitted'); assert.equal(canceled.request.settlementSeq,4,'cancellation does not inherit a future receipt as exposure');
const noFuture=readRequestContextEvidence(build(events.slice(0,7)),{contextCut:{session:'fixture',asOfSeq:6},surfaceSeq:6});
assert.equal(noFuture.relation,'no-observed-input');
assert.equal(requestUsageEvidence({inputTokens:1,cacheReadTokens:9}).cacheRate,null,'unknown cache-write and aggregate totals cannot become a full prompt rate');
assert.equal(requestUsageEvidence({inputTokens:1,cacheReadTokens:9,outputTokens:2,totalTokens:12}).cacheRate,.9,'authoritative aggregate can supply denominator without inventing missing buckets');
assert.equal(requestUsageEvidence({...usage(1,9),totalTokens:99}).cacheRate,null,'inconsistent aggregate is not a valid rate');
assert.equal(requestUsageEvidence({inputTokens:100,cacheReadTokens:9,outputTokens:2,totalTokens:12}).cacheRate,null,'partial fields cannot exceed an authoritative denominator');
const repeated=[...events.slice(0,11),{...events[10],seq:11}];
assert.equal(build(repeated).requests.length,3,'repeat settlements in one slot replace rather than double-count');
assert.throws(()=>readRequestContextEvidence(index,{contextCut:{session:'wrong',asOfSeq:6}}),/mismatch/);
assert.throws(()=>readRequestContextEvidence(index,{contextCut:{session:'fixture',asOfSeq:6},surfaceSeq:8}),/outside/);
console.log('PASS request context evidence: disjoint usage, missing counters, exact surface prefix, first exposure, canceled input, retries, stream usage and retrospective cuts');
