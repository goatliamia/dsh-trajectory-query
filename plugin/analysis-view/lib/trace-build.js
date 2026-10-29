// 会话事件 → 「执行路径」页面需要的数据。判定与聚合都是确定性的,不调模型。
import { createHash } from 'node:crypto';

// The demo uses execution history, not the current compacted message surface.
// A replacement result belongs to an old call: counting it again fabricates duration.
const isReplacement = e => e.surfaceOp && typeof e.surfaceOp === 'object';
const key = (turn, step, id) => JSON.stringify([turn, step, id]);
const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const excerpt = (text, limit = 1800) => {
  const value = String(text || ''), part = value.slice(0, limit);
  // A V8 sliced string can otherwise keep a multi-megabyte tool result alive
  // through a tiny cached excerpt. UTF-16 preserves even a split surrogate.
  return { text: value.length > limit * 4 ? Buffer.from(part, 'utf16le').toString('utf16le') : part, omitted: Math.max(0, value.length - limit) };
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const argumentSignature = (name, args) => {
  let normalized;
  try { normalized = JSON.stringify(canonical(typeof args === 'string' ? JSON.parse(args) : args)); }
  catch { normalized = String(args ?? ''); }
  return createHash('sha256').update(name + '\0' + normalized).digest('hex');
};
const argumentTarget = args => {
  try {
    const value=typeof args==='string'?JSON.parse(args):args;
    const target=value?.file_path??value?.path??value?.filePath;
    if(typeof target!=='string')return null;
    const normalized=target.replace(/\\+/g,'/').replace(/\/+/g,'/');
    return /^[A-Za-z]:\//.test(normalized)?normalized.toLowerCase():normalized;
  } catch { return null; }
};
const argumentText = args => typeof args === 'string' ? args : JSON.stringify(args ?? {});
const codeMode = name => /^run_?code$/i.test(name || '');

export function projectSession(rows, source = {}) {
  const header = rows.find(e => e.type === 'session');
  if (!header) throw new Error('Missing session header');
  if (header.version !== 4) throw new Error('Use a normalized session.v4.jsonl.zstd source');
  const events = rows.filter(e => Number.isFinite(e.seq)).sort((a, b) => a.seq - b.seq);
  const turns = [], turnIndex = new Map(), steps = new Map(), calls = new Map();
  const roots = new Map(), dispatches = new Map(), hasChildren = new Set();
  const diagnostics = { replacementEventsExcluded: 0, unmatchedResults: 0, duplicateResults: 0, unresolvedCalls: 0 };
  let currentTurn;
  const getStep = (turn, step) => steps.get(key(turn, step, 'step'));
  for (const e of events) {
    const d = e.data || {};
    if (isReplacement(e)) { diagnostics.replacementEventsExcluded++; continue; }
    if (e.type === 'turn/start') {
      currentTurn = { number: d.turn, seq: e.seq, start: e.time, end: null, endSeq: null, reason: null, prompts: [], steps: [], markers: [] };
      turns.push(currentTurn); turnIndex.set(d.turn, currentTurn);
      continue;
    }
    if (e.type === 'tool/ptc-dispatch-start' || e.type === 'tool/ptc-dispatch') {
      const root = roots.get(d.rootCallId);
      if (!root || !d.subCallId || !d.name) continue;
      const dispatchId = JSON.stringify([d.rootCallId, d.subCallId]);
      let call = dispatches.get(dispatchId);
      if (call?.resultSeq != null) { diagnostics.duplicateResults++; continue; }
      if (!call) {
        call = { id: d.subCallId, seq: e.seq, name: d.name, signature: argumentSignature(d.name, d.arguments),
          target: argumentTarget(d.arguments), args: excerpt(argumentText(d.arguments), 6000), start: e.time,
          end: null, resultSeq: null, status: 'unknown', error: null, result: null, inner: true,
          rootSeq: root.call.seq, startSeq: e.type === 'tool/ptc-dispatch-start' ? e.seq : null };
        root.step.calls.push(call); dispatches.set(dispatchId, call);
      }
      hasChildren.add(d.rootCallId); hasChildren.add(d.parentCallId);
      if (e.type === 'tool/ptc-dispatch') {
        Object.assign(call, { seq: e.seq, name: d.name, signature: argumentSignature(d.name, d.arguments),
          target: argumentTarget(d.arguments), args: excerpt(argumentText(d.arguments), 6000), end: e.time,
          resultSeq: e.seq, status: d.isError || d.error ? 'error' : 'returned', error: d.error || null,
          result: excerpt(textOf(d.content), 8000) });
      }
      continue;
    }
    const turn = turnIndex.get(d.turn) || currentTurn;
    if (!turn) continue;
    if (e.type === 'user/message' && d.source?.kind === 'user') {
      const text = textOf(d.content).trim();
      if (text) turn.prompts.push({ seq: e.seq, time: e.time, ...excerpt(text, 2600) });
    } else if (e.type === 'step/start') {
      const step = { number: d.step, seq: e.seq, start: e.time, end: null, endSeq: null, assistantSeq: null, assistantTime: null, reply: null, calls: [], retries: [], markers: [], inTok: null, cacheTok: null, outTok: null };
      turn.steps.push(step); steps.set(key(d.turn, d.step, 'step'), step);
    } else if (e.type === 'step/end') {
      const step = getStep(d.turn, d.step);
      if (step) { step.end = e.time; step.endSeq = e.seq; }
    } else if (e.type === 'assistant/message') {
      const step = getStep(d.turn, d.step);
      if (step) {
        step.assistantSeq = e.seq; step.assistantTime = e.time;
        if (d.usage && typeof d.usage === 'object') {
          if (typeof d.usage.inputTokens === 'number') step.inTok = (step.inTok || 0) + d.usage.inputTokens;
          if (typeof d.usage.cacheReadTokens === 'number') step.cacheTok = d.usage.cacheReadTokens;
          if (typeof d.usage.outputTokens === 'number') step.outTok = (step.outTok || 0) + d.usage.outputTokens;
        }
        const text = textOf(d.message?.content).trim();
        if (text) step.reply = excerpt(text, 2000);
      }
    } else if (e.type === 'tool/call') {
      const step = getStep(d.turn, d.step);
      if (!step) throw new Error(`Call outside a step at seq ${e.seq}`);
      const id = key(d.turn, d.step, d.callId);
      if (calls.has(id)) throw new Error(`Duplicate call at seq ${e.seq}`);
      const call = { id: d.callId, seq: e.seq, name: d.name, signature: argumentSignature(d.name, d.arguments), target: argumentTarget(d.arguments), args: excerpt(argumentText(d.arguments), 2200), start: e.time, end: null, resultSeq: null, status: 'unknown', error: null, result: null };
      step.calls.push(call); calls.set(id, call); roots.set(d.callId, { call, step });
    } else if (e.type === 'tool/result') {
      const id = d.message?.toolCallId ?? d.message?.source?.callId ?? d.callId;
      const call = calls.get(key(d.turn, d.step, id));
      if (!call) { diagnostics.unmatchedResults++; continue; }
      if (call.resultSeq !== null) { diagnostics.duplicateResults++; continue; }
      if (e.time < call.start) throw new Error(`Result predates call ${id}`);
      call.end = e.time; call.resultSeq = e.seq;
      call.status = d.error || d.message?.isError ? 'error' : 'returned';
      call.error = d.error || null; call.result = excerpt(textOf(d.message?.content), 2400);
    } else if (e.type === 'llm/retry') {
      const step = getStep(d.turn, d.step);
      if (step) step.retries.push({ seq: e.seq, time: e.time, delayMs: d.delayMs, failure: d.failure });
    } else if (['compaction/start', 'compaction/end', 'subagent/catalog'].includes(e.type)) {
      const marker = { type: e.type, seq: e.seq, time: e.time, childId: d.childId, label: d.label };
      turn.markers.push(marker);
      const step = turn.steps.at(-1); if (step) step.markers.push(marker);
    } else if (e.type === 'turn/end') {
      turn.end = e.time; turn.endSeq = e.seq; turn.reason = d.reason;
    }
  }
  for (const turn of turns) {
    for (const step of turn.steps) {
      // Match official statistics: unwrap Code Mode only when native child
      // events exist. Keep a wrapper's own recorded failure and pure code runs.
      step.calls = step.calls.filter(call => !codeMode(call.name) || !hasChildren.has(call.id) || call.status === 'error').sort((a, b) => a.seq - b.seq);
      step.endObserved = step.end !== null;
      if (step.end === null) step.end = Math.max(step.start, step.assistantTime || step.start, ...step.calls.map(c => c.end || c.start));
      if (step.end < step.start) throw new Error('Negative step duration');
      step.errors = step.calls.filter(c => c.status === 'error').length;
      diagnostics.unresolvedCalls += step.calls.filter(c => c.end === null).length;
    }
    turn.calls = turn.steps.reduce((n, s) => n + s.calls.length, 0);
    turn.errors = turn.steps.reduce((n, s) => n + s.errors, 0);
    turn.title = turn.prompts[0]?.text || (turn.reason?.kind === 'aborted' ? '本轮被停止' : '继续执行');
  }
  const title = events.filter(e => e.type === 'session/title').at(-1)?.data?.title || header.id;
  const communications = events.filter(e => !isReplacement(e) && e.type === 'user/message' && ['agent-message', 'team-message', 'subagent-settled'].includes(e.data?.source?.kind)).map(e => ({
    seq: e.seq, time: e.time, kind: e.data.source.kind, childId: e.data.source.senderSessionId || e.data.source.senderId || null,
    content: excerpt(textOf(e.data.content), 1800),
  }));
  return { id: header.id, title, parentSession: header.parentSession || null, source, firstSeq: events[0]?.seq, lastSeq: events.at(-1)?.seq, eventCount: events.length, diagnostics, turns, communications,
    totals: { turns: turns.length, steps: turns.reduce((n, t) => n + t.steps.length, 0), calls: turns.reduce((n, t) => n + t.calls, 0), errors: turns.reduce((n, t) => n + t.errors, 0) } };
}

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
  // 同签名后续成功是热点:每个失败调用原来都要线性扫一遍全部调用,先按签名建索引。
  const successBySignature=new Map();
  for(const c of calls) if(c.status==='returned'&&c.signature){
    const bucket=successBySignature.get(c.signature);
    if(bucket===undefined) successBySignature.set(c.signature,[c]); else bucket.push(c);
  }
    for(const step of turn.steps){
      const byCondition=new Map();
      for(const call of step.calls.filter(c=>c.status==='error')){
        const condition=conditionOf(call),family=writes.has(call.name)?'file-change':call.name;
        const key=condition+'|'+(serviceConditions.has(condition)?'shared-service':family)+(condition.startsWith('TOOL_ERROR:')?'|'+(call.signature||call.seq):'');
        if(!byCondition.has(key))byCondition.set(key,{key,condition,family,steps:[step.number],start:step.start,end:step.end,failed:[],pairs:[]});
        const batch=byCondition.get(key);batch.failed.push(call);
        const bucket=call.signature===undefined?undefined:successBySignature.get(call.signature);
      const next=bucket===undefined?undefined:bucket.find(n=>n.seq>call.resultSeq);
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

/** 把同一场会话的事件投影成页面数据(主会话;子会话暂不展开)。 */
export function buildTracePayload(events, sessionId, source = {}) {
  const rows = [{ type: "session", id: sessionId, version: 4, parentSession: null }, ...(events || [])];
  const session = projectSession(rows, { session: sessionId, ...source });
  session.overview = analyzeTraceOverview(session);
  return { schema: 1, generatedAt: new Date().toISOString(), mainSession: session.id, sessions: [session] };
}
