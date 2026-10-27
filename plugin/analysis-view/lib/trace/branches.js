  let brSelected=null;
  const brToolNames={edit:'修改',write:'写入',read:'读取',pwsh:'命令',bash:'命令',grep:'搜索',glob:'查找',cordis_inspect_query:'运行时查询',session_search:'历史查询',session_event_search:'事件查询',run_code:'执行代码',send_message:'发送消息',list_agents:'查看子任务'};
  const brName=n=>brToolNames[n]||(n?shorten(n,18):'工具');
  const brRound=n=>session.turns.find(t=>t.number===n);
  const brGroup=(attrs,body,title)=>`<g ${attrs} data-branch-action role="button" tabindex="0"><title>${esc(title)}</title>${body}</g>`;
  const brText=(x,y,text,cls='br-label',anchor='middle')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
  const brCheck=(x,y)=>`<path d="M${x-3} ${y} l3 3 l6 -7" class="br-check"/>`;
  function brCap(x,y,condition=''){
    if(condition==='TOOL_TIMEOUT')return `<g class="br-cap"><circle cx="${x}" cy="${y}" r="5"/><path d="M${x} ${y-3} v3 l2 2"/></g>`;
    if(condition.startsWith('FS_'))return `<path d="M${x} ${y-6} v12 M${x-6} ${y} H${x}" class="br-cap"/>`;
    return `<path d="M${x-3} ${y-4} l6 8 M${x+3} ${y-4} l-6 8" class="br-cap"/>`;
  }
  function brEpisodeName(e){
    if(e.condition==='FS_NOT_OBSERVED'||e.condition==='FS_STALE_VERSION')return '修改 ×'+e.failedCount;
    if(e.condition==='TOOL_TIMEOUT')return '查询超时';
    if(e.condition==='SESSION_QUERY_PERSISTENCE_FAILED')return '历史库异常 ×'+e.failedCount;
    const call=brRound(e.turn)?.steps.flatMap(s=>s.calls).find(c=>e.failureSeqs.includes(c.seq));
    return brName(call?.name)+'报错'+(e.failedCount>1?' ×'+e.failedCount:'');
  }
  function brPack(items,gap=13){
    const rows=[];
    return items.map(item=>{let row=rows.findIndex(r=>r.every(b=>item.right+gap<=b.left||item.left>=b.right+gap));if(row<0){row=rows.length;rows.push([]);}rows[row].push(item);return {...item,row};});
  }
  function brFocusEpisode(e){
    brSelected=e.id;turnIndex=session.turns.findIndex(t=>t.number===e.turn);header();
    const all=brRound(e.turn).steps,seqs=new Set([...e.failureSeqs,...e.readSeqs,...e.pairs.map(p=>p.successSeq)]);
    const steps=all.filter(s=>s.calls.some(c=>seqs.has(c.seq)));
    const calls=steps.flatMap(s=>s.calls).filter(c=>seqs.has(c.seq));
    const start=Math.min(...calls.map(c=>c.start)),end=Math.max(...calls.map(c=>c.end??c.start));
    tlFocusRange(brRound(e.turn),start,end);
    tlReadout(`第 ${e.turn} 轮 · ${e.reason} · ${e.failedCount} 次失败${e.complete?' · 原操作随后成功':' · 原操作后续结果未确认'}`,()=>openOverviewEpisode(e.id));
  }
  function spShowSource(){
    const rows=[['真实记录',`${session.totals.turns} 轮 · ${session.totals.steps} 步 · ${session.totals.calls} 次工具调用 · ${session.totals.errors} 次显式工具报错`],['来源',session.source.file],['时间','轮内时间按同一线性比例；轮间等待用 // 折叠。概览事件是发生位置标记，放大后展开原始调用区间。'],['枝条','串行调用贴近主干；同一步真实区间重叠时展开并行枝；独立子 Agent 形成副枝。位置来自原始起止时间，不为标签搬动事件。'],['错误','文件前置条件拒绝使用截口，超时使用时钟，其他显式调用错误使用叉。失败调用自身的区间着红；后续处理经过的整段时间不着红。'],['再次尝试','虚线仅连接本轮完整参数相同、随后返回成功的原操作。成功标记表示原操作再次返回，不代表用户任务完成；没有找到后续同参成功时保持未知。'],['消息','子 Agent 的结束与报告送达分别取证。只有带发送方会话身份的真实消息形成回传连接，不推断父 Agent 已经采用。'],['缩放','全览保留全部轮次、错误事件和子任务；缩放后展开真实步骤与调用。同一步同工具同状态可以汇总数量，不按时间接近合并业务阶段。'],['证据',`每个动作可查看起止时间、调用参数、结果和 seq。${session.diagnostics.replacementEventsExcluded} 条历史替换记录不计入新执行。`],['校验 SHA-256',session.source.sha256]];
    openDrawer('图例与数据来源','原始执行记录 · 确定性规则',rows.map(([k,v])=>`<div class="source-row"><span>${esc(k)}</span>${esc(v)}</div>`).join(''));
  }
  function renderOverview({plotOnly=false}={}){
    zoom=null;groups=[];
    const canvas=$('canvas');canvas.classList.remove('lane-mode','spine-scene');canvas.classList.add('overview-mode','branch-scene');
    const vp=$('graph-scroll'),vw=Math.max(300,vp.clientWidth),gutter=29,turns=session.turns,model=tlModel(session),episodes=session.overview.episodes;
    const active=turns.reduce((n,t)=>n+endOf(t)-t.start,0),gap=Math.min(7,(vw-58)/Math.max(1,turns.length*5));
    const baseFactor=Math.max(120,vw-2*gutter-gap*(turns.length-1))/Math.max(1,active),factor=baseFactor*overviewScale;
    const layout=[];let cursor=gutter,offset=0;
    turns.forEach((t,index)=>{const length=endOf(t)-t.start;layout.push({turn:t,index,x:cursor,end:cursor+length*factor,offset});cursor+=length*factor+(index<turns.length-1?gap:0);offset+=length;});
    const w=Math.max(vw,cursor+gutter),scroll=vp.scrollLeft,left=scroll+gutter,right=scroll+vw-gutter,base=142;
    const mapTime=time=>{const l=layout.find(l=>time<=endOf(l.turn))||layout.at(-1);if(time>=l.turn.start)return l.x+Math.min(endOf(l.turn)-l.turn.start,Math.max(0,time-l.turn.start))*factor;const prev=layout[l.index-1];return prev?prev.end+Math.max(0,time-endOf(prev.turn))/Math.max(1,l.turn.start-endOf(prev.turn))*(l.x-prev.end):l.x;};
    const visible=(a,b=a)=>b>=left-90&&a<=right+90;
    const detail=false,showErrors=overviewLayers.has('failures'),showTime=overviewLayers.has('duration'),showInterrupt=overviewLayers.has('interruptions');
    overviewProjection={layout,factor,baseFactor,gutter,mapTime,mainY:base,mainBottom:base+8,visibleLeft:left,visibleRight:right};
    if(!plotOnly){
      $('turn-heading').innerHTML=`<div class="overview-heading"><div class="overview-heading-main"><strong>执行全景</strong><span>${turns.length} 轮</span></div><div class="overview-heading-meta"><span>${clock(turns[0].start).slice(0,5)} — ${clock(endOf(turns.at(-1))).slice(0,5)}</span><i></i><span>执行 ${dur(active)}</span></div></div><div class="ov-controls"><div class="ov-layer-checks">${Object.entries(focusNames).map(([id,name])=>`<label class="ov-layer-check"><input type="checkbox" data-br-layer="${id}" ${overviewLayers.has(id)?'checked':''}><span>${name}</span></label>`).join('')}</div><span class="spacer"></span><button class="ov-focus-rule" id="br-rules">图例与规则 ↗</button><div class="ov-zoom"><button id="ov-zoom-out" aria-label="缩小时间轴" ${overviewScale<=1?'disabled':''}>−</button><button id="ov-fit">${overviewScale===1?'全览':overviewScale.toFixed(overviewScale<10?1:0)+'×'}</button><button id="ov-zoom-in" aria-label="放大时间轴" ${overviewScale>=1024?'disabled':''}>＋</button></div></div><div class="br-key"><span><svg aria-hidden="true" viewBox="0 0 29 14"><path d="M1 11 C7 11 5 3 11 3 H19 C24 3 23 11 28 11" class="br-connector"/></svg>行动</span><span><svg aria-hidden="true" viewBox="0 0 29 14"><path d="M1 12 Q6 12 9 3 H27 M1 12 Q7 12 11 8 H23" class="br-connector"/></svg>并行 / 委派</span><span class="br-key-error">⊣ 拦截　◷ 超时　× 报错</span><span class="br-key-return">↻✓ 原操作后续成功</span><span>? 后续未确认</span><span class="br-key-note">${detail?'枝条按实际时间展开':'事件标记 · 点击展开'}</span></div>`;
      $('br-rules').onclick=spShowSource;
      $('turn-heading').querySelectorAll('[data-br-layer]').forEach(el=>el.onchange=()=>{el.checked?overviewLayers.add(el.dataset.brLayer):overviewLayers.delete(el.dataset.brLayer);renderOverview();});
      $('ov-zoom-in').onclick=()=>setOverviewScale(overviewScale*1.8);$('ov-zoom-out').onclick=()=>setOverviewScale(overviewScale/1.8);$('ov-fit').onclick=()=>setOverviewScale(1);
    $('graph-caption').innerHTML='<div class="tl-readout" id="tl-readout"></div><div class="br-key"><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><g class="br-cap"><path d="M3 3 L9 9 M9 3 L3 9"/></g></svg>报错</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><g class="br-cap"><circle cx="6" cy="6" r="4"/><path d="M6 3.4 V6 L7.8 7.5"/></g></svg>超时</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><path d="M2.4 6.4 L4.9 8.9 L9.7 3.1" class="br-check"/></svg>随后成功</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><text x="6" y="9" text-anchor="middle" class="br-note" font-size="10" fill="var(--branch-muted)">?</text></svg>结果未确认</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><path d="M3.2 4.2 A3.2 3.2 0 1 0 3.6 8.2" class="br-glyph"/><path d="M3.6 2 L3.3 4.4 L5.7 4.2" class="br-glyph"/></svg>请求重试</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><path d="M4.4 2.5 V9.5 M7.6 2.5 V9.5" class="br-glyph"/></svg>中断</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><text x="6" y="9" text-anchor="middle" font-size="11" fill="var(--branch-ink)">≋</text></svg>上下文压缩</span><span class="br-key-item"><svg viewBox="0 0 12 12" width="13" height="13" fill="none" aria-hidden="true"><path d="M3 8.5 L4.4 3.5 M5.2 8.5 L6.6 3.5" class="br-glyph"/></svg>等待已折叠</span></div>';
      tlReadout(tlLastReadout||'所有轮次按执行时间排列。点击错误枝条，展开失败、补充动作与再次尝试。',tlAction);
    }
    let html='';let bottom=base+42;
    html+=`<path d="M${gutter} ${base} H${cursor}" class="br-trunk"/>`;
    for(const l of layout){
      if(!visible(l.x,l.end))continue;
      const t=l.turn;let part=`<rect class="br-hit" x="${l.x}" y="${base-10}" width="${Math.max(3,l.end-l.x)}" height="20"/>`;
      for(const s of t.steps){const a=mapTime(s.start),b=mapTime(s.assistantTime??s.end);if(!visible(a,mapTime(s.end)))continue;part+=`<rect class="br-model" x="${a}" y="${base-2.5}" width="${Math.max(.4,b-a)}" height="5" rx="1"/>`;if(detail){const label=`第 ${s.number} 步 · ${preciseTime(s.end-s.start)}`,lo=Math.max(left,a),hi=Math.min(right,mapTime(s.end));part+=brGroup(`class="br-round" data-br-step="${t.number}:${s.number}"`,`<rect class="br-hit" x="${a}" y="${base-8}" width="${Math.max(3,mapTime(s.end)-a)}" height="16"/>${hi-lo>tlMeasure(label)+24?brText((lo+hi)/2,base-18,label,'br-note'):''}`,`${t.number} 轮 / ${s.number} 步 · ${preciseTime(s.end-s.start)}`);}}
      part+=`<path d="M${l.x} ${base-5} v10" stroke="var(--surface)" stroke-width="1.4"/>`;
      const a=Math.max(left,l.x),b=Math.min(right,l.end),text=showTime?`${t.number} · ${dur(endOf(t)-t.start)}`:String(t.number);
      if(!detail){if(b-a>tlMeasure(text)+12)part+=brText((a+b)/2,base-18,text,'br-round-label');else if(b-a>20)part+=brText((a+b)/2,base-18,String(t.number),'br-round-label');}
      html+=brGroup(`class="br-round" data-br-round="${t.number}"`,part,`第 ${t.number} 轮 · ${dur(endOf(t)-t.start)} · ${t.steps.length} 步 · ${t.calls} 次调用`);
      const next=layout[l.index+1];if(next&&visible(l.end,next.x)){const x=(l.end+next.x)/2;html+=brGroup(`class="br-gap" data-br-gap="${l.index}"`,`<rect x="${l.end}" y="${base-5}" width="${gap}" height="10" fill="var(--surface)"/><path d="M${x-2.5} ${base+3} l2 -6 M${x+.5} ${base+3} l2 -6" class="br-glyph"/>`,`轮间等待 ${dur(next.turn.start-endOf(t))}，已折叠`);}
      if(showInterrupt){
        const retryTimes=t.steps.flatMap(s=>s.retries.map(r=>r.time));
        const retries=retryTimes.length;
        if(retries){const x=mapTime(Math.min(...retryTimes));html+=brGroup(`class="br-marker" data-br-round="${t.number}"`,`<rect x="${x-12}" y="${base-48}" width="28" height="18" fill="transparent"/>`+brText(x,base-36,'↻'+retries,'br-label'),`本轮共 ${retries} 次模型请求重试`);}
        if(stopLabel(t.reason?.kind)){const x=l.end;html+=brGroup(`class="br-marker" data-br-stop="${t.number}"`,`<path d="M${x-2} ${base-6} v12 M${x+2} ${base-6} v12" class="br-glyph"/>`,stopLabel(t.reason.kind));}
        for(const m of t.markers.filter(m=>m.type==='compaction/start')){const x=mapTime(m.time);if(visible(x))html+=brGroup(`class="br-marker" data-br-round="${t.number}"`,brText(x,base-34,'≋','br-label'),'上下文压缩开始');}
      }
    }
    if(!detail&&showErrors){
      const specs=episodes.filter(e=>visible(mapTime(e.firstError))).map(e=>{const x=mapTime(e.firstError),label=`${String(e.turn).padStart(2,'0')} · ${brEpisodeName(e)}`,width=Math.max(88,tlMeasure(label)+16),cx=Math.max(left+width/2,Math.min(right-width/2,x));return {e,x,label,cx,left:cx-width/2,right:cx+width/2};});
      const occupied=[],slots=[27,-52,63,-100,99,135,171];
      const childBounds=turns.flatMap(t=>t.markers.filter(m=>m.type==='subagent/catalog').map(m=>{const c=data.sessions.find(s=>s.id===m.childId);return c?{left:mapTime(m.time)-78,right:mapTime(endOf(c.turns.at(-1)))+110}:null;})).filter(Boolean);
      const packed=specs.map(p=>{let row=slots.findIndex((dy,i)=>!(dy<0&&childBounds.some(b=>p.left<b.right&&p.right>b.left))&&(occupied[i]||[]).every(b=>p.right+18<=b.left||p.left>=b.right+18));if(row<0){row=slots.length;slots.push(35+row*48);}if(!occupied[row])occupied[row]=[];occupied[row].push(p);return {...p,row};});
      for(const p of packed){
        const dy=slots[p.row],y=base+dy,e=p.e,sign=dy>0?1:-1;if(dy>0)bottom=Math.max(bottom,y+25);
        let part=`<rect class="br-hover" x="${p.left-6}" y="${dy>0?y-13:y-30}" width="${p.right-p.left+12}" height="43" rx="5"/><path d="M${p.x} ${base+sign*2} V${y-sign*10} Q${p.x} ${y} ${p.x+10} ${y} H${p.x+14}" class="br-connector"/>`;
        part+=brCap(p.x+18,y,e.condition);
        if(e.complete)part+=`<path d="M${p.x+25} ${y} h6" class="br-association"/>`+brCheck(p.x+37,y);
        else part+=brText(p.x+33,y+4,'?','br-note');
        part+=brText(p.cx,dy>0?y+21:y-14,p.label,'br-label'+(e.complete?'':' bad'));
        html+=brGroup(`class="br-incident" data-br-episode="${e.id}"`,part,`第 ${e.turn} 轮 · ${e.reason} · ${e.failedCount} 次失败 · ${e.summary}`);
      }
    }
    const nodeSpecs=[];
    if(detail){
      for(const b of model.batches){
        const start=mapTime(b.start),end=mapTime(b.end??b.start);if(end<left||start>right)continue;
        const label=brName(b.name)+(b.calls.length>1?' ×'+b.calls.length:''),textWidth=tlMeasure(label)+24;
        const cx=Math.max(left+textWidth/2,Math.min(right-textWidth/2,(start+end)/2));
        nodeSpecs.push({b,start,end,cx,label,left:Math.min(start,cx-textWidth/2)-9,right:Math.max(end,cx+textWidth/2)+12});
      }
      nodeSpecs.sort((a,b)=>a.b.step.start-b.b.step.start||a.end-b.end);
      const packed=brPack(nodeSpecs,12),nodeRows=packed.length?Math.max(...packed.map(p=>p.row))+1:0;
      for(const p of packed){
        const b=p.b,y=base+39+p.row*44,bad=showErrors&&b.status==='error',unknown=b.end===null;
        const fork=mapTime(b.step.assistantTime??b.start),join=mapTime(b.end??b.start),condition=b.calls.find(c=>c.error)?.error?.code||(b.calls.some(c=>/timed out after \d+ms/.test(c.result?.text||''))?'TOOL_TIMEOUT':'');
        bottom=Math.max(bottom,y+23);
        const ramp=Math.min(8,Math.max(0,(p.end-p.start)/3));
        let part=`<rect class="br-hover" x="${p.cx-(tlMeasure(p.label)+26)/2}" y="${y-24}" width="${tlMeasure(p.label)+26}" height="48" rx="5"/><path d="M${fork} ${base+1} C${fork} ${y-9} ${fork} ${y} ${fork+ramp} ${y}" class="br-connector"/>`;
        const parallel=b.calls.length>1&&b.calls.some((c,i)=>b.calls.slice(i+1).some(n=>c.end!==null&&n.end!==null&&Math.max(c.start,n.start)<Math.min(c.end,n.end)));
        if(parallel&&b.calls.length<=12){
          const ordered=[...b.calls].sort((a,b)=>(b.end??b.start)-(a.end??a.start));
          ordered.forEach((c,i)=>{const cy=y+(i-(ordered.length-1)/2)*2.5,a=mapTime(c.start),end=mapTime(c.end??c.start);part+=`<path d="M${fork} ${base+1} C${fork} ${cy} ${a-2} ${cy} ${a} ${cy} H${Math.max(a+1.3,end)}" class="br-connector"/><rect x="${a}" y="${cy-1}" width="${Math.max(1.3,end-a)}" height="2" class="br-body ${bad?'bad':''}"/>`;});
        }else part+=`<rect x="${p.start}" y="${y-2.5}" width="${Math.max(1.5,p.end-p.start)}" height="5" rx=".8" class="br-body ${bad?'bad':unknown?'unknown':''}"/>`;
        if(bad)part+=brCap(p.end+5,y,condition);else if(unknown)part+=brText(p.end+9,y+4,'?','br-note');
        if(!unknown)part+=`<path d="M${p.end+(bad?13:2)} ${y} C${p.end+(bad?13:2)} ${y+12} ${join+2} ${base+12} ${join+2} ${base+2}" class="br-return"/>`;
        part+=brText(p.cx,y-(parallel?19:12),p.label,'br-label'+(bad?' bad':''));
        if(showTime)part+=brText(p.cx,y+19,unknown?'结果未记录':(parallel?'并行 · ':'')+preciseTime(b.end-b.start),'br-note');
        html+=brGroup(`class="br-action" data-br-batch="${b.index}"`,part,`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name} ×${b.calls.length} · ${bad?'调用失败':unknown?'结果未记录':'结果已返回'}`);
      }
      if(showErrors){
        const specs=episodes.filter(e=>e.pairs.length&&visible(mapTime(e.firstError),mapTime(e.resolvedAt??e.pairs.at(-1).successTime))).map(e=>{const a=mapTime(e.firstError),b=mapTime(e.resolvedAt??Math.max(...e.pairs.map(p=>p.successTime)));return {e,a,b,left:a-6,right:b+6};}).filter(p=>p.b-p.a>32);
        const relationBase=base+nodeRows*44+39;
        for(const p of brPack(specs,20)){
          const y=relationBase+p.row*36;bottom=Math.max(bottom,y+21);
          const label=`${p.e.readConfirmed?'补读后 · ':''}原操作成功 ${p.e.confirmedCount}/${p.e.failedCount}`;
          let part=`<rect x="${Math.max(left,p.a)-4}" y="${y-15}" width="${Math.max(20,Math.min(right,p.b)-Math.max(left,p.a)+12)}" height="34" rx="5" class="br-hover"/><path d="M${p.a} ${y-8} v8 Q${p.a} ${y+6} ${p.a+6} ${y+6} H${p.b-6} Q${p.b} ${y+6} ${p.b} ${y} v-8" class="br-association"/>`;
          if(p.b-p.a>tlMeasure(label)+30)part+=brText((Math.max(left,p.a)+Math.min(right,p.b))/2,y-3,label,'br-note');
          part+=brCheck(p.b+5,y-8);
          html+=brGroup(`class="br-relation" data-br-proof="${p.e.id}"`,part,`${p.e.reason} · ${p.e.summary} · 经过 ${preciseTime(p.e.continuationMs??0)}`);
        }
      }
    }
    for(const t of turns)for(const m of t.markers.filter(m=>m.type==='subagent/catalog')){
      const child=data.sessions.find(s=>s.id===m.childId);if(!child)continue;
      const a=mapTime(m.time),b=mapTime(endOf(child.turns.at(-1))),y=base-79;if(!visible(a,b))continue;
      const ramp=Math.min(18,Math.max(2,(b-a)/5));
      let part=`<path d="M${a} ${base-2} C${a} ${base-24} ${a+ramp} ${y} ${a+ramp} ${y} H${b}" class="br-child-path"/>`;
      for(const ct of child.turns)for(const s of ct.steps){const x1=mapTime(s.start),x2=mapTime(s.assistantTime??s.end);if(visible(x1,x2))part+=`<rect x="${x1}" y="${y-2}" width="${Math.max(.5,x2-x1)}" height="4" class="br-child-body"/>`;for(const c of s.calls){const x=mapTime(c.start),end=mapTime(c.end??c.start);if(visible(x,end))part+=`<path d="M${x} ${y+3} v4 h${Math.max(.6,end-x)}" class="${showErrors&&c.status==='error'?'br-cap':'br-return'}"/>`;}}
      part+=`<path d="M${b} ${y-4} v8" class="br-child-path"/>`;
      const label=`子 Agent · ${child.totals.steps} 步 · ${child.totals.calls} 次调用`,cx=Math.max(left+tlMeasure(label)/2,Math.min(right-tlMeasure(label)/2,(a+b)/2));
      part+=brText(cx,y-16,label,'br-label')+brText(Math.max(left,a+ramp),y+24,dur(endOf(child.turns.at(-1))-child.turns[0].start),'br-note','start');
      const reports=(session.communications||[]).filter(r=>r.childId===child.id&&r.kind==='agent-message');
      if(reports.length){const delivery=mapTime(reports[0].time);part+=`<path d="M${b} ${y} C${b+8} ${y} ${delivery} ${base-12} ${delivery} ${base-2}" class="br-child-return"/><path d="M${delivery-3} ${base-7} l3 5 l3 -5" class="br-glyph"/>`;if(visible(delivery))part+=brText(delivery+12,y+43,`回报送达 ×${reports.length}`,'br-note','start');}
      part+=`<rect class="br-hit" x="${Math.max(left,a)-5}" y="${y-28}" width="${Math.max(20,Math.min(right,b)-Math.max(left,a)+10)}" height="62"/>`;
      html+=brGroup(`class="br-child" data-br-child="${child.id}"`,part,`${m.label||'子 Agent'} · ${dur(endOf(child.turns.at(-1))-child.turns[0].start)} · ${reports.length} 条主动回报已送达`);
    }
    const h=Math.max(332,bottom+73),axisY=h-35;
    let axis=`<path d="M${left} ${axisY} H${right}" class="br-rule"/>`;
    const span=(right-left)/factor,step=[100,200,500,1000,2000,5000,10000,30000,60000,120000,300000,600000,1200000].find(v=>v>=span/7)||1200000;
    let lastTick=-Infinity;
    for(const l of layout){if(!visible(l.x,l.end))continue;const start=Math.max(l.offset,l.offset+(left-l.x)/factor),end=Math.min(l.offset+endOf(l.turn)-l.turn.start,l.offset+(right-l.x)/factor);for(let ms=Math.ceil(start/step)*step;ms<=end;ms+=step){const x=l.x+(ms-l.offset)*factor;if(x-lastTick<55)continue;lastTick=x;axis+=`<path d="M${x} ${axisY-4} v8" class="br-rule"/>`+brText(x,axisY+20,ms<60000?preciseTime(ms):elapsed(ms),'br-axis');}}
    const visibleTurns=layout.filter(l=>l.end>=left&&l.x<=right).map(l=>l.turn.number);
    const mode=detail?`第 ${visibleTurns.join('、')} 轮 · 动作展开`:'全览 · 事件折叠';
    html=`<title>执行主干与行动枝条</title><desc>主干按真实时间排列；独立子任务从主干发出，回报按实际送达位置连接。放大后展开调用、失败截口和有证据的再次尝试。横向长度表示时间，轮间等待折叠。</desc><defs><clipPath id="br-clip"><rect x="${scroll}" y="0" width="${vw}" height="${h}"/></clipPath></defs><g clip-path="url(#br-clip)">${html}<g id="tl-selection"></g>${axis}</g><g transform="translate(${scroll},0)">${brText(gutter,18,mode,'br-note','start')}${brText(vw-gutter,18,'累计执行时间','br-note','end')}</g>`;
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;
    const bind=(selector,enter,click,dbl)=>$('graph').querySelectorAll(selector).forEach(el=>{el.onmouseenter=()=>enter?.(el);el.onclick=ev=>{ev.stopPropagation();click?.(el);};el.ondblclick=ev=>{ev.preventDefault();ev.stopPropagation();(dbl||click)?.(el);};el.onkeydown=ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();click?.(el);}};});
    bind('[data-br-round]',el=>tlRoundReadout(brRound(Number(el.dataset.brRound))),el=>{const t=brRound(Number(el.dataset.brRound));turnIndex=turns.indexOf(t);header();tlFocusRange(t,t.start,endOf(t));tlRoundReadout(t);});
    bind('[data-br-step]',el=>{const [n,k]=el.dataset.brStep.split(':').map(Number),t=brRound(n);tlStepReadout(t,t.steps.find(s=>s.number===k));},el=>{const [n,k]=el.dataset.brStep.split(':').map(Number),t=brRound(n);tlOpenStep(t,t.steps.find(s=>s.number===k));});
    bind('[data-br-episode]',el=>{const e=episodes.find(e=>e.id===el.dataset.brEpisode);tlReadout(`第 ${e.turn} 轮 · ${e.reason} · ${e.failedCount} 次失败 · ${e.summary}，点击展开`,()=>openOverviewEpisode(e.id));},el=>openOverviewEpisode(el.dataset.brEpisode));
    bind('[data-br-batch]',el=>{const b=model.batches[Number(el.dataset.brBatch)];tlReadout(`第 ${b.turn.number} 轮 / 第 ${b.step.number} 步 · ${b.name} ×${b.calls.length} · ${b.end===null?'结果未记录':preciseTime(b.end-b.start)}${b.status==='error'?' · '+(b.calls.find(c=>c.error)?.error?.code||'调用失败'):''}`,()=>tlOpenBatch(b));},el=>tlOpenBatch(model.batches[Number(el.dataset.brBatch)]));
    bind('[data-br-proof]',el=>{const e=episodes.find(e=>e.id===el.dataset.brProof);tlReadout(`原操作随后成功 ${e.confirmedCount}/${e.failedCount} · ${e.summary} · 处理经过 ${preciseTime(e.continuationMs??0)}`,()=>openOverviewEpisode(e.id));},el=>openOverviewEpisode(el.dataset.brProof));
    bind('[data-br-child]',el=>{const c=data.sessions.find(s=>s.id===el.dataset.brChild);tlReadout(`子 Agent · ${c.totals.steps} 步 · ${c.totals.calls} 次调用 · ${c.totals.errors} 次报错`,()=>openChild(c.id));},el=>openChild(el.dataset.brChild));
    bind('[data-br-gap]',el=>{const l=layout[Number(el.dataset.brGap)],next=layout[l.index+1];tlReadout(`第 ${l.turn.number}—${next.turn.number} 轮间等待 ${dur(next.turn.start-endOf(l.turn))}，已折叠。`);},()=>{});
    bind('[data-br-stop]',el=>tlReadout(`第 ${el.dataset.brStop} 轮 · ${stopLabel(brRound(Number(el.dataset.brStop)).reason.kind)}`),el=>openOverviewRound(Number(el.dataset.brStop),'interruptions'));
    bindOverviewViewport();tlBindScroll();
  }
