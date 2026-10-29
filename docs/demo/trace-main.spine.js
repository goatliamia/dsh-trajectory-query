  // One execution spine. Only parallel work and an observed blocked operation
  // create branches. The surrounding space is a routing reserve, not a track.
  let spSelectedEpisode=null,spScrollBound=false;
  const spNames={edit:'修改',write:'写入',read:'读取',pwsh:'命令',grep:'搜索',cordis_inspect_query:'查询',session_search:'历史查询',session_event_search:'事件查询'};
  const spName=name=>spNames[name]||name;
  function spRound(n){return session.turns.find(t=>t.number===n);}
  function spStageLabel(e,stage,lookup){
    const calls=stage.seqs.map(seq=>lookup.get(seq)).filter(Boolean),counts=names(calls);
    if(stage.kind==='failure'&&e.condition==='SESSION_QUERY_PERSISTENCE_FAILED')return '历史查询 ×'+e.failedCount;
    if(stage.kind==='failure'&&e.condition==='TOOL_TIMEOUT')return '查询超时';
    return counts.length===1?spName(counts[0][0])+(counts[0][1]>1?' ×'+counts[0][1]:''):stage.kind==='read'?'补充读取':stage.kind==='success'?'原操作成功':spName(counts[0]?.[0]||'调用');
  }
  function spOpenStage(e,stage,lookup){
    openDrawer(`第 ${e.turn} 轮 · ${spStageLabel(e,stage,lookup)}`,`${clock(stage.time)} · ${e.reason}`,stage.seqs.map(seq=>lookup.get(seq)).filter(Boolean).map(callEntry).join(''));
  }
  function spHeroEpisodes(all){
    const out=[];const add=e=>{if(e&&!out.includes(e))out.push(e);};
    add(all.find(e=>e.id===spSelectedEpisode));
    add([...all].sort((a,b)=>b.operationCount-a.operationCount||b.failedCount-a.failedCount)[0]);
    add([...all].sort((a,b)=>b.failedCallMs-a.failedCallMs)[0]);
    add(all.find(e=>e.condition==='SESSION_QUERY_PERSISTENCE_FAILED'&&e.steps.length>1));
    if(out.length<3)for(const e of [...all].sort((a,b)=>b.unconfirmedCount-a.unconfirmedCount||b.failedCount-a.failedCount))add(e);
    return out.slice(0,3).sort((a,b)=>a.firstError-b.firstError);
  }
  function spRoute(points,r=7){
    if(points.length<2)return '';let path=`M${points[0][0]} ${points[0][1]}`;
    for(let i=1;i<points.length-1;i++){const a=points[i-1],p=points[i],b=points[i+1],d1=Math.hypot(p[0]-a[0],p[1]-a[1]),d2=Math.hypot(b[0]-p[0],b[1]-p[1]);if(!d1||!d2)continue;const rr=Math.min(r,d1/2,d2/2),q=[p[0]+(a[0]-p[0])*rr/d1,p[1]+(a[1]-p[1])*rr/d1],z=[p[0]+(b[0]-p[0])*rr/d2,p[1]+(b[1]-p[1])*rr/d2];path+=` L${q[0]} ${q[1]} Q${p[0]} ${p[1]} ${z[0]} ${z[1]}`;}
    return path+` L${points.at(-1)[0]} ${points.at(-1)[1]}`;
  }
  function renderOverview({plotOnly=false}={}){
    zoom=null;groups=[];const canvas=$('canvas');canvas.classList.remove('lane-mode');canvas.classList.add('overview-mode','spine-scene');
    const viewport=$('graph-scroll'),turns=session.turns,analysis=session.overview,model=tlModel(session);
    if(!model.lookup)model.lookup=new Map(turns.flatMap(t=>t.steps.flatMap(s=>s.calls)).map(c=>[c.seq,c]));
    const lookup=model.lookup,showFailures=overviewLayers.has('failures'),showDuration=overviewLayers.has('duration'),showInterruptions=overviewLayers.has('interruptions');
    const active=turns.reduce((n,t)=>n+endOf(t)-t.start,0),begin=turns[0].start,finish=endOf(turns.at(-1));
    const viewportW=Math.max(300,viewport.clientWidth),gutter=24,plotBase=viewportW-48,gaps=turns.slice(1).map((t,i)=>Math.min(12000,Math.max(0,t.start-endOf(turns[i]))));
    const domain=active+gaps.reduce((n,v)=>n+v,0),baseFactor=plotBase/Math.max(1,domain),factor=baseFactor*overviewScale,w=48+plotBase*overviewScale,layout=[];
    let cursor=24,offset=0;turns.forEach((t,index)=>{const duration=endOf(t)-t.start;layout.push({turn:t,index,x:cursor,end:cursor+duration*factor,offset});cursor+=duration*factor+(gaps[index]||0)*factor;offset+=duration;});
    const mapTime=time=>{const l=layout.find(l=>time<=endOf(l.turn))||layout.at(-1);if(time>=l.turn.start)return l.x+Math.max(0,Math.min(endOf(l.turn)-l.turn.start,time-l.turn.start))*factor;const prev=layout[l.index-1];return prev?prev.end+(time-endOf(prev.turn))/Math.max(1,l.turn.start-endOf(prev.turn))*(l.x-prev.end):l.x;};
    const scroll=viewport.scrollLeft,left=scroll+24,right=scroll+viewportW-24,visible=(a,b=a)=>b>=left-100&&a<=right+100,detail=factor*1000>=.65;
    const base=129;
    const candidates=showFailures?analysis.episodes.filter(e=>visible(mapTime(e.firstError),mapTime(e.resolvedAt??e.end))):[];
    const hero=spHeroEpisodes(candidates),plans=hero.map(e=>{
      const stages=e.sequence.filter(s=>s.kind!=='unknown').map(s=>({...s,label:spStageLabel(e,s,lookup)})),widths=stages.map(s=>Math.max(48,tlMeasure(s.label)+18));
      const width=widths.reduce((n,v)=>n+v,0)+(stages.length-1)*12,a=mapTime(e.firstError),b=mapTime(e.resolvedAt??e.end);
      const caption=`第 ${e.turn} 轮${e.complete?' · '+preciseTime(e.continuationMs)+' 后继续':''}`,reserve=Math.max(width,tlMeasure(caption)+8);
      const cx=Math.max(left+reserve/2+16,Math.min(right-reserve/2-16,(a+b)/2));
      return {episode:e,stages,widths,width,cx,a,b,caption,left:cx-reserve/2,right:cx+reserve/2,priority:(e.id===spSelectedEpisode?10000:0)+e.failedCount};
    });
    const packed=tlPack(plans,3,16),placed=packed.placed.map(p=>({...p,cy:base+49+p.row*65}));
    const obstacles=placed.map(p=>({left:p.cx-p.width/2-5,right:p.cx+p.width/2+5,top:p.cy-26,bottom:p.cy+16}));
    const rows=placed.length?Math.max(...placed.map(p=>p.row))+1:0;
    const h=Math.max(365,base+45+rows*65+49,viewport.clientHeight-2),axisY=h-34;
    overviewProjection={layout,factor,baseFactor,gutter,mapTime,mainY:base,mainBottom:base+10,visibleLeft:left,visibleRight:right};
    if(!plotOnly){
      $('turn-heading').innerHTML=`<div class="overview-heading"><div class="overview-heading-main"><strong>执行全景</strong><span>${turns.length} 轮</span></div><div class="overview-heading-meta"><span>${clock(begin).slice(0,5)} — ${clock(finish).slice(0,5)}</span><i></i><span>执行 ${dur(active)}</span></div></div><div class="ov-controls"><div class="ov-layer-checks" aria-label="显示的分析图层">${Object.entries(focusNames).map(([id,name])=>`<label class="ov-layer-check ${id}"><input type="checkbox" data-overview-layer="${id}" ${overviewLayers.has(id)?'checked':''}><span>${name}</span></label>`).join('')}</div><span class="spacer"></span><button class="ov-focus-rule" id="ov-focus-rules">规则 ↗</button><div class="ov-zoom"><button id="ov-zoom-out" aria-label="缩小时间轴" ${overviewScale<=1?'disabled':''}>−</button><button id="ov-fit">${overviewScale===1?'全览':overviewScale.toFixed(overviewScale<10?1:0)+'×'}</button><button id="ov-zoom-in" aria-label="放大时间轴" ${overviewScale>=1024?'disabled':''}>＋</button></div></div>`;
      $('ov-focus-rules').onclick=openOverviewFocusList;
      $('turn-heading').querySelectorAll('[data-overview-layer]').forEach(b=>b.onchange=()=>{const id=b.dataset.overviewLayer;b.checked?overviewLayers.add(id):overviewLayers.delete(id);renderOverview();});
      $('ov-zoom-in').onclick=()=>setOverviewScale(overviewScale*1.8);$('ov-zoom-out').onclick=()=>setOverviewScale(overviewScale/1.8);$('ov-fit').onclick=()=>setOverviewScale(1);
      $('graph-caption').innerHTML='<div class="tl-readout" id="tl-readout"></div><button class="back-link" id="tl-record" hidden>查看记录 ↗</button><span class="sp-gesture">滚轮缩放 · 拖动 · 双击聚焦</span>';
      tlReadout(tlLastReadout||'主线按执行时间排列；分叉内的节点表示实际动作顺序。',tlAction);
    }
    let html=`<title>单一执行主干与实际分支</title><desc>正常执行沿主干推进，子 Agent 向上分出并行路径，受阻后处理向下分出路径，原操作有成功证据才接回。请求重试仅是主干上的点。分支节点宽度容纳动作名称，不编码耗时。所有数据来自原始执行事件。</desc><defs><clipPath id="sp-clip"><rect x="${scroll}" y="29" width="${viewportW}" height="${h-29}"/></clipPath></defs>`;
    html+=`<g clip-path="url(#sp-clip)"><path d="M24 ${base} H${cursor}" class="sp-backbone"/>`;
    const owned=new Set(placed.flatMap(p=>[...p.episode.failureSeqs,...p.episode.readSeqs,...p.episode.pairs.map(p=>p.successSeq)]));
    for(const l of layout){
      const t=l.turn;if(!visible(l.x,l.end))continue;
      html+=`<g class="sp-round" data-sp-round="${t.number}" role="button" tabindex="0"><title>第 ${t.number} 轮 · ${dur(endOf(t)-t.start)} · ${t.steps.length} 步 · ${t.calls} 次工具调用</title><rect x="${l.x}" y="${base-12}" width="${Math.max(2,l.end-l.x)}" height="25" fill="transparent"/>`;
      for(const s of t.steps){const a=mapTime(s.start),b=mapTime(s.assistantTime??s.end);if(!visible(a,mapTime(s.end)))continue;html+=`<g ${detail?'data-sp-step="'+t.number+':'+s.number+'"':''}><rect x="${a}" y="${base-3}" width="${Math.max(.4,b-a)}" height="6" rx="1.6" class="sp-generation"/>${detail?`<rect x="${a}" y="${base-12}" width="${Math.max(3,mapTime(s.end)-a)}" height="25" fill="transparent"/>`:''}<title>第 ${t.number} 轮 / 第 ${s.number} 步 · ${preciseTime(s.end-s.start)} · ${s.calls.length} 次工具调用</title></g>`;}
      html+=`<path d="M${l.x} ${base-6} V${base+6}" stroke="var(--surface)" stroke-width="1.5"/>`;
      const a=Math.max(l.x,left),b=Math.min(l.end,right),available=b-a,label=`${t.number} · ${dur(endOf(t)-t.start)}`;
      if(showDuration&&available>=tlMeasure(label)+12)html+=`<text x="${(a+b)/2}" y="${base-16}" text-anchor="middle" class="sp-round-number">${label}</text>`;
      else if(available>18)html+=`<text x="${(a+b)/2}" y="${base-16}" text-anchor="middle" class="sp-round-number">${t.number}</text>`;
      if(showInterruptions){for(const s of t.steps)for(const r of s.retries)html+=`<g class="sp-retry" data-sp-step="${t.number}:${s.number}"><title>模型请求重试 · 第 ${t.number} 轮 / 第 ${s.number} 步 · ${esc(r.failure?.code||'')}</title><circle cx="${mapTime(r.time)}" cy="${base}" r="3.8" fill="var(--surface)" stroke="var(--ov-stop)" stroke-width="1.5"/></g>`;if(stopLabel(t.reason?.kind))html+=`<path d="M${l.end-2} ${base-6} v12 M${l.end+2} ${base-6} v12" stroke="var(--ov-stop)" stroke-width="1.6"><title>第 ${t.number} 轮 · ${stopLabel(t.reason.kind)}</title></path>`;}
      html+='</g>';
      const next=layout[l.index+1];if(next&&next.x-l.end>6&&visible(l.end,next.x)){const x=(l.end+next.x)/2;html+=`<g data-sp-gap="${l.index}" class="sp-gap"><title>轮间等待 ${dur(next.turn.start-endOf(t))}，已折叠</title><rect x="${l.end}" y="${base-8}" width="${next.x-l.end}" height="16" fill="var(--surface)"/><path d="M${x-5} ${base+4} l4 -8 M${x+1} ${base+4} l4 -8" stroke="var(--ov-stop)" stroke-width="1"/>${next.x-l.end>130?`<text x="${x}" y="${base-15}" text-anchor="middle" class="sp-small">轮间等待 ${dur(next.turn.start-endOf(t))}</text>`:''}</g>`;}
    }
    const mainBoxes=[];
    if(detail)for(const b of model.batches.filter(b=>visible(mapTime(b.start),mapTime(b.end??b.start))&&!b.calls.every(c=>owned.has(c.seq)))){
      const label=spName(b.name)+(b.calls.length>1?' ×'+b.calls.length:''),width=tlMeasure(label)+16,cx=mapTime((b.start+(b.end??b.start))/2),box={left:cx-width/2,right:cx+width/2};
      if(mainBoxes.some(r=>box.left<r.right+8&&box.right>r.left-8))continue;mainBoxes.push(box);
      html+=`<g class="sp-action ${b.status==='error'&&showFailures?'failure':'normal'}" data-sp-batch="${b.index}" role="button" tabindex="0"><title>第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${esc(b.name)} ×${b.calls.length} · ${b.end===null?'待确认':preciseTime(b.end-b.start)}</title><rect x="${box.left}" y="${base-10}" width="${width}" height="20" rx="4"/><text x="${cx}" y="${base+4}" text-anchor="middle">${esc(label)}</text></g>`;
    }
    if(showFailures)for(const e of analysis.episodes.filter(e=>visible(mapTime(e.firstError))))html+=`<g data-sp-error="${esc(e.id)}" class="sp-error-mark"><title>第 ${e.turn} 轮 · ${e.reason} · ${e.failedCount} 次报错 · ${e.summary}</title><rect x="${mapTime(e.firstError)-2}" y="${base-4}" width="4" height="8" rx="1" fill="var(--error)"/><rect x="${mapTime(e.firstError)-5}" y="${base-9}" width="10" height="18" fill="transparent"/></g>`;
    const channel=(seed,cy,side)=>{
      const options=[seed,...obstacles.flatMap(r=>[r.left-11,r.right+11])].filter(x=>x>=left+3&&x<=right-3&&(!side||(side<0?x<=seed:x>=seed))).sort((a,b)=>Math.abs(a-seed)-Math.abs(b-seed));
      return options.find(x=>obstacles.every(r=>r.top>cy+2||r.bottom<base+4||x<r.left-3||x>r.right+3))??(side<0?left+3:right-3);
    };
    for(const p of placed){
      const e=p.episode,bodyLeft=p.cx-p.width/2,bodyRight=p.cx+p.width/2,entry=channel(bodyLeft-9,p.cy,-1),exit=channel(bodyRight+9,p.cy,1);
      if(p.stages.length===1){const direct=channel(p.a,p.cy,0);html+=`<path d="${spRoute([[p.a,base+3],[p.a,base+12],[direct,base+12],[direct,p.cy-14],[p.cx,p.cy-14],[p.cx,p.cy-11]])}" class="sp-failure-route"/>`;}
      else html+=`<path d="${spRoute([[p.a,base+3],[p.a,base+12],[entry,base+12],[entry,p.cy],[bodyLeft,p.cy]])}" class="sp-failure-route"/>`;
      if(e.complete)html+=`<path d="${spRoute([[bodyRight,p.cy],[exit,p.cy],[exit,base+17],[p.b,base+17],[p.b,base+3]])}" class="sp-recovery-route"/>`;
      let x=bodyLeft;
      p.stages.forEach((stage,i)=>{const width=p.widths[i],cx=x+width/2;if(i)html+=`<path d="M${x-12} ${p.cy} H${x-2}" class="sp-stage-link"/>`;html+=`<g class="sp-action ${stage.kind}" data-sp-stage="${esc(e.id)}:${i}" role="button" tabindex="0"><title>${esc(stage.label)} · ${clock(stage.time)} · 第 ${e.turn} 轮</title><rect x="${x}" y="${p.cy-11}" width="${width}" height="22" rx="4"/><text x="${cx}" y="${p.cy+4}" text-anchor="middle">${esc(stage.label)}</text></g>`;x+=width+12;});
      if(!e.complete)html+=`<path d="M${bodyRight+3} ${p.cy} H${bodyRight+13} M${bodyRight+13} ${p.cy-4} v8" class="sp-open-end"/>`;
      html+=`<text x="${p.cx}" y="${p.cy-20}" text-anchor="middle" class="sp-branch-label">${p.caption}</text>`;
    }
    for(const t of turns)for(const marker of t.markers.filter(m=>m.type==='subagent/catalog')){
      const child=data.sessions.find(c=>c.id===marker.childId);if(!child)continue;const a=mapTime(marker.time),b=mapTime(endOf(child.turns.at(-1)));if(!visible(a,b))continue;
      const x=Math.max(a+23,left+12),width=Math.max(138,Math.min(Math.max(138,b-a-23),right-x-2)),cy=base-63;
      html+=`<g class="sp-child" data-sp-child="${esc(child.id)}" role="button" tabindex="0"><title>${esc(marker.label||'子任务')} · ${child.totals.steps} 步 · ${child.totals.calls} 次工具调用 · ${child.totals.errors} 次报错</title><path d="M${a} ${base-3} C${a+16} ${base-3},${x-15} ${cy},${x} ${cy} H${x+width}" class="sp-child-route"/><text x="${x+3}" y="${cy-16}" class="sp-child-label">子任务</text><text x="${x+width-2}" y="${cy-16}" text-anchor="end" class="sp-child-label">${dur(endOf(child.turns.at(-1))-child.turns[0].start)}</text>`;
      const cStart=child.turns[0].start,cDuration=Math.max(1,endOf(child.turns.at(-1))-cStart),cx=time=>x+(time-cStart)/cDuration*width;
      for(const ct of child.turns)for(const s of ct.steps){html+=`<rect x="${cx(s.start)}" y="${cy-2}" width="${Math.max(.4,cx(s.assistantTime??s.end)-cx(s.start))}" height="4" rx="1" fill="var(--child)"/>`;for(const c of s.calls)html+=`<rect x="${cx(c.start)}" y="${cy+6}" width="${Math.max(.5,cx(c.end??c.start)-cx(c.start))}" height="3" fill="${showFailures&&c.status==='error'?'var(--error)':'var(--tool)'}"/>`;}
      html+=`<text x="${x+3}" y="${cy+24}" class="sp-small">${child.totals.steps} 步 · ${child.totals.calls} 次工具调用</text><rect x="${x}" y="${cy-10}" width="${width}" height="22" fill="transparent"/><path d="M${x+width} ${cy-4} v8" stroke="var(--child)" stroke-width="1.6"/></g>`;
    }
    html+='<g id="tl-selection"></g></g>';
    const elapsedAt=x=>{const l=layout.find(l=>x<=l.end)||layout.at(-1);return l.offset+Math.max(0,Math.min(endOf(l.turn)-l.turn.start,(x-l.x)/factor));},from=elapsedAt(left),to=elapsedAt(right),tick=[100,200,500,1000,2000,5000,10000,30000,60000,120000,300000,600000,1200000].find(v=>v>=(to-from)/6)||1200000;
    html+=`<g clip-path="url(#sp-clip)"><path d="M${left} ${axisY} H${right}" class="sp-axis-rule"/>`;
    for(let ms=Math.ceil(from/tick)*tick;ms<=to;ms+=tick){const l=layout.find(l=>ms<=l.offset+endOf(l.turn)-l.turn.start)||layout.at(-1),x=l.x+(ms-l.offset)*factor;html+=`<path d="M${x} ${axisY-4} v8" class="sp-axis-rule"/><text x="${x}" y="${axisY+20}" text-anchor="middle" class="sp-axis">${elapsed(ms)}</text>`;}
    html+=`</g><g transform="translate(${scroll},0)" class="sp-pinned"><text x="24" y="22" class="sp-small">${detail?'步骤与工具':'全览 · '+turns.length+'轮'}</text><text x="${viewportW-24}" y="22" text-anchor="end" class="sp-small">${detail?'双击动作聚焦':'分叉：并行任务 / 受阻处理'}</text></g>`;
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;
    const bind=(selector,handlers)=>$('graph').querySelectorAll(selector).forEach(el=>{for(const [name,fn] of Object.entries(handlers))el[name]=ev=>{if(name==='onclick'||name==='ondblclick'){ev.stopPropagation();if(name==='ondblclick')ev.preventDefault();}fn(el,ev);};el.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();handlers.onclick?.(el,ev);}};});
    bind('[data-sp-round]',{onmouseenter:el=>tlRoundReadout(spRound(Number(el.dataset.spRound))),onclick:el=>{const t=spRound(Number(el.dataset.spRound));tlSelectRound(t);},ondblclick:el=>{const t=spRound(Number(el.dataset.spRound));tlFocusRange(t,t.start,endOf(t));}});
    bind('[data-sp-step]',{onmouseenter:el=>{const [n,sn]=el.dataset.spStep.split(':').map(Number),t=spRound(n);tlStepReadout(t,t.steps.find(s=>s.number===sn));},onclick:el=>{const [n,sn]=el.dataset.spStep.split(':').map(Number),t=spRound(n);tlStepReadout(t,t.steps.find(s=>s.number===sn));},ondblclick:el=>{const [n,sn]=el.dataset.spStep.split(':').map(Number),t=spRound(n);tlFocusStep(t,t.steps.find(s=>s.number===sn));}});
    bind('[data-sp-batch]',{onmouseenter:el=>{const b=model.batches[Number(el.dataset.spBatch)];tlReadout(`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name} ×${b.calls.length} · ${b.end===null?'待确认':preciseTime(b.end-b.start)}`,()=>tlOpenBatch(b));},onclick:el=>{const b=model.batches[Number(el.dataset.spBatch)];tlReadout(`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name} ×${b.calls.length}`,()=>tlOpenBatch(b));},ondblclick:el=>{const b=model.batches[Number(el.dataset.spBatch)];tlFocusStep(b.turn,b.step);}});
    bind('[data-sp-error]',{onmouseenter:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.spError);tlReadout(`第 ${e.turn} 轮 · ${e.reason} · ${e.failedCount} 次报错 · ${e.summary}`,()=>openOverviewEpisode(e.id));},onclick:el=>{spSelectedEpisode=el.dataset.spError;const e=analysis.episodes.find(e=>e.id===spSelectedEpisode);tlReadout(`第 ${e.turn} 轮 · ${e.reason} · 双击聚焦处理过程`,()=>openOverviewEpisode(e.id));if(!placed.some(p=>p.episode.id===e.id))renderOverview({plotOnly:true});},ondblclick:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.spError);spSelectedEpisode=e.id;tlFocusRange(spRound(e.turn),e.firstError-1000,(e.resolvedAt??e.end)+1000);}});
    bind('[data-sp-stage]',{onmouseenter:el=>{const index=el.dataset.spStage.lastIndexOf(':'),id=el.dataset.spStage.slice(0,index),i=Number(el.dataset.spStage.slice(index+1)),e=analysis.episodes.find(e=>e.id===id),stage=e.sequence.filter(s=>s.kind!=='unknown')[i];tlReadout(`第 ${e.turn} 轮 · ${stage.label} · ${clock(stage.time)}`,()=>spOpenStage(e,stage,lookup));},onclick:el=>{const index=el.dataset.spStage.lastIndexOf(':'),e=analysis.episodes.find(e=>e.id===el.dataset.spStage.slice(0,index)),stage=e.sequence.filter(s=>s.kind!=='unknown')[Number(el.dataset.spStage.slice(index+1))];tlReadout(`第 ${e.turn} 轮 · ${stage.label} · 双击展开附近步骤`,()=>spOpenStage(e,stage,lookup));},ondblclick:el=>{const e=analysis.episodes.find(e=>e.id===el.dataset.spStage.slice(0,el.dataset.spStage.lastIndexOf(':')));spSelectedEpisode=e.id;tlFocusRange(spRound(e.turn),e.firstError-1000,(e.resolvedAt??e.end)+1000);}});
    bind('[data-sp-child]',{onmouseenter:el=>{const c=data.sessions.find(c=>c.id===el.dataset.spChild);tlReadout(`子任务 · ${c.totals.steps} 步 · ${c.totals.calls} 次调用 · ${c.totals.errors} 次报错`,()=>openChild(c.id));},onclick:el=>{const c=data.sessions.find(c=>c.id===el.dataset.spChild);tlFocusRange(turns[0],c.turns[0].start,endOf(c.turns.at(-1)));}});
    bind('[data-sp-gap]',{onmouseenter:el=>{const l=layout[Number(el.dataset.spGap)],next=layout[l.index+1];tlReadout(`第 ${l.turn.number}—${next.turn.number} 轮间等待 ${dur(next.turn.start-endOf(l.turn))}，已折叠。`);}});
    bindOverviewViewport();tlBindScroll();
  }
