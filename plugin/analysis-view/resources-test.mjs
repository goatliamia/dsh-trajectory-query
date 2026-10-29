import assert from 'node:assert/strict';
import { TraceResources, TraceQueue } from './lib/trace-resources.js';
import { TraceStages } from './lib/trace-stages.js';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const rows = [{seq:0,type:'turn/start',time:1,data:{turn:1}}, {seq:1,type:'step/start',time:2,data:{turn:1,step:1}},
  {seq:2,type:'assistant/message',time:3,data:{turn:1,step:1,message:{content:[]}}}, {seq:3,type:'step/end',time:4,data:{turn:1,step:1}}, {seq:4,type:'turn/end',time:5,data:{turn:1}}];
const versions = new Map([['a','a1'],['b','b1'],['c','c1'],['d','d1']]);
const services = { sessions:new Map(), sessionPersistence:{async stat(id){return{revision:versions.get(id)}}} };
const ctx = {get:name=>services[name]};
const timeout = async (fn, ms, signal) => { signal?.throwIfAborted(); return fn(signal || new AbortController().signal); };
let reads=0, disposed=0;
const pool=new TraceResources();
const stages=new TraceStages(ctx,{resources:pool,timeout,observe:async id=>{reads++;return{source:'prepared',revision:versions.get(id),events:rows}},dispose(){disposed++}});
try {
  for(const id of ['b','c','d','a']) await stages.stage(await stages.load(id,'assets'),'actors');
  for(let i=2;i<=4;i++){versions.set('a','a'+i);await stages.stage(await stages.load('a','assets'),'actors');}
  assert.equal(pool.entries.size,4,'old cuts and latest-session indices share one count limit');
  assert.ok(stages.latest.size<=pool.entries.size);
  assert.equal(new Set([...pool.entries.values()].map(row=>row.entry)).size,4);
  assert.equal(disposed,reads,'completed actors release every main observation');
} finally {stages.dispose();pool.dispose();}
console.log('PASS one cache budget for historical cuts and latest sessions, without orphaned strong indices');

let now=0, released=0;
const small=new TraceResources({maxEntries:8,maxBytes:600,idleMs:50,now:()=>now});
try {
  small.retain({resourceKey:'one',html:'x'.repeat(200)},()=>released++);
  small.retain({resourceKey:'two',html:'y'.repeat(200)},()=>released++);
  assert.equal(small.entries.size,1);assert.equal(released,1);
  now=40;assert.ok(small.get('two'));
  now=91;assert.equal(small.get('two'),undefined);assert.equal(released,2);
} finally {small.dispose();}
console.log('PASS byte-budget eviction and idle expiration use the same disposer');

const work=new TraceQueue(1), blocking=gate(), cancelled=new AbortController();let ran=false;
const first=work.run(()=>blocking.promise);
const second=work.run(()=>{ran=true},cancelled.signal).catch(error=>error.name);
cancelled.abort();assert.equal(await second,'AbortError');blocking.resolve();await first;await tick();assert.equal(ran,false);work.dispose();
console.log('PASS cancelled queued work never starts');

const sharedPool=new TraceResources(), mainGate=gate();let started=0;
const shared=new TraceStages(ctx,{resources:sharedPool,timeout,observe:async id=>{started++;await mainGate.promise;return{source:'prepared',revision:versions.get(id),events:rows}},dispose(){}});
const left=new AbortController(), right=new AbortController();
try {
  const a=shared.load('a','assets',left.signal,'left').catch(error=>error.name);
  const b=shared.load('a','assets',right.signal,'right');
  await tick();left.abort();assert.equal(await a,'AbortError');mainGate.resolve();
  const entry=await b;assert.equal(started,1,'one departing viewer cannot cancel another viewer');
  assert.equal(entry.viewers.has('right'),true);
  assert.equal(entry.details,undefined,'a core does not automatically launch optional parsing');
  shared.release(entry,'right');assert.equal(sharedPool.entries.size,0,'unused unfinished core is released immediately');
} finally {shared.dispose();sharedPool.dispose();}
console.log('PASS shared consumers, no unsolicited enrichment, and release of an abandoned core');

const cancelledPool=new TraceResources(), childReady=gate();let childAborted=false, lease=0;
const more=[...rows,{type:'subagent/catalog',seq:5,time:6,data:{childId:'child'}}];
const cancelStages=new TraceStages(ctx,{resources:cancelledPool,timeout,observe:async(id,signal)=>{
  if(id!=='child'){lease++;return{source:'prepared',revision:versions.get(id),events:more}}
  childReady.resolve();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{childAborted=true;reject(signal.reason)},{once:true})});
},dispose(){lease--}});
try {
  const entry=await cancelStages.load('a','assets',undefined,'one');cancelStages.view(entry,'two');
  const actors=cancelStages.stage(entry,'actors').catch(error=>error.name);
  await childReady.promise;cancelStages.release(entry,'one');assert.equal(childAborted,false);
  cancelStages.release(entry,'two');assert.equal(await actors,'AbortError');
  assert.equal(childAborted,true);assert.equal(lease,0);
} finally {cancelStages.dispose();cancelledPool.dispose();}
console.log('PASS last-viewer cancellation aborts child work and releases the parent lease');

const historyPool=new TraceResources();let restores=0;
const historyCtx={get:name=>name==='sessionProjections'?{restore(checkpoint,batch){restores++;return{checkpoint:{contextTimeline:{val:{requests:[...(checkpoint.contextTimeline?.val.requests||[]),...batch.filter(e=>e.type==='assistant/message').map(e=>({seq:e.seq,turn:e.data.turn,total:100}))]}}}}}}:services[name]};
const historyStages=new TraceStages(historyCtx,{resources:historyPool,timeout,observe:async()=>({source:'prepared',revision:versions.get('a'),header:{id:'a'},events:[...rows,...rows.map(e=>({...e,seq:e.seq+5,time:e.time+5,data:{...e.data,turn:2}}))]}),dispose(){}});
try {
  const entry=await historyStages.load('a','assets');
  const data=await historyStages.stage(entry,'history',2);
  assert.deepEqual(data.context.historyRequests.map(row=>row.turn),[1]);
  assert.equal((await historyStages.stage(entry,'history',2)),data);assert.equal(restores,1);
  assert.equal(entry.header.id,'a');
} finally {historyStages.dispose();historyPool.dispose();}
console.log('PASS on-demand history uses the official detached restore face and retains one window');
