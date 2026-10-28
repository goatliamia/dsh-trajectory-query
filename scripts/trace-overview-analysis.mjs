// Deterministic execution units. No viewport, prompt summary or model judgment.
const endOf = t => t.end ?? t.steps.at(-1)?.end ?? t.start;
const writes = new Set(['edit','write','apply_patch','multi_edit','write_file']);
const reads = new Set(['read','read_file','read_text_file']);
const serviceConditions = new Set(['SESSION_QUERY_PERSISTENCE_FAILED']);
const reasonNames = {FS_NOT_OBSERVED:'目标文件尚未读取',FS_STALE_VERSION:'文件版本已变化',SESSION_QUERY_PERSISTENCE_FAILED:'历史存储不可用',TOOL_TIMEOUT:'工具调用超时'};
const unique = values => [...new Set(values.filter(Boolean))];
const conditionOf = c => c.error?.code || (/timed out after \d+ms/.test(c.result?.text || '') ? 'TOOL_TIMEOUT' : 'TOOL_ERROR:' + c.name);
const intersects = (a,b) => a.some(v=>b.includes(v));

export function analyzeTraceOverview(session) {
  const episodes=[],facts=[];
  for(const turn of session.turns){
    const calls=turn.steps.flatMap(s=>s.calls).sort((a,b)=>a.seq-b.seq),batches=[];
    for(const step of turn.steps){
      const byCondition=new Map();
      for(const call of step.calls.filter(c=>c.status==='error')){
        const condition=conditionOf(call),family=writes.has(call.name)?'file-change':call.name;
        const key=condition+'|'+(serviceConditions.has(condition)?'shared-service':family)+(condition.startsWith('TOOL_ERROR:')?'|'+(call.signature||call.seq):'');
        if(!byCondition.has(key))byCondition.set(key,{key,condition,family,steps:[step.number],start:step.start,end:step.end,failed:[],pairs:[]});
        const batch=byCondition.get(key);batch.failed.push(call);
        const next=calls.find(n=>call.signature&&n.signature===call.signature&&n.seq>call.resultSeq&&n.status==='returned');
        if(next)batch.pairs.push({failedSeq:call.seq,successSeq:next.seq,successTime:next.end,successStart:next.start});
      }
      batches.push(...byCondition.values());
    }
    const own=[];
    for(const batch of batches){
      const targets=unique(batch.failed.map(c=>c.target)),signatures=unique(batch.failed.map(c=>c.signature));
      const previous=[...own].reverse().find(e=>{
        if(e.key!==batch.key)return false;
        const started=Math.min(...batch.failed.map(c=>c.start));
        const pending=e.failed.filter(c=>{const pair=e.pairs.find(p=>p.failedSeq===c.seq);return !pair||pair.successTime>=started;});
        return pending.length&&(serviceConditions.has(batch.condition)||
          intersects(unique(pending.map(c=>c.target)),targets)||intersects(unique(pending.map(c=>c.signature)),signatures));
      });
      if(previous){
        previous.failed.push(...batch.failed);previous.pairs.push(...batch.pairs);previous.steps.push(...batch.steps);
        previous.end=Math.max(previous.end,batch.end);previous.targets=unique([...previous.targets,...targets]);
        previous.signatures=unique([...previous.signatures,...signatures]);previous.batches++;
      }else own.push({...batch,targets,signatures,batches:1});
    }
    for(const e of own){
      const complete=e.failed.length===e.pairs.length,firstError=Math.min(...e.failed.map(c=>c.end??c.start));
      const resolvedAt=complete?Math.max(...e.pairs.map(p=>p.successTime)):null;
      const readProof=e.failed.map(c=>{
        const pair=e.pairs.find(p=>p.failedSeq===c.seq);
        return pair&&c.target?calls.find(r=>reads.has(r.name)&&r.status==='returned'&&r.target===c.target&&r.seq>c.resultSeq&&r.end<=pair.successStart):null;
      });
      const readConfirmed=complete&&readProof.every(Boolean)&&e.failed.every(c=>c.target);
      const readCalls=readConfirmed?calls.filter(c=>reads.has(c.name)&&c.status==='returned'&&e.targets.includes(c.target)&&c.seq>Math.min(...e.failed.map(c=>c.resultSeq))&&c.end<=Math.max(...e.pairs.map(p=>p.successStart))).map(c=>c.seq):[];
      const modification=e.family==='file-change',operationCount=unique(e.failed.map(c=>c.signature||String(c.seq))).length,successReturnCount=unique(e.pairs.map(p=>p.successSeq)).length;
      const firstLabel=modification?`${operationCount} 处修改受阻`:`${e.failed.length} 次调用报错`;
      const sequence=[{kind:'failure',label:firstLabel,time:firstError,seqs:e.failed.map(c=>c.seq)}];
      if(readConfirmed)sequence.push({kind:'read',label:`读取 ${e.targets.length} 个目标文件`,time:Math.min(...readProof.map(c=>c.start)),seqs:readCalls});
      if(complete)sequence.push({kind:'success',label:modification?`${operationCount} 处原修改随后成功`:`${successReturnCount} 次对应调用返回成功`,time:resolvedAt,seqs:unique(e.pairs.map(p=>p.successSeq))});
      else sequence.push({kind:'unknown',label:e.pairs.length?`${e.pairs.length} 次原调用随后成功，其余待确认`:'未见原调用后续成功',time:endOf(turn),seqs:unique(e.pairs.map(p=>p.successSeq))});
      const summary=readConfirmed?(e.condition==='FS_STALE_VERSION'?'重读后修改成功':'补读后修改成功'):complete?'原调用随后成功':e.pairs.length?'部分后续结果待确认':'后续结果待确认';
      episodes.push({id:`r${turn.number}-s${e.steps[0]}-${episodes.length}`,turn:turn.number,
        condition:e.condition,reason:reasonNames[e.condition]||'工具调用报错',summary,
        steps:unique(e.steps),failureSeqs:e.failed.map(c=>c.seq),pairs:e.pairs,readSeqs:readCalls,targets:e.targets,
        start:e.start,end:e.end,firstError,resolvedAt,complete,readConfirmed,batches:e.batches,
        failedCount:e.failed.length,operationCount,successReturnCount,confirmedCount:e.pairs.length,unconfirmedCount:e.failed.length-e.pairs.length,
        failedCallMs:e.failed.reduce((n,c)=>n+Math.max(0,(c.end??c.start)-c.start),0),
        stepMs:unique(e.steps).reduce((n,num)=>{const s=turn.steps.find(s=>s.number===num);return n+s.end-s.start;},0),
        continuationMs:resolvedAt===null?null:Math.max(0,resolvedAt-firstError),sequence});
    }
    const ownEpisodes=episodes.filter(e=>e.turn===turn.number);
    facts.push({turn:turn.number,durationMs:endOf(turn)-turn.start,calls:turn.calls,steps:turn.steps.length,
      errors:turn.errors,episodeIds:ownEpisodes.map(e=>e.id),episodeCount:ownEpisodes.length,
      unconfirmedCount:ownEpisodes.reduce((n,e)=>n+e.unconfirmedCount,0),confirmedCount:ownEpisodes.reduce((n,e)=>n+e.confirmedCount,0),
      continuationMs:Math.max(0,...ownEpisodes.map(e=>e.continuationMs||0)),
      retryCount:turn.steps.reduce((n,s)=>n+s.retries.length,0),stop: ['aborted','interrupted','error'].includes(turn.reason?.kind)?turn.reason.kind:null,
      summary:ownEpisodes.length===1?ownEpisodes[0].summary:ownEpisodes.length>1?(ownEpisodes.every(e=>e.complete)?`${ownEpisodes.length} 段受阻，均有后续成功`:`${ownEpisodes.length} 段受阻，部分结果待确认`):''});
  }
  const errorOrder=facts.filter(f=>f.errors).sort((a,b)=>
    Number(b.unconfirmedCount>0)-Number(a.unconfirmedCount>0)||
    Number(b.episodeCount>1)-Number(a.episodeCount>1)||b.errors-a.errors||b.continuationMs-a.continuationMs||a.turn-b.turn);
  const durationOrder=[...facts].sort((a,b)=>b.durationMs-a.durationMs||a.turn-b.turn).slice(0,3);
  const interruptionOrder=facts.filter(f=>f.stop||f.retryCount).sort((a,b)=>Number(!!b.stop)-Number(!!a.stop)||b.retryCount-a.retryCount||a.turn-b.turn);
  return {rulesVersion:1,episodes,turns:facts,focus:{failures:errorOrder.map(f=>f.turn),duration:durationOrder.map(f=>f.turn),interruptions:interruptionOrder.map(f=>f.turn)},
    totals:{episodes:episodes.length,errorTurns:errorOrder.length,confirmedTurns:errorOrder.filter(f=>!f.unconfirmedCount).length,unconfirmedTurns:errorOrder.filter(f=>f.unconfirmedCount).length}};
}
