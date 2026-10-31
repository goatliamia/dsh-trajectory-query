import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {DIAGNOSIS_SKILLS,QUERY_SKILL} from '../skill/catalog.mjs';
const check=process.argv.includes('--check');let changed=false;
function emit(path,wanted){
 const file=new URL('../'+path,import.meta.url);let actual;try{actual=readFileSync(file,'utf8');}catch{}
 if(actual===wanted)return;changed=true;
 if(check)console.error('Skill resource differs: '+path);else{mkdirSync(new URL('./',file),{recursive:true});writeFileSync(file,wanted);}
}
function files(path){return readdirSync(new URL('../'+path,import.meta.url),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path+'/'+entry.name):[path+'/'+entry.name]);}
const hosts={project:{base:'.agents/skills',prefix:'../../../'},codex:{base:'plugin/codex/skills',prefix:'../../../../'},pi:{base:'plugin/portable-tools/skills',prefix:'../../../../'},claude:{base:'plugin/claude/skills',prefix:'../../../../'},dsh:{base:'plugin/trajectory-tools/skills',prefix:'../../'}};
for(const [host,{base,prefix}]of Object.entries(hosts))for(const skill of DIAGNOSIS_SKILLS){
 for(const path of files('skill/'+skill.name)){
  let text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  if(path.endsWith('/SKILL.md')){
   if(['codex','pi','claude'].includes(host))text=text.replace(/^description: /m,'description: '+({codex:'Codex',pi:'Pi',claude:'Claude Code'}[host])+'：');
   text=text.replaceAll('../../report/',prefix+'report/');
   if(['codex','claude'].includes(host))text+='\n未连接取证工具时，用 Node 运行本目录相对路径 `'+prefix+'scripts/trajectory-query.mjs --host '+host+(host==='claude'?' --file <transcript_path>':'')+' --request <args.json>`；'+(host==='claude'?'使用会话绑定提供的 transcript_path。':'默认当前会话，指定会话加 `--thread ID`。')+'工具声明用 `--tool schema` 获取。\n';
   if(host!=='dsh')text+='\n需要 HTML 报告时读[组件用法]('+prefix+'report/AUTHORING.md)；其中报告 CLI 位于本目录相对路径 `'+prefix+'scripts/trajectory-report.mjs`。\n';
  }
  emit(base+'/'+skill.name+path.slice(('skill/'+skill.name).length),text);
 }
}
emit('plugin/trajectory-tools/skills/trajectory-query/SKILL.md',readFileSync(new URL('../skill/trajectory-query/SKILL.md',import.meta.url),'utf8'));
emit('plugin/trajectory-tools/skills/catalog.json',JSON.stringify({query:QUERY_SKILL,diagnostics:DIAGNOSIS_SKILLS},null,2)+'\n');
emit('plugin/trajectory-tools/report/WRITING.md',readFileSync(new URL('../report/WRITING.md',import.meta.url),'utf8'));
if(check&&changed)process.exitCode=1;
