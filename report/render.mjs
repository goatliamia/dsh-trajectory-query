import { readFileSync } from 'node:fs';
import { assembleMarkdown } from './markdown.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const code=source=>source.replace(/^import .*;\s*$/gm,'').replaceAll('export function ','function ').replaceAll('export const ','const ');
export function reportAssets() {
  const runtime=code(read('contract.mjs'))+'\n'+code(read('../lib/context-trend-geometry.mjs'))+'\n'+code(read('components.mjs'))+'\n'+read('runtime.js');
  let css=read('base.css')+read('style.css');
  for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])css=css.replace('/fonts/'+name,'data:font/woff2;base64,'+readFileSync(new URL('../plugin/analysis-view/lib/trace/fonts/'+name,import.meta.url)).toString('base64'));
  return { css,runtime };
}
export function renderReport({ markdown, datasets, figures, compile, title = '轨迹诊断报告' }) {
  const result=assembleMarkdown(markdown,{compile,datasets,figures}),assets=reportAssets();
  const usedDatasets=Object.fromEntries([...new Set(result.figures.map(figure=>figure.data))].map(key=>[key,datasets[key]]));
  const encoded=JSON.stringify({datasets:usedDatasets,figures:result.figures}).replaceAll('<','\\u003c');
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return { ...result,html:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+assets.css+'</style></head><body><header class="report-brand">Trajectory Tree <span>诊断报告</span></header><main class="report-body">'+result.html+'</main><script id="report-bindings" type="application/json">'+encoded+'</script><script>'+assets.runtime.replace(/<\/script/gi,'<\\/script')+'</script></body></html>' };
}
