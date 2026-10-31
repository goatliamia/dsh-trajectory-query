import {createHash} from 'node:crypto';
import {validateDataset,DATA_SCHEMA} from './contract.mjs';

// Projection only. Values and aggregation semantics belong to the native
// inspection result; report authors never copy numeric arrays into Markdown.
const fields={
 label:['对象','text','observed',r=>r.tool??r.file??r.name??(typeof r.turns==='object'&&r.turns?'第 '+r.turns.from+'–'+r.turns.to+' 轮':'选定范围')],
 turns:['轮次','count','observed',r=>typeof r.turns==='number'?r.turns:undefined],
 steps:['活动步骤','count','observed',r=>r.steps],calls:['工具调用','count','observed',r=>r.calls],
 wallMs:['活动耗时','ms','official',r=>r.official?.wall],ttftMs:['首字等待','ms','official',r=>r.official?.ttft],
 modelMs:['模型耗时','ms','official',r=>r.official?.model],decodeMs:['生成耗时','ms','official',r=>r.official?.decode],
 toolMs:['工具累计耗时','ms','official',r=>r.official?.tool],toolCoveredMs:['工具覆盖时间','ms','official',r=>r.official?.toolWall],
 errors:['工具错误','count','observed',r=>r.errors??r.official?.toolErrors],retries:['请求重试','count','official',r=>r.official?.retries],
 uncachedInputTokens:['未缓存输入','tokens','reported',r=>r.usage?.input],cacheReadTokens:['缓存读取','tokens','reported',r=>r.usage?.cacheRead],
 cacheWriteTokens:['缓存写入','tokens','reported',r=>r.usage?.cacheWrite],outputTokens:['输出','tokens','reported',r=>r.usage?.output],
 cacheHit:['输入缓存比例','ratio','reported',r=>r.usage?.cacheEfficiency],
 returnedCharacters:['返回文本','characters','observed',r=>r.returnedCharacters],
};
const identity=packet=>({host:'dsh',session:packet.scope?.session,snapshot:packet.snapshot,
 log:packet.log?.id??packet.log,cut:packet.scope?.toSeq});
export function summaryDataset(packet,table='summary'){
 if(!['summary','groups'].includes(table))throw Error('Native report table must be summary or groups');
 if(!packet?.summary||!Array.isArray(packet.items)||packet.ok===false)throw Error('Expected a native inspection summary');
 const source={...identity(packet),query:{adapter:'native-inspection/'+table,scope:packet.scope,turns:packet.scope.turns,focus:packet.scope.focus,groupBy:packet.groupBy,view:packet.view}};
 const input=table==='summary'?[{id:'scope',...packet.summary}]:packet.items.map(r=>({...r,
  id:'group:'+(r.tool??r.file??r.name??(r.turns?r.turns.from+':'+r.turns.to:r.turn!=null?r.turn+':'+r.step:r.seq))}));
 if(table==='groups'&&!input.every(r=>r.turns||r.tool||r.file||r.name))throw Error('Choose an existing window/turn/tool/file grouping for the groups table');
 const keys=Object.keys(fields).filter(k=>k==='label'||input.some(r=>fields[k][3](r)!==undefined));
 const columns=Object.fromEntries(keys.map(k=>{const[label,unit,basis]=fields[k];return[k,{label,unit,basis,nullable:true,aggregate:'none'}];}));
 const rows=input.map(r=>({id:r.id,...Object.fromEntries(keys.map(k=>[k,fields[k][3](r)??null])),
  evidence:[...new Set([r.seq,r.endSeq,r.lastSeq,...(r.examples||[]).map(e=>e.seq)].filter(Number.isSafeInteger))].map(seq=>({session:source.session,log:source.log,seq}))}));
 return validateDataset({schema:DATA_SCHEMA,id:createHash('sha256').update(JSON.stringify([source,keys])).digest('hex').slice(0,24),
  source,kind:'inspection-'+table,columns,coverage:{...packet.coverage,nativeSummary:table,
   scope:packet.scope,grouping:packet.groupingNote,units:packet.summary.timingUnit,
   usage:packet.summary.usage?.coverage,unknownSettlements:packet.summary.usage?.unknownSettlements},rows});
}
export async function collectSummaryDataset(execute,query,{signal,maxRows=20000,maxBytes=8*1024*1024}={}){
 if(!['summary','groups'].includes(query.table))throw Error('Native report table must be summary or groups');
 const args={...query.args,format:'summary',limit:10};
 let cursor,first,expected=0,bytes=0;const items=[],seen=new Set();
 do{
  signal?.throwIfAborted();if(cursor&&seen.has(cursor))throw Error('Repeated summary cursor');if(cursor)seen.add(cursor);
  const page=await execute(query.tool,{...args,...(cursor?{cursor}:{})},signal);
  if(page?.ok===false)throw Error(page.error?.message||page.error||'Summary export failed');
  if(page.snapshot!==args.snapshot||page.offset!==expected)throw Error('Summary page does not match its snapshot/offset');
  if(first&&JSON.stringify([identity(page),page.summary,page.groupBy,page.totalEntries])!==JSON.stringify([identity(first),first.summary,first.groupBy,first.totalEntries]))throw Error('Summary identity changed while exporting');
  first ||= page;
  if(query.table==='summary')break;
  if(!Array.isArray(page.items))throw Error('Missing native summary groups');
  bytes+=JSON.stringify(page.items).length*2;
  if(items.length+page.items.length>maxRows||bytes>maxBytes)throw Error('Summary export exceeds its bounded budget');
  items.push(...page.items);expected+=page.items.length;
  // Some native views paginate optional supplemental lists after their items.
  cursor=expected<first.totalEntries?page.nextCursor:null;
  if(expected<first.totalEntries&&(!cursor||!page.items.length))throw Error('Incomplete native summary groups');
 }while(cursor);
 return summaryDataset(query.table==='summary'?first:{...first,items},query.table);
}
