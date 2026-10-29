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
    const html=`<div class="ov-evidence-summary"><div><span>调用数量</span><strong>${b.calls.length} 次</strong></div><div><span>实际工具区间</span><strong>${b.end===null?'待确认':preciseTime(b.end-b.start)}</strong></div></div><p class="drawer-note">${recovered?'这批原调用在同轮中随后均返回成功。':''}节点宽度用于容纳工具名，节点下方的短线表示实际起止时间。</p>`+b.calls.map(callEntry).join('');
    openDrawer(`${b.name}${b.calls.length>1?' ×'+b.calls.length:''}`,`第 ${b.turn.number} 轮 · 第 ${b.step.number} 步`,html);
  }
  function tlFocusRange(t,start,end){
    const viewport=$('graph-scroll'),p=overviewProjection,duration=Math.max(600,end-start),padding=duration*.09;
    const next=Math.max(1,Math.min(256,(viewport.clientWidth-p.gutter-32)/(duration+padding*2)/p.baseFactor));
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

  function renderOverview({plotOnly=false}={}){
    zoom=null;groups=[];$('canvas').classList.add('overview-mode','lane-mode');
    const viewport=$('graph-scroll'),turns=session.turns,analysis=session.overview,model=tlModel(session),gutter=92;
    const showFailures=overviewLayers.has('failures'),showDuration=overviewLayers.has('duration'),showInterruptions=overviewLayers.has('interruptions');
    const active=turns.reduce((n,t)=>n+endOf(t)-t.start,0),begin=turns[0].start,finish=endOf(turns.at(-1));
    const viewportW=Math.max(360,viewport.clientWidth),plotBase=viewportW-gutter-24;
    const gapSpans=turns.slice(1).map((t,i)=>Math.min(12000,Math.max(0,t.start-endOf(turns[i]))));
    const domain=active+gapSpans.reduce((n,v)=>n+v,0),baseFactor=plotBase/Math.max(1,domain),factor=baseFactor*overviewScale;
    const w=gutter+24+plotBase*overviewScale,layout=[];let world=gutter+12,offset=0;
    turns.forEach((t,index)=>{const duration=endOf(t)-t.start;layout.push({turn:t,index,x:world,end:world+duration*factor,offset});world+=duration*factor+(gapSpans[index]||0)*factor;offset+=duration;});
    const mapTime=time=>{
      const l=layout.find(l=>time<=endOf(l.turn))||layout.at(-1);
      if(time>=l.turn.start)return l.x+Math.max(0,Math.min(endOf(l.turn)-l.turn.start,time-l.turn.start))*factor;
      const prev=layout[l.index-1];return prev?prev.end+(time-endOf(prev.turn))/Math.max(1,l.turn.start-endOf(prev.turn))*(l.x-prev.end):l.x;
    };
    const scroll=viewport.scrollLeft,visibleLeft=scroll+gutter+8,visibleRight=scroll+viewportW-12;
    const visible=(a,b=a)=>b>=visibleLeft-110&&a<=visibleRight+110;
    const pps=factor*1000,detail=pps>=.65;
    const mainTop=36,mainY=127,mainBottom=153,toolsTop=167,toolsBottom=322;
    const h=Math.max(382,viewport.clientHeight-2),axisY=h-34;
    overviewProjection={layout,factor,baseFactor,gutter,mapTime,mainY,mainBottom,toolsTop,visibleLeft,visibleRight,detail};
    if(!plotOnly){
      $('turn-heading').innerHTML=`<div class="overview-heading"><div class="overview-heading-main"><strong>整段执行</strong><span>${turns.length} 轮</span></div><div class="overview-heading-meta"><span>${clock(begin).slice(0,5)} — ${clock(finish).slice(0,5)}</span><i></i><span>执行 ${dur(active)}</span></div></div><div class="ov-controls"><div class="ov-layer-checks" aria-label="显示的分析图层">${Object.entries(focusNames).map(([id,name])=>`<label class="ov-layer-check ${id}"><input type="checkbox" data-overview-layer="${id}" ${overviewLayers.has(id)?'checked':''}><span>${name}</span></label>`).join('')}</div><span class="spacer"></span><button class="ov-focus-rule" id="ov-focus-rules">规则 ↗</button><div class="ov-zoom"><button id="ov-zoom-out" aria-label="缩小时间轴" ${overviewScale<=1?'disabled':''}>−</button><button id="ov-fit" title="还原完整时间轴">${overviewScale===1?'全览':Math.round(overviewScale*100)+'%'}</button><button id="ov-zoom-in" aria-label="放大时间轴" ${overviewScale>=256?'disabled':''}>＋</button></div></div>`;
      $('ov-focus-rules').onclick=openOverviewFocusList;
      $('turn-heading').querySelectorAll('[data-overview-layer]').forEach(b=>b.onchange=()=>{const id=b.dataset.overviewLayer;b.checked?overviewLayers.add(id):overviewLayers.delete(id);renderOverview();$('turn-heading').querySelector(`[data-overview-layer="${id}"]`).focus({preventScroll:true});});
      $('ov-zoom-in').onclick=()=>setOverviewScale(overviewScale*1.7);$('ov-zoom-out').onclick=()=>setOverviewScale(overviewScale/1.7);$('ov-fit').onclick=()=>setOverviewScale(1);
      $('graph-caption').innerHTML='<div class="tl-readout" id="tl-readout"></div><button class="back-link" id="tl-record" hidden>查看记录 ↗</button><span class="tl-interaction-hint">滚轮缩放 · 拖动平移 · 双击聚焦</span>';
      tlReadout(tlLastReadout||'数字＝调用次数 · ✓ 原调用随后成功 · ○ 模型请求重试',tlAction);
    }
    const clipWidth=Math.max(1,visibleRight-visibleLeft);
    let html=`<title>完整会话的主 Agent 与工具动作</title><desc>主 Agent 与工具动作使用独立区域和共同时间轴；子 Agent 是主干上的真实分支，请求重试是主干上的空心点。每轮统一记录完整时长。放大后工具活动由轮次摘要展开为实际步骤与工具批次；节点中的数字是调用数量，下方短线是实际耗时。</desc><defs><clipPath id="tl-main-clip"><rect x="${visibleLeft}" y="${mainTop}" width="${clipWidth}" height="${mainBottom-mainTop}"/></clipPath><clipPath id="tl-tools-clip"><rect x="${visibleLeft}" y="${toolsTop}" width="${clipWidth}" height="${toolsBottom-toolsTop}"/></clipPath><clipPath id="tl-plot-clip"><rect x="${visibleLeft}" y="28" width="${clipWidth}" height="${h-28}"/></clipPath></defs>`;
    html+=`<rect x="${scroll}" y="${mainTop}" width="${viewportW}" height="${mainBottom-mainTop}" class="tl-main-bg"/><rect x="${scroll}" y="${toolsTop}" width="${viewportW}" height="${toolsBottom-toolsTop}" class="tl-tools-bg"/><line x1="${scroll+gutter}" x2="${scroll+viewportW}" y1="${mainBottom}" y2="${mainBottom}" class="tl-lane-rule"/><line x1="${scroll+gutter}" x2="${scroll+viewportW}" y1="${toolsBottom}" y2="${toolsBottom}" class="tl-lane-rule"/>`;
    html+=`<g clip-path="url(#tl-main-clip)"><line x1="${gutter+12}" x2="${world}" y1="${mainY}" y2="${mainY}" stroke="var(--ov-idle)" stroke-width="1.2"/>`;
    const labelBoxes=[];
    for(const l of layout){
      const t=l.turn;if(!visible(l.x,l.end))continue;
      html+=`<g class="tl-round" data-sl-round="${t.number}" role="button" tabindex="0"><title>第 ${t.number} 轮 · ${dur(endOf(t)-t.start)} · ${t.steps.length} 步 · ${t.calls} 次调用</title><rect x="${l.x}" y="${mainY-12}" width="${Math.max(2,l.end-l.x)}" height="25" fill="transparent"/>`;
      for(const s of t.steps){const a=mapTime(s.start),b=mapTime(s.assistantTime??s.end);if(!visible(a,mapTime(s.end)))continue;html+=`<g ${detail?'data-sl-step="'+t.number+':'+s.number+'"':''}><rect x="${a}" y="${mainY-4}" width="${Math.max(.4,b-a)}" height="8" rx="1.7" class="tl-model"/><title>第 ${t.number} 轮 · 第 ${s.number} 步 · ${preciseTime(s.end-s.start)} · ${s.calls.length} 次工具调用</title>`;if(detail){html+=`<rect x="${a}" y="${mainY-13}" width="${Math.max(3,mapTime(s.end)-a)}" height="27" fill="transparent"/>`;if(b-a>=24)html+=`<text x="${a+4}" y="${mainY-12}" class="tl-step-number">${s.number}</text>`;}html+='</g>';}
      html+=`<line x1="${l.x}" x2="${l.x}" y1="${mainY-7}" y2="${mainY+7}" stroke="var(--surface)" stroke-width="1.5"/>`;
      const a=Math.max(l.x,visibleLeft),b=Math.min(l.end,visibleRight),available=b-a;
      const full=`第 ${t.number} 轮 · ${dur(endOf(t)-t.start)}`,short=String(t.number),label=showDuration&&available>=tlMeasure(full)+10?full:available>=15?short:'';
      if(label){const cx=(a+b)/2,ww=tlMeasure(label);if(labelBoxes.every(r=>cx-ww/2>r.right+5||cx+ww/2<r.left-5)){labelBoxes.push({left:cx-ww/2,right:cx+ww/2});html+=`<text x="${cx}" y="${mainTop+19}" text-anchor="middle" class="tl-round-label">${esc(label)}</text>`;}}
      if(showInterruptions){
        for(const s of t.steps)for(const r of s.retries){const x=mapTime(r.time);if(!visible(x))continue;html+=`<g data-sl-retry="${t.number}:${s.number}" class="tl-retry"><title>第 ${t.number} 轮 · 第 ${s.number} 步 · 模型请求重试 · ${esc(r.failure?.code||'请求失败')}</title><circle cx="${x}" cy="${mainY}" r="4.5" fill="var(--surface)" stroke="var(--ov-stop)" stroke-width="1.7"/><circle cx="${x}" cy="${mainY}" r="8" fill="transparent"/></g>`;}
        if(stopLabel(t.reason?.kind))html+=`<g class="tl-stop" data-sl-stop="${t.number}"><title>${stopLabel(t.reason.kind)}</title><rect x="${l.end-5}" y="${mainY-7}" width="10" height="14" rx="2" fill="var(--surface)"/><path d="M${l.end-2} ${mainY-5} v10 M${l.end+2} ${mainY-5} v10" stroke="var(--ov-stop)" stroke-width="1.8"/></g>`;
      }
      html+='</g>';
      const next=layout[l.index+1];if(next&&next.x-l.end>5&&visible(l.end,next.x)){const cx=(l.end+next.x)/2,wait=next.turn.start-endOf(t);html+=`<g data-sl-gap="${l.index}" class="tl-gap"><title>轮间等待 ${dur(wait)}，已折叠；这里不是工具节点。</title><rect x="${l.end}" y="${mainY-10}" width="${next.x-l.end}" height="20" fill="var(--surface)"/><path d="M${cx-5} ${mainY+4} l4 -8 M${cx+1} ${mainY+4} l4 -8" stroke="var(--ov-stop)" fill="none" stroke-width="1.2"/>${next.x-l.end>120?`<text x="${cx}" y="${mainY-13}" text-anchor="middle" class="tl-gap-label">等待 ${dur(wait)} · 已折叠</text>`:''}</g>`;}
    }
    html+='<g id="tl-selection"></g>';
    // Child agents remain branches, using the same model/tool visual grammar.
    for(const t of turns)for(const marker of t.markers.filter(m=>m.type==='subagent/catalog')){
      const child=data.sessions.find(c=>c.id===marker.childId);if(!child)continue;
      const start=child.turns[0].start,finish=endOf(child.turns.at(-1)),a=mapTime(marker.time),b=mapTime(finish),y=mainY-35;if(!visible(a,b))continue;
      const join=Math.min(b,a+14);
      html+=`<g class="tl-child" data-sl-child="${esc(child.id)}"><title>子 Agent · ${child.totals.steps} 步 · ${child.totals.calls} 次工具调用 · ${child.totals.errors} 次报错 · ${dur(finish-start)}</title><path d="M${a} ${mainY-3} C${a+7} ${mainY-3},${a+3} ${y},${join} ${y} H${b}" stroke="var(--child)" stroke-width="1.7" fill="none"/>`;
      for(const ct of child.turns)for(const s of ct.steps){const aa=mapTime(s.start),bb=mapTime(s.assistantTime??s.end);if(!visible(aa,mapTime(s.end)))continue;html+=`<rect x="${aa}" y="${y-2}" width="${Math.max(.35,bb-aa)}" height="4" rx="1" fill="var(--child)"/>`;for(const c of s.calls)html+=`<rect x="${mapTime(c.start)}" y="${y+5}" width="${Math.max(.7,mapTime(c.end??c.start)-mapTime(c.start))}" height="3" fill="${c.status==='error'&&showFailures?'var(--error)':'var(--tool)'}"/>`;}
      html+=`<circle cx="${b}" cy="${y}" r="3" fill="var(--surface)" stroke="var(--child)" stroke-width="1.5"/>${b-a>22?`<text x="${Math.max(a,visibleLeft)+3}" y="${y-12}" class="tl-child-label">子 Agent</text>`:''}<rect x="${a}" y="${y-7}" width="${Math.max(8,b-a)}" height="19" fill="transparent"/></g>`;
    }
    html+='</g>';
    html+=`<g clip-path="url(#tl-tools-clip)">`;
    const visibleBatches=model.batches.filter(b=>visible(mapTime(b.start),mapTime(b.end??b.start)));
    let visibleCalls=0;
    for(const b of visibleBatches){
      for(const c of b.calls){const a=mapTime(c.start),end=mapTime(c.end??c.start);if(end>=visibleLeft&&a<=visibleRight)visibleCalls++;
        html+=`<g class="tl-tool-pulse" data-sl-pulse="${b.index}"><title>${esc(c.name)} · 第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${c.end===null?'没有结果':preciseTime(c.end-c.start)}${c.status==='error'?' · 工具报错':''}</title><rect x="${a}" y="${toolsTop+16}" width="${Math.max(.7,end-a)}" height="4" fill="${showFailures&&c.status==='error'?'var(--error)':'var(--tool)'}"/></g>`;
      }
    }
    const drawnBatches=new Map();let packed;
    if(detail){
      const items=visibleBatches.map(b=>{
        const a=mapTime(b.start),end=mapTime(b.end??b.start),label=b.name+(b.calls.length>1?' ×'+b.calls.length:'');
        const width=Math.max(36,tlMeasure(label)+18),cx=(Math.max(a,visibleLeft)+Math.min(Math.max(end,a+1),visibleRight))/2;
        return {batch:b,label,width,cx,left:Math.min(cx-width/2,a),right:Math.max(cx+width/2,end),priority:(b.status==='error'?1000:0)+b.calls.length};
      });
      packed=tlPack(items,3,9);
      for(const item of packed.placed){
        const b=item.batch,a=mapTime(b.start),end=mapTime(b.end??b.start),cy=toolsTop+44+item.row*37;
        const bad=showFailures&&b.status==='error',recovered=bad&&b.calls.every(c=>model.matched.has(c.seq));
        drawnBatches.set(b.index,{...item,cy});
        html+=`<g class="tl-tool-node ${bad?'bad':''}" data-sl-batch="${b.index}" role="button" tabindex="0"><title>第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${esc(item.label)} · 实际区间 ${b.end===null?'待确认':preciseTime(b.end-b.start)}${recovered?' · 原调用随后均成功':''}</title><rect x="${item.cx-item.width/2}" y="${cy-10}" width="${item.width}" height="20" rx="5"/><text x="${item.cx}" y="${cy+4}" text-anchor="middle">${esc(item.label)}</text><line x1="${a}" x2="${Math.max(a+.9,end)}" y1="${cy+14}" y2="${cy+14}" stroke="${bad?'var(--error)':'var(--tool)'}" stroke-width="2" stroke-linecap="round"/>`;
        if(recovered)html+=`<circle cx="${item.cx+item.width/2}" cy="${cy-8}" r="4.5" fill="var(--tool)" stroke="var(--surface)"/><path d="M${item.cx+item.width/2-2} ${cy-8} l1.5 1.7 l2.8 -3" fill="none" stroke="var(--surface)" stroke-width="1.1"/>`;
        html+='</g>';
      }
    }else{
      const items=showFailures?analysis.episodes.filter(e=>visible(mapTime(e.start),mapTime(e.end))).map(e=>({episode:e,cx:mapTime(e.firstError),width:Math.max(42,tlMeasure('第 '+e.turn+' 轮')+6),priority:(e.unconfirmedCount?1000:0)+e.failedCount*10})):[];
      packed=tlPack(items,3,8);
      for(const {episode:e,cx,row} of packed.placed){
        const cy=toolsTop+48+row*37;
        html+=`<g class="tl-incident-node" data-sl-episode="${esc(e.id)}" role="button" tabindex="0"><title>第 ${e.turn} 轮 · ${esc(e.reason)} · ${e.failedCount} 次工具报错 · ${esc(e.summary)}</title><text x="${cx}" y="${cy-15}" text-anchor="middle" class="tl-incident-round">第 ${e.turn} 轮</text><circle cx="${cx}" cy="${cy}" r="10" class="tl-incident-circle"/><text x="${cx}" y="${cy+4}" text-anchor="middle" class="tl-incident-count">${e.failedCount}</text>`;
        if(e.complete)html+=`<circle cx="${cx+8}" cy="${cy+7}" r="4.8" fill="var(--tool)" stroke="var(--surface)"/><path d="M${cx+5.5} ${cy+7} l1.7 1.8 l3.2 -3.6" fill="none" stroke="var(--surface)" stroke-width="1.1"/>`;
        html+=`<rect x="${cx-22}" y="${cy-27}" width="44" height="44" fill="transparent"/></g>`;
      }
    }
    html+='</g><g id="tl-relation" clip-path="url(#tl-plot-clip)"></g>';
    overviewProjection.toolBoxes=[...drawnBatches.values()].map(b=>({left:b.cx-b.width/2,right:b.cx+b.width/2,top:b.cy-11,bottom:b.cy+16}));
    const elapsedAt=x=>{const l=layout.find(l=>x<=l.end)||layout.at(-1);return l.offset+Math.max(0,Math.min(endOf(l.turn)-l.turn.start,(x-l.x)/factor));};
    const axisPoint=elapsed=>{const l=layout.find(l=>elapsed<=l.offset+endOf(l.turn)-l.turn.start)||layout.at(-1);return l.x+Math.max(0,elapsed-l.offset)*factor;};
    const from=elapsedAt(visibleLeft),to=elapsedAt(visibleRight),tick=[100,200,500,1000,2000,5000,10000,30000,60000,120000,300000,600000,1200000].find(v=>v>=(to-from)/7)||1200000;
    html+=`<g clip-path="url(#tl-plot-clip)"><line x1="${visibleLeft}" x2="${visibleRight}" y1="${axisY}" y2="${axisY}" class="tl-lane-rule"/>`;
    for(let ms=Math.ceil(from/tick)*tick;ms<=to;ms+=tick){const x=axisPoint(ms);html+=`<line x1="${x}" x2="${x}" y1="${axisY-5}" y2="${axisY+4}" class="tl-lane-rule"/><text x="${x}" y="${axisY+20}" text-anchor="middle" class="tl-axis">${elapsed(ms)}</text>`;}
    html+='</g>';
    html+=`<g class="tl-pinned" transform="translate(${scroll},0)"><rect x="0" y="0" width="${gutter}" height="${h}" fill="var(--surface)"/><line x1="${gutter-1}" x2="${gutter-1}" y1="${mainTop}" y2="${toolsBottom}" class="tl-lane-rule"/><text x="15" y="${mainY-5}" class="tl-lane-name">主 Agent</text><text x="15" y="${mainY+12}" class="tl-lane-note">模型响应</text><text x="15" y="${toolsTop+36}" class="tl-lane-name">工具动作</text><text x="15" y="${toolsTop+54}" class="tl-lane-note">窗口内 ${visibleCalls} 次</text><text x="15" y="${axisY+3}" class="tl-lane-note">执行时间</text><text x="${gutter+12}" y="22" class="tl-mode-label">${detail?'步骤与工具':'轮次概览'}${!detail?' · 放大后展开实际调用':''}</text><text x="${viewportW-13}" y="22" text-anchor="end" class="tl-mode-label">${detail?visibleBatches.length+' 批工具调用':'共 '+turns.length+' 轮'}</text></g>`;
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;
    $('graph').dataset.detailLevel=detail?'steps-tools':'rounds';$('graph').dataset.hiddenLabels=String(packed.hidden.length);$('graph').dataset.laneCollisions='0';
    const on=(selector,handlers)=>$('graph').querySelectorAll(selector).forEach(el=>{for(const [name,fn] of Object.entries(handlers))el[name]=e=>{if(name==='onclick'||name==='ondblclick'){e.stopPropagation();if(name==='ondblclick')e.preventDefault();}fn(el,e);};el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();handlers.onclick?.(el,e);if(tlAction)tlAction();}};});
    on('[data-sl-round]',{
      onmouseenter:el=>tlRoundReadout(overviewTurn(Number(el.dataset.slRound))),
      onclick:el=>tlSelectRound(overviewTurn(Number(el.dataset.slRound))),
      ondblclick:el=>{const t=overviewTurn(Number(el.dataset.slRound));tlFocusRange(t,t.start,endOf(t));}
    });
    on('[data-sl-step]',{
      onmouseenter:el=>{const [tn,sn]=el.dataset.slStep.split(':').map(Number),t=overviewTurn(tn),s=t.steps.find(s=>s.number===sn);tlStepReadout(t,s);},
      onclick:el=>{const [tn,sn]=el.dataset.slStep.split(':').map(Number),t=overviewTurn(tn),s=t.steps.find(s=>s.number===sn);tlSelected={turn:tn,step:sn};tlStepReadout(t,s);tlSelectionOutline(t);},
      ondblclick:el=>{const [tn,sn]=el.dataset.slStep.split(':').map(Number),t=overviewTurn(tn);tlFocusStep(t,t.steps.find(s=>s.number===sn));}
    });
    const batchOf=el=>model.batches[Number(el.dataset.slBatch??el.dataset.slPulse)];
    on('[data-sl-batch],[data-sl-pulse]',{
      onmouseenter:el=>{const b=batchOf(el),position=drawnBatches.get(b.index);tlReadout(`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name}${b.calls.length>1?' ×'+b.calls.length:''} · ${b.end===null?'待确认':preciseTime(b.end-b.start)}`,()=>tlOpenBatch(b));tlStepRelation(b.turn,b.step,position);},
      onmouseleave:()=>tlClearRelation(),
      onclick:el=>{const b=batchOf(el);tlSelected={turn:b.turn.number,batch:b.index};tlReadout(`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name} ×${b.calls.length} · 双击聚焦此处`,()=>tlOpenBatch(b));tlStepRelation(b.turn,b.step,drawnBatches.get(b.index));},
      ondblclick:el=>{const b=batchOf(el);tlFocusStep(b.turn,b.step);}
    });
    on('[data-sl-episode]',{
      onmouseenter:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.slEpisode);tlReadout(`第 ${e.turn} 轮 · ${e.failedCount} 次报错 · ${e.summary}${e.continuationMs===null?'':' · '+preciseTime(e.continuationMs)+' 后再次成功'}`,()=>openOverviewEpisode(e.id));},
      onclick:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.slEpisode);tlSelected={turn:e.turn};tlReadout(`第 ${e.turn} 轮 · ${e.failedCount} 次报错 · ${e.summary} · 双击展开附近步骤`,()=>openOverviewEpisode(e.id));tlSelectionOutline(overviewTurn(e.turn));},
      ondblclick:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.slEpisode),t=overviewTurn(e.turn);tlFocusStep(t,t.steps.find(s=>s.number===e.steps[0]));}
    });
    on('[data-sl-retry]',{onmouseenter:el=>{const [tn,sn]=el.dataset.slRetry.split(':').map(Number),t=overviewTurn(tn),s=t.steps.find(s=>s.number===sn);tlReadout(`第 ${tn} 轮 / 第 ${sn} 步 · 模型请求重试`,()=>tlOpenStep(t,s));},onclick:el=>{const [tn,sn]=el.dataset.slRetry.split(':').map(Number),t=overviewTurn(tn);tlOpenStep(t,t.steps.find(s=>s.number===sn));}});
    on('[data-sl-child]',{onmouseenter:el=>{const c=data.sessions.find(s=>s.id===el.dataset.slChild);tlReadout(`子 Agent · ${c.totals.steps} 步 · ${c.totals.calls} 次工具调用 · ${c.totals.errors} 次报错 · ${dur(endOf(c.turns.at(-1))-c.turns[0].start)}`,()=>openChild(c.id));},onclick:el=>{const c=data.sessions.find(s=>s.id===el.dataset.slChild);tlFocusRange(turns[0],c.turns[0].start,endOf(c.turns.at(-1)));}});
    on('[data-sl-gap]',{onmouseenter:el=>{const l=layout[Number(el.dataset.slGap)],next=layout[l.index+1];tlReadout(`第 ${l.turn.number}—${next.turn.number} 轮之间等待 ${dur(next.turn.start-endOf(l.turn))}，已折叠；这不是工具执行。`);}});
    if(tlSelected?.turn)tlSelectionOutline(overviewTurn(tlSelected.turn));
    bindOverviewViewport();tlBindScroll();
  }
