import {renderAssembly,mountAssembly} from '/components/assembly.mjs';
import {assemblyDiff,validateAssemblyData} from '/components/assembly-model.mjs';
import {assemblyConcept} from './sequence.mjs';

const host=document.getElementById('assembly-root');
let controller,version=0;
async function show(mode){
  const current=++version;controller?.destroy();
  document.getElementById('selection').hidden=true;
  for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  try{
    const data=mode==='real'?await fetch('/real.json').then(response=>{if(!response.ok)throw Error('请先运行 node scripts/build-report-assembly.mjs 生成真实序列');return response.json();}):assemblyConcept();
    if(current!==version)return;validateAssemblyData(data);
    const firstChange=data.rows.findIndex((frame,i)=>i>0&&assemblyDiff(data.rows[i-1],frame).rewrite);
    const spec={type:'assembly',autoplay:mode==='concept',initialRow:data.rows[mode==='concept'?0:Math.max(0,firstChange-1)].id};
    host.innerHTML=renderAssembly(data,spec);
    controller=mountAssembly(host.firstElementChild,data,spec,{onSelect(selection){const panel=document.getElementById('selection');panel.hidden=false;panel.querySelector('pre').textContent=JSON.stringify({source:data.source,...selection},null,2);}});
    document.getElementById('source-note').textContent=mode==='real'?'真实长对话第 10–22 轮的选定切点，使用官方逻辑历史顺序。没有重放中间未选取的事件。':'概念序列，用来感受装配与改写的节奏。与报告使用同一个组件。';
  }catch(error){if(current===version)host.textContent=error.message;}
}
for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>show(button.dataset.mode);
window.addEventListener('pagehide',()=>controller?.destroy());
show(new URL(location.href).searchParams.get('mode')==='real'?'real':'concept');
