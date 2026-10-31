import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {visualTokenCss} from '../design/tokens.mjs';
const root=new URL('../',import.meta.url),output=new URL('../plugin/analysis-view/lib/trace/shared/',import.meta.url),check=process.argv.includes('--check');
const assets={
 'context-observation.js':readFileSync(new URL('view/assets/context-observation.js',root),'utf8'),
 'context-observation.css':readFileSync(new URL('view/assets/context-observation.css',root),'utf8'),
 'context-trend-geometry.js':readFileSync(new URL('lib/context-trend-geometry.mjs',root),'utf8').replaceAll('export function ','function '),
 'visual-tokens.css':visualTokenCss({legacyAliases:true}),
};
let changed=false;
for(const [name,content] of Object.entries(assets)){
 const targets=[new URL(name,output),...(['context-observation.js','context-observation.css'].includes(name)?[new URL('docs/demo/layout-review/'+name,root)]:[])];
 for(const target of targets){
  let current;try{current=readFileSync(target,'utf8');}catch{}
  if(current===content)continue;changed=true;
  if(check)console.error('View resource differs: '+target.pathname);else{mkdirSync(new URL('./',target),{recursive:true});writeFileSync(target,content);}
 }
}
if(check&&changed)process.exitCode=1;
