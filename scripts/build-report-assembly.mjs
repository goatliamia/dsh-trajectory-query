import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {arcCompiler} from '../report/arc.mjs';
import {assembleMarkdown} from '../report/markdown.mjs';
import {reportAssets,renderReport} from '../report/render.mjs';
import {collectDataset,collectRecords} from '../report/collect.mjs';
import {CONTEXT_SERIES} from '../report/components.mjs';
import {reportFixture} from './report-fixture-source.mjs';

const option=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
if(!option('--arc-root'))throw Error('Pass --arc-root for the local Markdown compiler');
const compile=await arcCompiler(option('--arc-root')),repair=reportFixture('repair'),long=reportFixture('long');
const datasets={},figures={},root='docs/demo/report-study/',target='.dsh/report-study';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const k=n=>n>=1e6?(n/1e6).toFixed(2)+'M':(n/1000).toFixed(1)+'k',sec=n=>Number((n/1000).toFixed(1)).toString();
try{
  const inspected=await repair.execute('trajectory_inspect',{view:'overview',limit:1});if(!inspected.ok)throw Error(JSON.stringify(inspected));
  const inspectedLong=await long.execute('trajectory_inspect',{view:'overview',limit:1});if(!inspectedLong.ok)throw Error(JSON.stringify(inspectedLong));
  const take=(host,snapshot,args)=>collectDataset(host.execute,{tool:'trajectory_inspect',args:{session:host.session,snapshot,...args}});
  datasets.steps=await take(repair,inspected.snapshot,{view:'latency'});
  datasets.usage=await take(repair,inspected.snapshot,{view:'cost'});
  datasets.tools=await take(repair,inspected.snapshot,{view:'io',groupBy:'tool'});
  datasets.parallel=await take(repair,inspected.snapshot,{view:'io',turns:{from:50,to:50}});
  datasets.context=await take(long,inspectedLong.snapshot,{view:'context',turns:{from:160,to:190}});
  datasets.records=await collectRecords(repair.execute,datasets.steps.source,[8901,9055,9103,9124]);
  const amounts=row=>CONTEXT_SERIES.reduce((n,[key])=>n+row[key],0);
  const last=new Map(datasets.context.rows.map(row=>[row.turn,row])),pre=last.get(176),post=last.get(177),end=last.get(190);
  const categoryKeys=CONTEXT_SERIES.map(r=>r[0]),largest=CONTEXT_SERIES.map(([key,label])=>({label,delta:end[key]-post[key]})).sort((a,b)=>b.delta-a.delta)[0];
  const dropLargest=CONTEXT_SERIES.map(([key,label])=>({label,drop:pre[key]-post[key]})).sort((a,b)=>b.drop-a.drop)[0];
  const times=datasets.steps.rows.map(r=>r.wallMs).filter(Number.isFinite).sort((a,b)=>a-b),percentile=q=>times[Math.ceil(times.length*q)-1];
  const top=[...datasets.usage.rows].filter(r=>r.uncachedInputTokens!==null).sort((a,b)=>b.uncachedInputTokens-a.uncachedInputTokens).slice(0,4);
  const sum=key=>datasets.usage.rows.reduce((n,r)=>n+(r[key]??0),0),input=sum('uncachedInputTokens'),cache=sum('cacheReadTokens');
  const topValue=top.reduce((n,r)=>n+r.uncachedInputTokens,0),tools=[...datasets.tools.rows].sort((a,b)=>b.returnedCharacters-a.returnedCharacters);
  const parallelStep=datasets.steps.rows.find(r=>r.turn===50&&r.step===2);
  const f=(id,type,data,title,fields,extra={})=>figures[id]={id,type,data,title,fields,...extra};
  f('latency','histogram','steps','活动步骤耗时分布',{value:'wallMs'});
  f('context','context','context','上下文构成切片',{x:'turn'},{sample:'last-per-turn',series:categoryKeys,layers:['total'],annotations:[{row:pre.id,label:'下降前'},{row:post.id,label:'下降后'}]});
  f('cost','bar','usage','未缓存输入在各轮的分布',{label:'turn',value:'uncachedInputTokens'},{groupBy:'turn',orientation:'vertical',highlight:top.map(r=>r.turn)});
  f('scatter','scatter','steps','输入规模与首字等待',{x:'contextTokens',y:'ttftMs'},{select:{where:{retries:0}},color:{field:'cacheHit',threshold:.99}});
  f('parallel','timeline','parallel','两次网页取回的重叠区间',{label:'name',start:'start',end:'end'},{select:{where:{step:2}}});
  f('attempts','sequence','records','反馈、新线索与定位',{}, {nodes:[['record:8901','点击没有生效','用户首次反馈'],['record:9055','再次反馈无变化','相同表现仍在'],['record:9103','页面显示异常','空元素的 onclick 绑定'],['record:9124','定位残留绑定','渲染中断的位置明确']].map(([row,label,detail])=>({row,label,detail}))});
  f('tools','bar','tools','工具返回规模与使用次数',{label:'name',value:'returnedCharacters',detail:'calls'},{sort:'descending',limit:7});
  f('compare','comparison','context','同一次压缩前后的来源对照',{}, {rows:[pre.id,post.id],series:categoryKeys});
  const specs=[
    {id:'latency',label:'耗时分布',vars:{steps:times.length,p50:sec(percentile(.5)),p95:sec(percentile(.95)),max:sec(times.at(-1))}},
    {id:'context',label:'上下文切片',vars:{before:k(amounts(pre)),after:k(amounts(post)),growth:k(amounts(end)-amounts(post)),largest:largest.label}},
    {id:'cost',label:'输入尖峰',vars:{cache:(cache/(cache+input)*100).toFixed(2),turns:top.map(r=>r.turn).sort((a,b)=>a-b).join('、'),topInput:k(topValue),share:(topValue/input*100).toFixed(1)}},
    {id:'scatter',label:'请求分布',vars:{points:datasets.steps.rows.filter(r=>r.retries===0&&Number.isFinite(r.contextTokens)&&Number.isFinite(r.ttftMs)).length}},
    {id:'parallel',label:'并行等待',vars:{wall:sec(parallelStep.wallMs)}},
    {id:'attempts',label:'定位过程',vars:{}},
    {id:'tools',label:'工具返回',vars:{topTool:tools[0].name,topChars:k(tools[0].returnedCharacters),share:(tools[0].returnedCharacters/datasets.tools.rows.reduce((n,r)=>n+r.returnedCharacters,0)*100).toFixed(1)}},
    {id:'compare',label:'压缩前后',vars:{drop:k(amounts(pre)-amounts(post)),largest:dropLargest.label}},
  ];
  const used=[];
  const cases=specs.map((spec,i)=>{
    const md=readFileSync(root+spec.id+'.md','utf8').replace(/\{\{(\w+)\}\}/g,(_,key)=>{if(!(key in spec.vars))throw Error('Unbound report variable');return String(spec.vars[key]);});
    const built=assembleMarkdown(md,{compile,datasets,figures});used.push(...built.figures);
    const title=md.split('\n')[0].replace(/^#\s*/,''),binding=figures[spec.id];
    return {...spec,md,title,html:built.html,binding};
  });
  const assets=reportAssets(),bindings=JSON.stringify({datasets,figures:used}).replaceAll('<','\\u003c');
  const page='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>取证数据直接装配 · 报告试排</title><style>'+assets.css+'</style><link rel="stylesheet" href="/style.css"></head><body><header class="toolbar"><div class="brand"><strong>Trajectory Tree</strong><span>取证数据 → 报告组件</span></div><nav class="case-tabs" role="tablist" aria-label="报告案例">'+cases.map((c,i)=>'<button role="tab" aria-controls="'+c.id+'" aria-selected="'+(i===0)+'" data-case="'+c.id+'">'+c.label+'</button>').join('')+'</nav></header><main>'+cases.map((c,i)=>'<article class="report-case" id="'+c.id+'" role="tabpanel" aria-label="'+c.label+'"'+(i?' hidden':'')+'><div class="case-meta"><div><span class="index">0'+(i+1)+'</span>真实取证数据 · 组件装配</div><span>点选图中记录可看数据与来源</span></div><div class="report-body">'+c.html+'</div><footer class="case-footer"><p>数据由实际注册的 trajectory_inspect / trajectory_read 在冻结日志上提供；沿用同一切点，完整取完所选范围的分页。</p><button class="source-link" data-source="source-'+c.id+'" aria-expanded="false">查看 Markdown 与来源 ↗</button></footer><section class="source-section" id="source-'+c.id+'" hidden><h2>Markdown 与组件声明</h2><pre>'+esc(c.md)+'\n\n'+esc(JSON.stringify(c.binding,null,2))+'</pre></section></article>').join('')+'</main><script id="report-cases" type="application/json">'+JSON.stringify(cases.map(({id,title})=>({id,title})))+'</script><script id="report-bindings" type="application/json">'+bindings+'</script><script>'+assets.runtime.replace(/<\/script/gi,'<\\/script')+'</script><script src="/app.js"></script></body></html>';
  mkdirSync(target,{recursive:true});writeFileSync(target+'/index.html',page);writeFileSync(target+'/bundle.json',JSON.stringify({schema:'trajectory-report-bundle/1',datasets,figures:used},null,2));
  const contextCase=cases.find(c=>c.id==='context');
  writeFileSync(target+'/context-report.html',renderReport({markdown:contextCase.md,datasets:{context:datasets.context},figures:{context:figures.context},compile,title:contextCase.title}).html);
  console.log(JSON.stringify({cases:cases.length,components:7,tables:Object.fromEntries(Object.entries(datasets).map(([key,value])=>[key,value.rows.length])),bytes:Buffer.byteLength(page),output:target}));
}finally{repair.dispose();long.dispose();}
