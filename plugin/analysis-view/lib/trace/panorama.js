  let overviewScale=1;
  const overviewLayers=new Set(['failures','duration','interruptions']);
  let overviewProjection=null,overviewViewportBound=false;
  function setOverviewScale(nextScale,viewportX){
    const viewport=$('graph-scroll'),position=viewportX??viewport.clientWidth/2;
    let anchor=null;
    if(overviewProjection){
      const px=viewport.scrollLeft+position,p=overviewProjection;
      const segment=p.layout.find(l=>px<=l.end)||p.layout.at(-1);
      if(segment)anchor={index:segment.index,offset:Math.max(0,Math.min(endOf(segment.turn)-segment.turn.start,(px-segment.x)/p.factor))};
    }
    overviewScale=Math.max(1,Math.min(1024,nextScale));renderOverview();
    if(overviewScale===1){viewport.scrollLeft=0;return;}
    if(anchor){const p=overviewProjection,l=p.layout[anchor.index];viewport.scrollLeft=l.x+anchor.offset*p.factor-position;}
  }
  function bindOverviewViewport(){
    if(overviewViewportBound)return;overviewViewportBound=true;
    const viewport=$('graph-scroll');let drag=null,suppressClickUntil=0,wheelFrame=0,pendingScale=1,pendingX=0;
    viewport.addEventListener('wheel',e=>{
      if(view!=='overview'||$('canvas').classList.contains('drawer-open')||e.altKey)return;
      e.preventDefault();
      if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){viewport.scrollLeft+=e.deltaX||e.deltaY;return;}
      const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1);
      pendingScale=Math.max(1,Math.min(1024,(wheelFrame?pendingScale:overviewScale)*Math.exp(-delta*.0018)));
      pendingX=e.clientX-viewport.getBoundingClientRect().left;
      if(!wheelFrame)wheelFrame=requestAnimationFrame(()=>{wheelFrame=0;if(view==='overview')setOverviewScale(pendingScale,pendingX);});
    },{passive:false});
    viewport.addEventListener('pointerdown',e=>{
      if(view!=='overview'||e.button!==0||$('canvas').classList.contains('drawer-open'))return;
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,moved:false};
    });
    viewport.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.moved&&Math.abs(dx)>5&&Math.abs(dx)>Math.abs(dy)){drag.moved=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('ov-dragging');}
      if(drag.moved){e.preventDefault();viewport.scrollLeft=drag.left-dx;}
    });
    const endDrag=e=>{if(!drag||e.pointerId!==drag.id)return;if(drag.moved){suppressClickUntil=performance.now()+250;e.preventDefault();}if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);drag=null;viewport.classList.remove('ov-dragging');};
    viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);
    viewport.addEventListener('click',e=>{if(view==='overview'&&performance.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
    viewport.addEventListener('dblclick',e=>{if(view==='overview'&&!e.target.closest('[data-overview-turn],[data-key-round],[data-overview-child],[data-branch-action]')){e.preventDefault();setOverviewScale(1);}});
  }
  const preciseTime=ms=>ms<1000?`${Math.round(ms)} 毫秒`:ms<60000?`${(ms/1000).toFixed(1)} 秒`:dur(ms);
  const stopLabel=kind=>({aborted:'用户停止',interrupted:'新输入中断',error:'本轮出错'}[kind]);
  const focusNames={failures:'错误与接续',duration:'轮次耗时',interruptions:'中断与重试'};
  const focusRules={
    failures:'纳入所有显式工具错误，按实际问题归组。主图先展开修改受阻最多、失败调用耗时最长、服务不可用三类代表；其他受阻保留主线原位标记，点击可换入查看。成功后处理路径接回主线，未确认结果的分支保持开放。',
    duration:'所有轮次统一按起止时间计时。条段宽度表示真实执行时长，轮间等待明确折叠；文字能放下时统一显示编号和时长，任一轮悬停都可查看完整耗时。双击轮次聚焦并展开步骤与工具。',
    interruptions:'纳入 turn/end 为停止、中断或错误的轮次，以及有 llm/retry 的轮次。优先标注中断，其次请求重试较多的轮次；图上最多常显8轮。'
  };
  function focusOverview(index){turnIndex=Math.max(0,Math.min(session.turns.length-1,index));view='overview';zoom=null;closeDrawer();render();tlFocusRange(turn(),turn().start,endOf(turn()));}
  const overviewFact=number=>session.overview.turns.find(f=>f.turn===number);
  const overviewTurn=number=>session.turns.find(t=>t.number===number);
  function factLabel(f,focus='failures'){
    if(focus==='duration')return {title:`第 ${f.turn} 轮 · ${dur(f.durationMs)}`,note:`${f.steps} 步 · ${f.calls} 次调用`,tone:'normal'};
    if(focus==='interruptions')return {title:`第 ${f.turn} 轮 · ${f.stop?stopLabel(f.stop):'请求重试'}`,note:f.retryCount?`${f.retryCount} 次模型请求重试`:'本轮提前结束',tone:'normal'};
    return {title:`第 ${f.turn} 轮 · ${f.errors} 次报错`,note:f.summary.replace('段受阻，均有后续成功','段受阻后均成功'),tone:f.unconfirmedCount?'unknown':'recovered'};
  }
  function whyThisTurn(f,focus='failures'){
    if(focus==='duration')return `本轮执行 ${dur(f.durationMs)}，从 ${clock(overviewTurn(f.turn).start)} 到 ${clock(endOf(overviewTurn(f.turn)))}，不包含轮间等待。`;
    if(focus==='interruptions')return [f.stop?`结束记录：${stopLabel(f.stop)}`:'',f.retryCount?`${f.retryCount} 次模型请求重试`:''].filter(Boolean).join('；')+'。';
    return f.unconfirmedCount?`${f.unconfirmedCount} 次失败调用尚未找到同一轮、完全相同参数的后续成功；这不等于本轮任务失败。`:f.episodeCount>1?`同一轮中出现 ${f.episodeCount} 段独立受阻，分别有后续成功。`:`${f.errors} 次工具报错，原调用随后均返回成功；最长间隔 ${preciseTime(f.continuationMs)}。`;
  }
  function openOverviewEpisode(id){
    const e=session.overview.episodes.find(e=>e.id===id),t=overviewTurn(e.turn),all=t.steps.flatMap(s=>s.calls),find=seq=>all.find(c=>c.seq===seq);
    let html=`<div class="ov-evidence-summary"><div><span>失败调用</span><strong>${e.failedCount} 次</strong></div><div><span>原调用后续成功</span><strong>${e.confirmedCount} / ${e.failedCount}</strong></div><div><span>再次成功的间隔</span><strong>${e.continuationMs===null?'待确认':preciseTime(e.continuationMs)}</strong></div></div>`;
    html+=`<div class="ov-episode-flow">${e.sequence.map(s=>`<div class="ov-episode-stage ${s.kind}"><i></i><strong>${esc(s.label)}</strong><span>${clock(s.time)}</span></div>`).join('')}</div>`;
    html+=`<p class="drawer-note">${esc(e.reason)}${e.targets.length?`，涉及 ${e.targets.length} 个目标文件`:''}。${e.complete?`${e.readConfirmed?'读取目标文件后，':''}原操作在 ${preciseTime(e.continuationMs)} 内再次返回成功。`:'原操作的后续结果尚未确认。'}</p>`;
    if(e.complete)html+=`<details class="ov-proof"><summary>查看识别依据</summary><div class="source-row">失败之后，同一工具以完全相同的参数再次返回成功。间隔从第一条错误结果算到最后一条对应成功结果。${e.readConfirmed?`其间记录了 ${e.readSeqs.length} 次成功读取，覆盖所有 ${e.targets.length} 个目标文件。`:''}</div></details>`;
    else html+='<details class="ov-proof"><summary>查看识别依据</summary><div class="source-row">没有找到全部原调用的后续成功。可能换了工具或参数，不据此认定整轮失败。</div></details>';
    html+=`<div class="drawer-actions"><button class="action-button primary" id="episode-round">查看第 ${e.turn} 轮行动路径 ↗</button></div><h3>失败调用 · 原始记录</h3>`+e.failureSeqs.map(find).filter(Boolean).map(callEntry).join('');
    if(e.readSeqs.length)html+='<h3>补充读取 · 原始记录</h3>'+e.readSeqs.map(find).filter(Boolean).map(callEntry).join('');
    if(e.pairs.length)html+='<h3>对应成功 · 原始记录</h3>'+[...new Set(e.pairs.map(p=>p.successSeq))].map(find).filter(Boolean).map(callEntry).join('');
    openDrawer(`第 ${e.turn} 轮 · ${e.reason}`,`第 ${e.steps.join('、')} 步 · ${e.summary}`,html);
    $('episode-round').onclick=()=>selectTurn(session.turns.indexOf(t));
  }
  function openOverviewRound(number,focus='failures'){
    const f=overviewFact(number),t=overviewTurn(number),episodes=session.overview.episodes.filter(e=>e.turn===number);
    let html=`<div class="ov-evidence-summary"><div><span>本轮执行</span><strong>${dur(f.durationMs)}</strong></div><div><span>工具调用</span><strong>${f.calls} 次</strong></div><div><span>独立受阻事件</span><strong>${f.episodeCount} 件</strong></div></div><p class="drawer-note">${esc(whyThisTurn(f,focus))}</p>`;
    if(episodes.length)html+='<div class="ov-bucket-list">'+episodes.map(e=>`<button class="ov-bucket-item" data-episode="${esc(e.id)}"><span class="ov-bucket-item-head"><strong>${esc(e.reason)}</strong><b>${e.failedCount} 次报错</b></span><span class="ov-bucket-item-reason">${esc(e.summary)}</span><span class="ov-bucket-item-meta"><span>第 ${e.steps.join('、')} 步${e.targets.length?' · '+e.targets.length+' 个文件':''}</span><span class="${e.complete?'ov-recovered':''}">${e.complete?preciseTime(e.continuationMs)+' 后原调用成功':'后续结果待确认'}</span></span></button>`).join('')+'</div>';
    const retries=t.steps.flatMap(s=>s.retries.map(r=>({s,r})));
    if(f.stop||retries.length){html+='<h3>结束与请求记录</h3>';if(f.stop)html+=`<div class="source-row"><span>${clock(endOf(t))}</span>${stopLabel(f.stop)}</div>`;html+=retries.map(({s,r})=>`<div class="source-row"><span>第 ${s.number} 步 · ${clock(r.time)}</span>模型请求重试 · ${esc(r.failure?.code||'请求失败')} · 日志退避等待 ${preciseTime(r.delayMs||0)}</div>`).join('');}
    html+=`<div class="drawer-actions" style="margin-top:20px"><button class="action-button primary" id="overview-to-path">查看本轮行动路径 ↗</button></div><h3>本轮用户原文</h3><div class="original-prompt">${esc(t.title)}</div>`;
    openDrawer(`第 ${number} 轮`,`${clock(t.start)} → ${clock(endOf(t))} · ${f.steps} 步`,html);
    $('drawer-body').querySelectorAll('[data-episode]').forEach(b=>b.onclick=()=>openOverviewEpisode(b.dataset.episode));
    $('overview-to-path').onclick=()=>selectTurn(session.turns.indexOf(t));
  }
  function openOverviewFocusList(){
    let html=overviewLayers.size?'':'<p class="drawer-note">勾选关注项后，会在同一张图上显示对应的信息。</p>';
    for(const focus of overviewLayers){const order=focus==='duration'?session.turns.map(t=>t.number):session.overview.focus[focus];html+=`<h3>${focusNames[focus]} · ${order.length} 轮</h3><p class="drawer-note">${focusRules[focus]}</p><div class="ov-bucket-list">`;
      html+=order.map(number=>{const f=overviewFact(number),label=factLabel(f,focus);return `<button class="ov-bucket-item" data-key-turn="${number}" data-key-focus="${focus}"><span class="ov-bucket-item-head"><strong>${label.title}</strong></span><span class="ov-bucket-item-reason">${esc(label.note)}</span></button>`;}).join('')+'</div>';
    }
    html+='<h3>受阻事件如何划分</h3><p class="drawer-note">先以单轮为边界。同一步产生的同类错误作为一批；后续错误只有在涉及相同操作对象、且先前问题还没有成功结束时才接入。同轮的历史存储不可用按同一个服务故障归组。成功后再失败另起一件，不跨轮合并。</p>';
    openDrawer('图层与选择依据',`${overviewLayers.size} 类信息已勾选 · 选择与分组不随缩放改变`,html);
    $('drawer-body').querySelectorAll('[data-key-turn]').forEach(b=>b.onclick=()=>openOverviewRound(Number(b.dataset.keyTurn),b.dataset.keyFocus));
  }

