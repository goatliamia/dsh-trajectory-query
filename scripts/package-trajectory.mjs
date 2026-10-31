import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,cpSync,realpathSync,chmodSync,readdirSync,mkdtempSync,lstatSync,rmSync,renameSync} from 'node:fs';
import {resolve,dirname,relative,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DIAGNOSIS_SKILLS} from '../skill/catalog.mjs';

const args=process.argv.slice(2),host=args.includes('--host')?args[args.indexOf('--host')+1]:'codex';
if(!['codex','pi','claude'].includes(host))throw Error('Package host must be codex, pi or claude');
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist'),destination=resolve(dist,'trajectory-tree-'+host);
mkdirSync(dist,{recursive:true});
if(relative(realpathSync(root),realpathSync(dist))!=='dist')throw Error('Build directory resolves outside the workspace');
const out=mkdtempSync(join(dist,'.trajectory-'+host+'-')),copied=new Set(),external=new Set(),skillFiles=[];
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(entry=>{if(entry.isSymbolicLink())throw Error('Skill resource must not be a symlink');return entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)];});}
function copy(path){
 const absolute=resolve(root,path),rel=relative(root,absolute);
 if(rel.startsWith('..')||isAbsolute(rel)||/(^|[\\/])(?:\.dsh|node_modules|logs|experiments|fixtures)([\\/]|$)/.test(rel))throw Error('Non-package source: '+path);
 if(copied.has(rel))return;copied.add(rel);const destination=join(out,rel);mkdirSync(dirname(destination),{recursive:true});copyFileSync(absolute,destination);
 if(!/\.(?:mjs|js)$/.test(absolute))return;
 const source=readFileSync(absolute,'utf8');
 for(const match of source.matchAll(/^\s*(?:import|export)\b[^\r\n]*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\(\s*['"]([^'"\n]+)['"]/gm)){
  const specifier=match[1]||match[2];if(specifier.startsWith('.'))copy(relative(root,resolve(dirname(absolute),specifier)));
  else if(!specifier.startsWith('node:'))external.add(specifier.split('/').slice(0,specifier.startsWith('@')?2:1).join('/'));
 }
}
for(const entry of ['scripts/trajectory-view.mjs','scripts/trajectory-query.mjs','scripts/trajectory-report.mjs',...(host==='pi'?['plugin/portable-tools/pi.mjs']:[])])copy(entry);
for(const file of ['report/base.css','report/style.css','report/layout.css','report/assembly.css','report/runtime.js','report/AUTHORING.md','report/WRITING.md','design/primitives.css','design/DESIGN.md','design/icons.svg',
 'plugin/analysis-view/lib/trace/page.html','plugin/analysis-view/lib/trace/page.js','plugin/analysis-view/lib/trace/fonts/Geist-Variable.woff2','plugin/analysis-view/lib/trace/fonts/GeistMono-Variable.woff2',
 'docs/demo/layout-review/fonts/LICENSE.txt','LICENSE'])copy(file);
for(const name of ['geist.css','context-observation.css','context-observation.js','pi-host.js','codex-host.js','claude-host.js'])copy('view/assets/'+name);
if(host==='codex'||host==='claude')for(const name of [...DIAGNOSIS_SKILLS.map(s=>s.name),'trajectory-view']){
 const sourceRoot=join(root,'plugin',host,'skills',name);
 for(const sourceFile of files(sourceRoot)){
  const target=join(out,'skills',name,relative(sourceRoot,sourceFile)),text=readFileSync(sourceFile,'utf8').replaceAll('../../../../','../../');
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
  skillFiles.push({source:relative(root,sourceFile),output:relative(out,target),sha256:createHash('sha256').update(text).digest('hex')});
 }
}else for(const skill of DIAGNOSIS_SKILLS)for(const file of files(join(root,'plugin/portable-tools/skills',skill.name)))copy(relative(root,file));
for(const name of external){
 if(name!=='typebox')throw Error('Review unexpected bundled dependency: '+name);
 const require=createRequire(new URL('../plugin/portable-tools/package.json',import.meta.url));
 let source=dirname(realpathSync(require.resolve(name)));
 while(!existsSync(join(source,'package.json'))||JSON.parse(readFileSync(join(source,'package.json'),'utf8')).name!==name){const parent=dirname(source);if(parent===source)throw Error('Cannot resolve dependency root: '+name);source=parent;}
 cpSync(source,join(out,'node_modules',name),{recursive:true});
}
const manifest=JSON.parse(readFileSync(join(root,'plugin/codex/plugin.json'),'utf8'));
if(host==='codex')writeFileSync(join(out,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');
if(host==='claude')for(const file of ['.claude-plugin/plugin.json','hooks/hooks.json','scripts/bind-session.mjs']){
 const source=join(root,'plugin/claude',file),target=join(out,file),text=readFileSync(source,'utf8');
 mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);
 skillFiles.push({source:relative(root,source),output:relative(out,target),sha256:createHash('sha256').update(text).digest('hex')});
}
const deps=JSON.parse(readFileSync(new URL('../plugin/portable-tools/package.json',import.meta.url),'utf8')).dependencies;
writeFileSync(join(out,'package.json'),JSON.stringify({name:'trajectory-tree-'+host,version:manifest.version,private:true,type:'module',license:'MIT',engines:{node:'>=20'},
 bin:{'trajectory-view':'./scripts/trajectory-view.mjs'},dependencies:Object.fromEntries([...external].map(name=>[name,deps[name]])),bundledDependencies:[...external],
 ...(host==='pi'?{pi:{extensions:['./plugin/portable-tools/pi.mjs'],skills:DIAGNOSIS_SKILLS.map(s=>'./plugin/portable-tools/skills/'+s.name)}}:{})},null,2)+'\n');
chmodSync(join(out,'scripts/trajectory-view.mjs'),0o755);
writeFileSync(join(out,'bundle-manifest.json'),JSON.stringify({version:manifest.version,generatedAt:new Date().toISOString(),sources:[...copied].sort().map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')})),skillFiles,dependencies:[...external]},null,2));
if(existsSync(destination)){
 const prior=JSON.parse(readFileSync(join(destination,'package.json'),'utf8'));
 if(lstatSync(destination).isSymbolicLink()||relative(realpathSync(root),realpathSync(destination))!==relative(root,destination)||prior.name!=='trajectory-tree-'+host)throw Error('Refusing to replace an unrecognized build output');
 rmSync(destination,{recursive:true,force:true});
}
renameSync(out,destination);
console.log(JSON.stringify({ok:true,host,output:destination,sourceFiles:copied.size,skills:DIAGNOSIS_SKILLS.length+(host!=='pi'?1:0),dependencies:[...external]}));
