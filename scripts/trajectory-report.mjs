import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareReportData,reportComponentHelp} from '../report/prepare.mjs';
import {renderReport} from '../report/render.mjs';
import {fileService,sourceOptions} from '../plugin/portable-tools/runtime.mjs';
import {executeTool,TOOLS} from '../plugin/portable-tools/tools.mjs';

const argv=process.argv.slice(2),action=argv[0],option=name=>{const at=argv.indexOf(name);return at<0?undefined:argv[at+1];};
if(argv.includes('--help')||!action){console.log('trajectory-report: query --connection host.json --case KEY --tool TOOL [--request args.json]; prepare --connection host.json --case KEY --plan sources.json --bundle bundle.json; render --markdown report.md --bundle bundle.json --output report.html; components [--type TYPE]');process.exit(0);}
const started=performance.now(),key=option('--case'),connectionPath=option('--connection');
if(key&&!/^[\w-]+$/.test(key))throw Error('Invalid case key');
const journal=option('--audit')||(connectionPath&&key?join(dirname(resolve(connectionPath)),key,'workflow.jsonl'):option('--bundle')?join(dirname(resolve(option('--bundle'))),'workflow.jsonl'):null);
const record={at:new Date().toISOString(),action,case:key,origin:option('--origin')||'agent'};
const write=(file,value)=>{const target=resolve(file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,value);return target;};
let config,localService;
const remote=async(tool,args,origin='agent')=>{
  if(!connectionPath&&option('--host')){
    if(tool==='schema')return{tools:TOOLS.map(t=>({name:t.name,inputSchema:t.inputSchema}))};
    if(tool==='report/structure')throw Error('This host does not provide recorded assembly structure');
    localService ||= fileService(sourceOptions(argv),{rebuildSnapshots:true});
    return executeTool(localService,tool,args);
  }
  if(!connectionPath||!key)throw Error('Use --host pi|codex|claude, or --connection and --case');
  config ||= JSON.parse(readFileSync(connectionPath,'utf8'));
  const response=await fetch('http://127.0.0.1:'+config.port,{method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},body:JSON.stringify({case:key,tool,args,origin})});
  const result=await response.json();if(!response.ok||result.ok===false)throw Object.assign(new Error(result.error?.message||result.error||'Host query failed'),{detail:result});return result;
};
try{
  let output;
  if(action==='components')output=reportComponentHelp(option('--type'));
  else if(action==='query'){
    const args=option('--request')?JSON.parse(readFileSync(option('--request'),'utf8')):{};
    record.tool=option('--tool')||'trajectory_inspect';record.args=args;
    output=await remote(record.tool,args);
    const sourceSession=output.scope?.session||output.session;
    if(output.snapshot&&output.log?.id&&Number.isSafeInteger(output.log.maxSeq)&&typeof sourceSession==='string')output={...output,reportSource:{host:'dsh',session:sourceSession,snapshot:output.snapshot,log:output.log.id,cut:output.log.maxSeq}};
  }else if(action==='prepare'){
    if(!option('--plan')||!option('--bundle'))throw Error('Prepare requires --plan and --bundle');
    const plan=JSON.parse(readFileSync(option('--plan'),'utf8')),bundleFile=option('--bundle');record.plan=plan;
    const previous=existsSync(bundleFile)?JSON.parse(readFileSync(bundleFile,'utf8')):undefined;
    const result=await prepareReportData((tool,args)=>remote(tool,args,'prepare'),plan,{previous,structure:(source,cuts)=>remote('report/structure',{source,cuts},'prepare').then(r=>r.snapshots)});
    const bundle=write(bundleFile,JSON.stringify(result.bundle));output={ok:true,bundle,...result.catalog};record.prepared=result.catalog.prepared;record.reused=result.catalog.reused;
  }else if(action==='render'){
    if(!option('--markdown')||!option('--bundle')||!option('--output'))throw Error('Render requires --markdown, --bundle and --output');
    const markdown=readFileSync(option('--markdown'),'utf8'),bundle=JSON.parse(readFileSync(option('--bundle'),'utf8'));
    record.markdownSha256=createHash('sha256').update(markdown).digest('hex');
    if(journal&&markdown.length<=1024*1024)record.input=write(join(dirname(journal),'inputs','render-'+Date.now()+'-'+process.pid+'.md'),markdown);
    if(bundle.schema!=='trajectory-report-bundle/1')throw Error('Unsupported report bundle');
    const figures=Array.isArray(bundle.figures)?Object.fromEntries(bundle.figures.map(f=>[f.id,f])):bundle.figures;
    const result=renderReport({markdown,datasets:bundle.datasets,figures,template:option('--template')||'article',title:option('--title')||markdown.split('\n')[0].replace(/^#\s*/,'')});
    record.template=result.template;
    const warnings=!result.figures.length&&markdown.includes('report-figure')?['存在 report-figure 文本但未装配图表；请检查代码围栏，或确认它只是文字示例。']:[];
    output={ok:true,output:write(option('--output'),result.html),figures:result.figures.map(f=>({id:f.id,type:f.type,data:f.data})),bytes:Buffer.byteLength(result.html),...(warnings.length?{warnings}:{})};record.figures=output.figures;record.warnings=warnings;record.markdown=resolve(option('--markdown'));record.markdownCharacters=markdown.length;
  }else throw Error('Unknown report action: '+action);
  const serialized=JSON.stringify(output);record.ok=true;record.returnedCharacters=serialized.length;process.stdout.write(serialized+'\n');
}catch(error){record.ok=false;record.error=error.message;record.diagnostic=error.diagnostic;const recovery=/snapshot expired/i.test(error.message)?{tool:'trajectory_inspect',args:{view:'overview',...(record.args?.session?{session:record.args.session}:{})},instruction:'重新观察并核对 log.id 与原日志身份及切点；一致后使用新 snapshot 续读，停止沿旧 snapshot 发出一批请求。'}:undefined;process.stdout.write(JSON.stringify({ok:false,error:error.message,...(error.diagnostic?{diagnostic:error.diagnostic}:{}),...(error.detail?{detail:error.detail}:{}),...(recovery?{recovery}:{})})+'\n');process.exitCode=1;}
finally{localService?.dispose();record.ms=Math.round(performance.now()-started);if(journal){mkdirSync(dirname(journal),{recursive:true});appendFileSync(journal,JSON.stringify(record)+'\n');}}
