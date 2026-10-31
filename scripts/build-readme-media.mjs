// Public showcase fixtures only. Never reads local sessions or private reports.
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {createPiSample} from '../analyzers/pi-sample.mjs';
import {generateTraceView} from '../view/generate.mjs';
import {renderReport} from '../report/render.mjs';
import {assemblyConcept} from '../docs/demo/assembly-study/sequence.mjs';
import {compileMarkdown} from '../report/compile.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'.dsh/readme-media');mkdirSync(out,{recursive:true});
const sample=createPiSample({revision:'public-readme-fixture'},{skillStudy:true});
await generateTraceView({host:'pi',input:sample,output:join(out,'path.html')});
const source={host:'synthetic',session:'public-readme-example',snapshot:'showcase-v1',log:'synthetic-example',cut:24};
const series=['system','tools','user','inject','skill','assistant','tool'];
const labels=['系统提示','工具定义','用户消息','补充内容','技能目录','助手消息','工具结果'];
const columns={turn:{label:'轮次',unit:'turn',basis:'identifier'},...Object.fromEntries(series.map((s,i)=>[s,{label:labels[i],unit:'tokens',basis:'estimated',aggregate:'sum'}]))};
let assistant=1700,tool=1100,user=650;
const rows=Array.from({length:24},(_,i)=>{
 if(i===15){assistant=11500;tool=4700;user=3100;}
 assistant+=900+(i%4)*330;tool+=i%5===2?3100:570;user+=170;
 return{id:'turn:'+ (i+1),turn:i+1,time:i*7000,system:1500,tools:5200,user,inject:420,skill:960,assistant,tool};
});
const context={schema:'trajectory-data/1',id:'context',kind:'context',source,columns,rows,coverage:{synthetic:true}};
const contextFigures={trend:{type:'context',data:'context',title:'上下文怎样积累，又在哪里被整理',fields:{x:'turn'},series,layers:['total','delta']}};
writeFileSync(join(out,'context.html'),renderReport({markdown:'# 上下文的变化，有迹可循\n\n示例数据 · 同一套来源颜色，追踪保留量与每轮增减。\n\n[[figure:trend]]\n',datasets:{context},figures:contextFigures}).html);
const scope={schema:'trajectory-data/1',id:'scope',kind:'summary',source,columns:{wallMs:{label:'观测耗时',unit:'ms',basis:'observed'},calls:{label:'工具调用',unit:'count',basis:'observed'},input:{label:'未缓存输入',unit:'tokens',basis:'observed'},cache:{label:'缓存读取',unit:'tokens',basis:'observed'},output:{label:'输出',unit:'tokens',basis:'observed'}},rows:[{id:'scope',wallMs:246000,calls:34,input:36000,cache:168000,output:12000}],coverage:{synthetic:true}};
const stages={schema:'trajectory-data/1',id:'stages',kind:'groups',source,columns:{name:{label:'阶段',unit:'text',basis:'identifier'},wallMs:{label:'观测耗时',unit:'ms',basis:'observed',aggregate:'sum'}},rows:[{id:'discover',name:'定位与取证',wallMs:41000},{id:'implement',name:'实现与调整',wallMs:58000},{id:'verify',name:'验证与等待',wallMs:147000}],coverage:{synthetic:true}};
const reportFigures={metrics:{type:'metrics',data:'scope',items:[{row:'scope',field:'wallMs'},{row:'scope',field:'calls'},{row:'scope',field:'cache'}]},stages:{type:'bar',data:'stages',title:'主要时间集中在验证阶段',fields:{label:'name',value:'wallMs'},sort:'descending'},input:{type:'donut',data:'scope',title:'请求用量构成',rows:['scope'],series:['input','cache','output']}};
const markdown='# 等待集中在验证阶段，先调整衔接方式\n\n示例报告 · 本页文字与数据均为合成，用于展示报告组件和排版。\n\n[[figure:metrics]]\n\n## [pair] 验证占用了更多时间，下一步先查等待\n\n验证阶段占观测时间的约六成。接下来沿工具开始、返回和后续动作核对，选择真正挡住推进的等待。\n\n保留必要验收，先检查状态查询的节奏，以及等待期间能独立推进的工作。\n\n[[figure:stages]]\n\n## [pair] 把不同投入放到同一张图里\n\n缓存读取、未缓存输入和输出分别显示。图表绑定已有字段，点击图中记录可以展开来源。\n\n[[figure:input]]\n\n## [actions] 下一次怎样验证\n\n- 选择同类任务，保持最终验收条件一致。\n- 比较首个可用结果、完成时间和补读次数。\n';
writeFileSync(join(out,'report.html'),renderReport({markdown,datasets:{scope,stages},figures:reportFigures,template:'diagnostic'}).html);
const assembly=assemblyConcept();
writeFileSync(join(out,'assembly.html'),renderReport({markdown:'# 上下文，一轮一轮拼起来\n\n概念序列 · 追加、保留与历史改写，由同一个装配组件重放。\n\n[[figure:assembly]]\n',datasets:{assembly},figures:{assembly:{type:'assembly',data:'assembly',title:'上下文动态装配',initialRow:'concept:0',autoplay:false}}}).html);
// Preview this repository's trusted README. Product Markdown remains unchanged.
for(const [name,filename] of [['index','README.md'],['english','README.en.md']]){
 const blocks=[],keep=html=>'\n\nREADMEBLOCK'+(blocks.push(html)-1)+'\n\n';
 let markdown=readFileSync(join(root,filename),'utf8').replace(/^<p\b[\s\S]*?<\/p>/gm,keep).replace(/^<h1\b[^\n]*<\/h1>/gm,keep)
  .replace(/^<details>\s*\n<summary>[^\n]*<\/summary>/gm,keep).replace(/^<\/details>/gm,keep)
  .replace(/^!\[([^\]]*)\]\((docs\/media\/[^)]+)\)$/gm,(_,alt,path)=>keep('<img src="/'+path+'" alt="'+alt.replaceAll('"','&quot;')+'">'));
 let body=compileMarkdown(markdown).blocks.map(block=>block.html).join('\n').replace(/<p>READMEBLOCK(\d+)<\/p>/g,(_,n)=>blocks[Number(n)]);
 body=body.replace(/href="([^"#][^"]*)"/g,(all,url)=>/^https?:/.test(url)?all:'href="'+(url==='README.md'?'/':url==='README.en.md'?'/english':'https://github.com/goatliamia/trajectory-tree/blob/main/'+url)+'"');
 writeFileSync(join(out,name+'.html'),'<!doctype html><html lang="'+(name==='index'?'zh-CN':'en')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trajectory Tree · README</title><style>body{margin:0;background:#fff;color:#1f2328;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:980px;padding:30px 34px 60px;margin:auto}h1{font-size:36px;letter-spacing:-.04em;margin:18px 0}h2{font-size:24px;letter-spacing:-.025em;margin:42px 0 16px;padding-bottom:8px;border-bottom:1px solid #d8dee4}h3{font-size:19px}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}img{display:block;max-width:100%;height:auto;margin:20px auto}p[align=center]{color:#57606a}code{background:#eff1f3;border-radius:5px;font:13px/1.6 Consolas,monospace;padding:3px 6px}pre{background:#f6f8fa;padding:16px;overflow:auto;border-radius:6px}pre code{padding:0;background:none}blockquote{border-left:4px solid #d0d7de;color:#656d76;padding:0 16px;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #d0d7de;padding:8px 13px;text-align:left}tr:nth-child(even){background:#f6f8fa}details{margin:12px 0;padding:13px 16px;border:1px solid #d8dee4;border-radius:7px}summary{cursor:pointer}details[open]>summary{margin-bottom:16px}li{margin:5px 0}</style><main>'+body+'</main></html>');
}
console.log(JSON.stringify({output:out,pages:['path','context','report','assembly'],source:'synthetic-only'}));
if(process.argv.includes('--serve')){
 const types={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.gif':'image/gif','.svg':'image/svg+xml'};
 const pages=new Map(['path','context','report','assembly','english'].map(name=>['/'+name,join(out,name+'.html')]));
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let file=pages.get(path);
  if(path.startsWith('/docs/media/')&&!path.slice(12).includes('/')&&!path.includes('..'))file=join(root,path.slice(1));
  if(path==='/')file=join(out,'index.html');
  if(!file||!existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':types[extname(file)]||'text/plain; charset=utf-8','cache-control':'no-store'});res.end(readFileSync(file));
 });
 server.listen(Number(process.argv[process.argv.indexOf('--serve')+1])||3099,'127.0.0.1',()=>console.log('README showcase: http://127.0.0.1:'+server.address().port+'/'));
}
