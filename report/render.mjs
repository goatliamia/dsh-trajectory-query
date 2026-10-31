import { readFileSync } from 'node:fs';
import { assembleMarkdown } from './markdown.mjs';
import { visualTokenCss } from '../design/tokens.mjs';
import {composeReport} from './layout.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const code=source=>source.replace(/^import .*;\s*$/gm,'').replace(/^export \{.*\}.*;\s*$/gm,'').replaceAll('export function ','function ').replaceAll('export const ','const ');
export function reportAssets() {
  const runtime=['../design/tokens.mjs','palette.mjs','assembly-model.mjs','contract.mjs','../lib/context-trend-geometry.mjs','assembly.mjs','components.mjs'].map(name=>code(read(name))).join('\n')+'\n'+read('runtime.js');
  let css=visualTokenCss()+read('../design/primitives.css')+read('base.css')+read('style.css')+read('assembly.css')+read('layout.css');
  for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])css=css.replace('/fonts/'+name,'data:font/woff2;base64,'+readFileSync(new URL('../plugin/analysis-view/lib/trace/fonts/'+name,import.meta.url)).toString('base64'));
  return { css,runtime };
}
export function renderReport({ markdown, datasets, figures, compile, template='article', title = '轨迹诊断报告' }) {
  const result=assembleMarkdown(markdown,{compile,datasets,figures}),assets=reportAssets();
  const usedDatasets=Object.fromEntries([...new Set(result.figures.map(figure=>figure.data))].map(key=>[key,datasets[key]]));
  const encoded=JSON.stringify({datasets:usedDatasets,figures:result.figures}).replaceAll('<','\\u003c');
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const layout=composeReport(result.blocks,template);
  return { ...result,template,html:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+assets.css+'</style></head><body class="report-template-'+esc(template)+'"><header class="report-brand">Trajectory Tree <span>诊断报告</span></header><main class="report-body">'+layout.html+'</main><script id="report-bindings" type="application/json">'+encoded+'</script><script>'+assets.runtime.replace(/<\/script/gi,'<\\/script')+'</script></body></html>' };
}
