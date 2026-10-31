const heading=block=>block.type==='heading'?block.html.match(/^<h([12]) id="([^"]+)">([\s\S]*)<\/h\1>$/):null;

// Authors declare placement; no keyword or diagnosis inference takes place.
// Unmarked Markdown retains its original flow and all authored blocks survive.
export function composeReport(blocks,template='article'){
 if(!['article','diagnostic'].includes(template))throw Error('Unknown report template: '+template);
 if(template==='article')return{html:blocks.map(b=>b.html).join('\n'),navigation:''};
 const intro=[],sections=[];let current;
 for(const block of blocks){
  const h=heading(block);
  if(h?.[1]==='2'){
   const match=h[3].match(/^\[(pair|actions|sources)\]\s*/);
   const title=match?h[3].slice(match[0].length):h[3];
   current={id:h[2],title,role:match?.[1]||'flow',blocks:[]};sections.push(current);
  }else(current?current.blocks:intro).push(block);
 }
 const navigation='<nav class="diagnostic-nav" aria-label="报告章节"><span class="nav-caption">本次分析</span>'+sections.map((s,i)=>'<a href="#'+s.id+'"><span>'+String(i+1).padStart(2,'0')+'</span>'+s.title+'</a>').join('')+'</nav>';
 const body=sections.map((s,i)=>{
  const header='<header class="diagnostic-section-head"><span>'+String(i+1).padStart(2,'0')+'</span><h2 id="'+s.id+'">'+s.title+'</h2></header>';
  let content=s.blocks.map(b=>b.html).join('\n');
  if(s.role==='pair'){
   const first=s.blocks.findIndex(b=>b.figure);
   if(first>0)content='<div class="diagnostic-pair-body"><div class="diagnostic-copy">'+s.blocks.slice(0,first).map(b=>b.html).join('\n')+'</div><div class="diagnostic-evidence">'+s.blocks.slice(first).map(b=>b.html).join('\n')+'</div></div>';
  }
  if(s.role==='sources')return'<section class="diagnostic-section diagnostic-sources">'+header+'<details><summary>查看数据口径与证据位置</summary><div>'+content+'</div></details></section>';
  return'<section class="diagnostic-section diagnostic-'+s.role+'">'+header+content+'</section>';
 }).join('\n');
 const outline=sections.length?'<details class="diagnostic-outline"><summary>章节导航<span>'+sections.length+' 节</span></summary>'+navigation+'</details>':'';
 return{html:'<div class="diagnostic-shell"><article><header class="diagnostic-hero"><div class="diagnostic-kicker">TRACE ANALYSIS <span>会话诊断</span></div>'+intro.map(b=>b.html).join('\n')+'</header>'+outline+body+'</article></div>',navigation};
}
