  // Layout borrows Archify's separation of measured content, lane bounds and
  // routing space. Data ownership never changes to repair a layout collision.
  const tlCache=new WeakMap();
  let tlScrollBound=false,tlSelected=null,tlAction=null,tlLastReadout='';
  const tlCanvas=document.createElement('canvas'),tlContext=tlCanvas.getContext('2d');
  const tlMeasure=text=>{tlContext.font='11px "Segoe UI", "Microsoft YaHei", sans-serif';return tlContext.measureText(String(text)).width;};
  function tlModel(s){
    if(tlCache.has(s))return tlCache.get(s);
    const batches=s.turns.flatMap(t=>toolBatches(t.steps).map(b=>({...b,turn:t}))).sort((a,b)=>a.start-b.start);
    batches.forEach((b,i)=>b.index=i);
    const matched=new Set(s.overview.episodes.flatMap(e=>e.pairs.map(p=>p.failedSeq)));
    const result={batches,matched};tlCache.set(s,result);return result;
  }
  // One reservation includes the glyph, full label and actual-duration mark.
  // Rows belong to exactly one semantic lane; no label can spill into another.
  function tlPack(items,maxRows=3,gap=8){
    const occupied=Array.from({length:maxRows},()=>[]),placed=[],hidden=[];
    for(const item of [...items].sort((a,b)=>(b.priority||0)-(a.priority||0)||a.cx-b.cx)){
      const left=item.left??item.cx-item.width/2,right=item.right??item.cx+item.width/2;
      const row=occupied.findIndex(rects=>rects.every(r=>right+gap<=r.left||left>=r.right+gap));
      if(row<0){hidden.push(item);continue;}
      occupied[row].push({left,right});placed.push({...item,row});
    }
    return {placed,hidden,occupied};
  }
  function tlReadout(text,action){
    tlLastReadout=text;tlAction=action||null;
    if($('tl-readout'))$('tl-readout').textContent=text;
    if($('tl-record')){$('tl-record').hidden=!action;$('tl-record').onclick=action;}
  }
  function tlRoundReadout(t){
    tlReadout(`第 ${t.number} 轮 · 执行 ${dur(endOf(t)-t.start)} · ${t.steps.length} 步 · ${t.calls} 次调用${t.errors?' · '+t.errors+' 次工具报错':''}`,()=>openOverviewRound(t.number,'duration'));
  }
  function tlStepReadout(t,s){
    tlReadout(`第 ${t.number} 轮 / 第 ${s.number} 步 · ${preciseTime(s.end-s.start)} · ${s.calls.length} 次工具调用${s.errors?' · '+s.errors+' 次报错':''}`,()=>tlOpenStep(t,s));
  }
  function tlOpenStep(t,s){
    let html=`<p class="drawer-note">${clock(s.start)} → ${clock(s.end)} · 模型响应 ${preciseTime((s.assistantTime??s.end)-s.start)} · ${s.calls.length} 次工具调用</p>`;
    html+=s.calls.map(callEntry).join('');if(s.reply)html+='<h3>助手原文</h3>'+block(s.reply);
    openDrawer(`第 ${t.number} 轮 · 第 ${s.number} 步`,'本图中的实际步骤与工具记录',html);
  }
  function tlOpenBatch(b){
    const recovered=b.status==='error'&&b.calls.every(c=>tlModel(session).matched.has(c.seq));
    const html=`<div class="ov-evidence-summary"><div><span>调用数量</span><strong>${b.calls.length} 次</strong></div><div><span>实际工具区间</span><strong>${b.end===null?'待确认':preciseTime(b.end-b.start)}</strong></div></div><p class="drawer-note">${recovered?'这批原调用在同轮中随后均返回成功。':''}${view==='overview'?'枝条上的实心短条表示实际工具区间，名称按附近空位排布。失败截口表示本次调用失败；错误结果仍会返回调用方。':'节点宽度用于容纳工具名，节点下方的短线表示实际起止时间。'}</p>`+b.calls.map(callEntry).join('');
    openDrawer(`${b.name}${b.calls.length>1?' ×'+b.calls.length:''}`,`第 ${b.turn.number} 轮 · 第 ${b.step.number} 步`,html);
  }
  function tlFocusRange(t,start,end){
    const viewport=$('graph-scroll'),p=overviewProjection,duration=Math.max(600,end-start),padding=duration*.09;
    const next=Math.max(1,Math.min(1024,(viewport.clientWidth-p.gutter-32)/(duration+padding*2)/p.baseFactor));
    overviewScale=next;renderOverview();
    const q=overviewProjection;viewport.scrollLeft=Math.max(0,q.mapTime(start)-padding*q.factor-q.gutter-8);renderOverview({plotOnly:true});
  }
  function tlFocusStep(t,s){
    const index=t.steps.indexOf(s),before=t.steps[Math.max(0,index-1)],after=t.steps[Math.min(t.steps.length-1,index+2)];
    tlFocusRange(t,before.start,after.end);
  }
  function tlSelectRound(t){tlSelected={turn:t.number};tlRoundReadout(t);tlSelectionOutline(t);}
  function tlSelectionOutline(t){
    const p=overviewProjection,layer=$('tl-selection');if(!p||!layer)return;
    const l=p.layout.find(l=>l.turn===t);if(!l)return;
    layer.innerHTML=`<rect x="${l.x}" y="${p.mainY-7}" width="${Math.max(3,l.end-l.x)}" height="14" rx="3" fill="none" stroke="var(--accent)" stroke-width="1.5"/>`;
  }
  function tlStepRelation(t,s,b){
    const p=overviewProjection,layer=$('tl-relation');if(!p||!layer)return;
    const fork=p.mapTime(s.assistantTime??s.start),join=p.mapTime(s.end),target=b?.cx??p.mapTime(s.assistantTime??s.end),y=b?.cy??p.toolsTop+19;
    if(b){
      const channel=(seed,side)=>{
        for(let k=0;k<30;k++){const x=seed+side*k*10;if(x<p.visibleLeft+3||x>p.visibleRight-3)continue;
          if((p.toolBoxes||[]).every(r=>r.top>y+2||r.bottom<p.mainBottom||x<r.left-4||x>r.right+4))return x;}
        return null;
      };
      const left=b.cx-b.width/2,right=b.cx+b.width/2,entry=channel(left-9,-1),exit=channel(right+9,1);
      let paths='';
      if(entry!==null)paths+=`<path d="M${fork} ${p.mainY+5} V${p.mainBottom+4} H${entry} V${y} H${left}" fill="none" stroke="var(--tool)" stroke-opacity=".7" stroke-width="1.2"/>`;
      if(exit!==null)paths+=`<path d="M${right} ${y} H${exit} V${p.mainBottom+10} H${join} V${p.mainY+5}" fill="none" stroke="var(--tool)" stroke-opacity=".5" stroke-dasharray="2 3" stroke-width="1"/>`;
      layer.innerHTML=paths;
    }else layer.innerHTML=`<path d="M${fork} ${p.mainY+5} V${p.mainBottom+6} H${target} V${y-3}" fill="none" stroke="var(--tool)" stroke-opacity=".65" stroke-width="1.2"/>`;
  }
  function tlClearRelation(){if($('tl-relation'))$('tl-relation').innerHTML='';}
  function tlBindScroll(){
    if(tlScrollBound)return;tlScrollBound=true;let frame=0;
    $('graph-scroll').addEventListener('scroll',()=>{if(view!=='overview'||frame)return;frame=requestAnimationFrame(()=>{frame=0;if(view==='overview')renderOverview({plotOnly:true});});});
  }
