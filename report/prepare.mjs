import {validateDataset,COMPONENTS} from './contract.mjs';
import {collectDataset,collectRecords} from './collect.mjs';
import {assemblyFromContextSnapshots} from './assembly-data.mjs';

const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
export function describeReportData(bundle){
  return {schema:'trajectory-report-catalog/1',datasets:Object.fromEntries(Object.entries(bundle.datasets).map(([alias,data])=>{
    const positions=[...new Set([0,1,data.rows.length-1])].filter(i=>i>=0&&i<data.rows.length);
    const summary=data.kind.startsWith('inspection-');
    const examples=positions.map(i=>Object.fromEntries(Object.entries(data.rows[i]).filter(([key])=>['id','turn','step','asOfSeq','label'].includes(key)||summary&&key!=='evidence')));
    const width=data.kind==='records'?Math.min(500,Math.floor(6000/Math.max(1,data.rows.length))):0;
    const excerpts=width?data.rows.map(row=>({id:row.id,turn:row.turn,text:(row.text||'').slice(0,width),omittedCharacters:(row.omittedCharacters||0)+Math.max(0,(row.text||'').length-width),read:row.evidence?.[0]?.read})):undefined;
    return [alias,{id:data.id,kind:data.kind,rows:data.rows.length,source:data.source,columns:data.columns,coverage:data.coverage,examples,...(excerpts?{excerpts}:{})}];
  }))};
}

// Host-independent: execute calls the existing four tools. Complete arrays stay
// in this bundle; the caller returns only describeReportData() to the model.
export async function prepareReportData(execute,plan,{previous,structure,signal,maxBytes=16*1024*1024}={}){
  if(plan?.schema!=='trajectory-report-plan/1'||!plan.sources||Array.isArray(plan.sources))throw Error('Expected trajectory-report-plan/1 with named sources');
  const entries=Object.entries(plan.sources);
  if(!entries.length||entries.length>12)throw Error('Prepare 1..12 named datasets');
  for(const [alias,descriptor]of entries){
    if(!/^[a-zA-Z][\w-]{0,63}$/.test(alias)||!descriptor||typeof descriptor!=='object')throw Error('Invalid dataset alias: '+alias);
    const keys=Object.keys(descriptor);if(keys.length!==1||!['query','records','assembly'].includes(keys[0]))throw Error('Dataset '+alias+' requires exactly one of query, records, assembly');
  }
  const datasets={},pending=new Map(entries),reused=[],prepared=[];let bytes=0;
  const directSource=async source=>{
    if(!source?.session||!source.snapshot||!source.log||!source.host||!Number.isSafeInteger(source.cut))throw Error('Direct source must be an observed reportSource identity');
    const pinned=await execute('trajectory_inspect',{session:source.session,snapshot:source.snapshot,view:'overview',format:'data',limit:1,sort:'time'});
    if(pinned.ok===false)throw Error(pinned.error?.message||pinned.error||'Pinned source unavailable');
    if(['host','session','snapshot','log','cut'].some(key=>pinned.source?.[key]!==source[key]))throw Error('Direct source identity does not match the pinned observation');
    return pinned.source;
  };
  while(pending.size){
    let progress=false;
    for(const [alias,descriptor]of pending){
      signal?.throwIfAborted();const dependency=descriptor.records?.from||descriptor.assembly?.from;
      const reference=descriptor.records||descriptor.assembly;
      if(reference&&!!reference.from===!!reference.source)throw Error('Dataset '+alias+' needs either from or source');
      if(dependency&&!own(datasets,dependency)){if(!own(plan.sources,dependency))throw Error('Unknown source dependency: '+dependency);continue;}
      let data;
      if(previous?.plan&&own(previous.datasets||{},alias)&&stable(previous.plan.sources?.[alias])===stable(descriptor)&&(!dependency||reused.includes(dependency))){
        data=validateDataset(previous.datasets[alias]);reused.push(alias);
      }else if(descriptor.query){
        data=await collectDataset(execute,descriptor.query,{signal});prepared.push(alias);
      }else if(descriptor.records){
        const source=dependency?datasets[dependency].source:await directSource(descriptor.records.source);
        data=await collectRecords(execute,source,descriptor.records.seqs,{signal});prepared.push(alias);
      }else{
        if(!structure)throw Error('This host does not provide recorded assembly structure');
        const source=dependency?datasets[dependency].source:await directSource(descriptor.assembly.source),cuts=descriptor.assembly.cuts;
        if(!Array.isArray(cuts)||!cuts.length||cuts.length>48||cuts.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>source.cut||i&&n<=cuts[i-1]))throw Error('Assembly cuts must be 1..48 increasing source positions within the frozen cut');
        const snapshots=await structure(source,cuts,signal);
        data=assemblyFromContextSnapshots(snapshots,{source:{...source,query:{adapter:'context-evidence/assembly',cuts}},id:'assembly:'+source.log+':'+cuts.join(',')});prepared.push(alias);
      }
      bytes+=JSON.stringify(data).length*2;if(bytes>maxBytes)throw Error('Report bundle exceeds its shared data budget');
      datasets[alias]=data;pending.delete(alias);progress=true;
    }
    if(!progress)throw Error('Report source dependencies contain a cycle');
  }
  const bundle={schema:'trajectory-report-bundle/1',createdAt:new Date().toISOString(),plan,datasets,figures:{}};
  return {bundle,catalog:{...describeReportData(bundle),prepared,reused,estimatedBytes:bytes}};
}

export function reportComponentHelp(type){
  if(!type)return Object.fromEntries(Object.entries(COMPONENTS).map(([key,value])=>[key,{purpose:value.purpose,fields:value.fields}]));
  if(!COMPONENTS[type])throw Error('Unknown report component: '+type);
  const common={id:'unique-figure-id',type,data:'prepared-alias',title:'解释这张图的标题'};
  const options={
    metrics:{items:[{row:'scope',field:'wallMs'},{row:'scope',field:'calls'}]},
    bar:{fields:{label:'category-column',value:'numeric-column'},sort:'descending',limit:12},
    histogram:{fields:{value:'numeric-column'},bins:[0,2000,5000,10000,20000,40000,80000,160000]},
    scatter:{fields:{x:'numeric-column',y:'numeric-column'}},
    timeline:{fields:{label:'name-column',start:'timestamp-ms-column',end:'timestamp-ms-column'}},
    sequence:{nodes:[{row:'recorded-row-id',label:'行动或反馈',detail:'已读原文的简短归纳'}]},
    context:{fields:{x:'turn'},sample:'last-per-turn',series:['assistant','tool'],layers:['total','delta']},
    comparison:{rows:['before-row-id','after-row-id'],rowLabels:['明确的前时点','明确的后时点'],series:['numeric-column']},
    donut:{rows:['one-row-id'],series:['part-column-a','part-column-b']},
    stacked:{rows:['first-row-id','second-row-id'],series:['part-column-a','part-column-b'],mode:'absolute'},
    assembly:{initialRow:'assembly-row-id'},
  };
  const notes={bar:'groupBy 可对声明可加的 value 按 label 求和；orientation 为 horizontal/vertical，detail 可绑定另一列。',histogram:'bins 为递增下界，最后一个箱包含全部尾部。',scatter:'两列需有同一记录上的真实配对值；可用 select.where 选择已存在列的相等条件。',timeline:'只使用两个已观察到的 timestamp-ms 列，最多 50 个区间。',sequence:'nodes 必须按记录顺序，最多 30 个；具体原文来自 records 数据集。',context:'来源估算，与实际请求用量分别解释。',comparison:'两个行 ID；series 同单位、同测量口径。',donut:'看同一整体中少量、互斥分项的占比；引用一个切点或范围汇总行。',stacked:'最多 20 个行 ID；mode 为 absolute/percent，分项要求与 donut 相同。',assembly:'仅 context-assembly 结构数据；普通报告默认静态，不能用 token 数值造片段。'};
  notes.metrics='items 绑定已有 row 和数值 field，最多六项；不内联数字，单位与未知值由数据决定。';
  return {purpose:COMPONENTS[type].purpose,example:{...common,...options[type]},notes:notes[type],selection:'select.rows 可选择一组已存在行；select.where 是已存在列的相等条件。'};
}
