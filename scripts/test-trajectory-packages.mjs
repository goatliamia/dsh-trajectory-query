import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {createPiSample} from '../analyzers/pi-sample.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),work=mkdtempSync(join(tmpdir(),'trajectory-package-test-'));
const version=JSON.parse(readFileSync(join(root,'plugin/codex/plugin.json'),'utf8')).version;
const markdownFiles=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?markdownFiles(join(path,e.name)):e.name.endsWith('.md')?[join(path,e.name)]:[]);
function checkLinks(skillRoot){
 assert.ok(!existsSync(join(skillRoot,'trace-analysis/references/overview.md')),'Comprehensive diagnosis lives in the skill body');
 for(const file of markdownFiles(skillRoot))for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g))if(!/^https?:/.test(match[1]))assert.ok(existsSync(resolve(file,'..',match[1])),'Packaged skill link: '+file+' -> '+match[1]);
}
try{
 const sample=createPiSample({revision:'package-test'}),native=join(work,'session.jsonl');
 writeFileSync(native,[sample.header,...sample.entries].map(JSON.stringify).join('\n')+'\n');
 const claudeNative=join(work,'claude.jsonl'),claudeBase={sessionId:'package-claude',timestamp:'2026-01-01T00:00:00Z',cwd:work};
 writeFileSync(claudeNative,[{...claudeBase,type:'user',message:{content:'inspect'}},{...claudeBase,type:'assistant',uuid:'a1',message:{id:'m1',usage:{input_tokens:7,output_tokens:3,cache_read_input_tokens:8,cache_creation_input_tokens:2},content:[{type:'tool_use',id:'c1',name:'Read',input:{file_path:'a.txt'}}]}},{...claudeBase,type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',content:'file body'}]}}].map(JSON.stringify).join('\n')+'\n');
 for(const host of ['codex','pi','claude']){
  const archive=join(root,'.dsh/releases/trajectory-tree-'+host+'-'+version+'.tgz');
  const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8',windowsHide:true}).trim().split('\n');
  assert.ok(entries.every(p=>p.startsWith('package/')&&!p.includes('../')&&!p.includes('/.dsh/')));
  const directory=join(work,host);mkdirSync(directory);execFileSync('tar',['-xzf',archive,'-C',directory],{windowsHide:true});
  const installed=join(directory,'package');assert.ok(existsSync(join(installed,'node_modules/typebox/package.json')));
  assert.ok(!existsSync(join(installed,'plugin/trajectory-tools/lib/inspect-methods.js')),'No stale tool-owned methods in a clean package');
  const skillRoot=host!=='pi'?join(installed,'skills'):join(installed,'plugin/portable-tools/skills');
  checkLinks(skillRoot);
  const run=(script,args)=>JSON.parse(execFileSync(process.execPath,[join(installed,'scripts',script),...args],{encoding:'utf8',cwd:directory,windowsHide:true}));
  const source=host==='claude'?['--host','claude','--file',claudeNative]:['--host','pi','--file',native,'--synthetic'];
  const schema=run('trajectory-query.mjs',['--tool','schema']);assert.equal(schema.tools.length,4);
  const view=run('trajectory-view.mjs',[...source,'--out',join(directory,'view.html')]);assert.equal(view.ok,true);
  const query=run('trajectory-query.mjs',[...source,'--args','{"view":"overview","format":"data"}']);assert.ok(query.source.snapshot);
  if(host==='claude'){
   assert.equal(view.host,'claude');assert.ok(readFileSync(view.output,'utf8').includes('Claude Code · 会话分析'));
   const overview=run('trajectory-query.mjs',[...source,'--args','{"view":"overview"}']);
   assert.equal(overview.summary.unit,'assistant-record');assert.equal(overview.summary.usage.input,17);assert.equal(overview.summary.calls,1);
   const io=run('trajectory-query.mjs',[...source,'--args','{"view":"io"}']);assert.equal(io.rows[0].tool,'Read');
   assert.equal(JSON.parse(readFileSync(join(installed,'.claude-plugin/plugin.json'),'utf8')).name,'trajectory-tree');
   const hook=JSON.parse(execFileSync(process.execPath,[join(installed,'scripts/bind-session.mjs')],{input:JSON.stringify({hook_event_name:'SessionStart',session_id:'package-claude',transcript_path:claudeNative}),encoding:'utf8',windowsHide:true}));
   assert.equal(hook.hookSpecificOutput.hookEventName,'SessionStart');
  }
  const bundle=join(directory,'bundle.json');writeFileSync(bundle,JSON.stringify({schema:'trajectory-report-bundle/1',datasets:{steps:query},figures:{}}));
  const markdown=join(directory,'report.md');writeFileSync(markdown,'# Independent package\n\nReport renderer asset check.\n');
  const report=run('trajectory-report.mjs',['render','--markdown',markdown,'--bundle',bundle,'--output',join(directory,'report.html')]);assert.equal(report.ok,true);
 }
 const dshVersion=JSON.parse(readFileSync(join(root,'plugin/trajectory-tools/package.json'),'utf8')).version;
 const dshDirectory=join(work,'dsh');mkdirSync(dshDirectory);
 const dshArchive=join(root,'.dsh/releases/dsh-trajectory-tools-'+dshVersion+'.tgz');
 const dshEntries=execFileSync('tar',['-tzf',dshArchive],{encoding:'utf8',windowsHide:true}).trim().split('\n');
 assert.ok(dshEntries.every(p=>p.startsWith('package/')&&!p.includes('../')&&!p.includes('/.dsh/')));
 execFileSync('tar',['-xzf',dshArchive,'-C',dshDirectory],{windowsHide:true});
 const dshInstalled=join(dshDirectory,'package');checkLinks(join(dshInstalled,'skills'));
 assert.ok(!existsSync(join(dshInstalled,'lib/inspect-methods.js')));
 const {loadDiagnosticSkills,SKILL_BODY}=await import(pathToFileURL(join(dshInstalled,'lib/skill.js')).href);
 assert.ok(SKILL_BODY.includes('原文位置'));
 assert.deepEqual(loadDiagnosticSkills().map(s=>s.name),['trace-analysis','context-profile']);
 for(const skill of loadDiagnosticSkills()){
  assert.equal(skill.source,'runtime');assert.equal(skill.resourceBase.kind,'directory');
  assert.ok(existsSync(join(skill.resourceBase.path,'SKILL.md')));
  assert.ok(!skill.content.startsWith('---'));
 }
 console.log('Codex/Pi/Claude archives passed independent execution; four hosts passed skill links, native metadata and clean resource packaging.');
}finally{
 if(!resolve(work).startsWith(resolve(tmpdir(),'trajectory-package-test-')))throw Error('Unexpected cleanup path');
 rmSync(work,{recursive:true,force:true});
}
