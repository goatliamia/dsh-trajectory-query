const cases=JSON.parse(document.getElementById('report-cases').textContent);
const panels=[...document.querySelectorAll('.report-case')],tabs=[...document.querySelectorAll('[data-case]')];
function show(id){
  for(const panel of panels)panel.hidden=panel.id!==id;
  for(const tab of tabs){const selected=tab.dataset.case===id;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  const item=cases.find(row=>row.id===id);document.title=item.title+' · 报告试排';
  history.replaceState(null,'','#'+id);
}
for(const tab of tabs){tab.onclick=()=>show(tab.dataset.case);tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;show(tabs[next].dataset.case);tabs[next].focus();};}
for(const button of document.querySelectorAll('[data-source]'))button.onclick=()=>{const section=document.getElementById(button.dataset.source);section.hidden=!section.hidden;button.setAttribute('aria-expanded',String(!section.hidden));button.textContent=section.hidden?'查看 Markdown 与来源 ↗':'收起 Markdown 与来源 ↑';};
const first=location.hash.slice(1);show(cases.some(row=>row.id===first)?first:cases[0].id);
