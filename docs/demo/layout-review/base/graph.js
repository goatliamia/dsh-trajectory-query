  const svgText = (x,y,text,klass='graph-axis',anchor='start') => `<text x="${x}" y="${y}" class="${klass}" text-anchor="${anchor}">${esc(text)}</text>`;
  const groupsFor = steps => makeGroups(steps,!!zoom);

  function toolBatches(steps) {
    const batches=[];
    for(const step of steps) {
      const byTool=new Map();
      for(const call of step.calls) {
        const k=call.name+'|'+call.status;
        if(!byTool.has(k))byTool.set(k,{step,name:call.name,status:call.status,calls:[]});
        byTool.get(k).calls.push(call);
      }
      for(const b of byTool.values()) {
        b.start=Math.min(...b.calls.map(c=>c.start));
        b.end=b.calls.every(c=>c.end!==null)?Math.max(...b.calls.map(c=>c.end)):null;
        batches.push(b);
      }
    }
    return batches.sort((a,b)=>a.start-b.start);
  }

  function attachGraphActions(overview=false) {
    $('graph').querySelectorAll(overview?'[data-overview-turn]':'[data-group]').forEach(el=>{
      const open=()=>overview?selectTurn(Number(el.dataset.overviewTurn)):showGroup(Number(el.dataset.group));
      el.onclick=open;
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}};
    });
  }

  // Model intervals retain their actual duration. Tool pills are discrete nodes;
  // the thin interval under each pill, not its glyph width, carries duration.
  function drawRun(t,steps,mapX,base,height,{overview=false}={}) {
    const normalRights=[-Infinity,-Infinity,-Infinity,-Infinity], errorRights=[-Infinity,-Infinity];
    const topGap=overview?24:height<330?22:29;
    const batchList=toolBatches(steps), detailed=!!zoom||batchList.length<=12;
    const contents=new Map();
    const groupOf = step => overview ? t._overviewIndex : groups.findIndex(g=>g.steps.includes(step));
    const append=(index,part)=>contents.set(index,(contents.get(index)||'')+part);
    for(const s of steps) {
      const x1=mapX(s.start),x2=mapX(s.assistantTime??s.end),gi=groupOf(s);
      const fill=s.assistantTime!==null?'var(--model)':s.retries.length?'var(--warm)':'var(--unknown)';
      append(gi,`<rect x="${x1}" y="${base-4}" width="${Math.max(2,x2-x1)}" height="8" rx="3" fill="${fill}" opacity=".88"><title>第 ${s.number} 步 · ${clock(s.start)} → ${clock(s.assistantTime??s.end)} · ${s.assistantTime!==null?'模型响应':'没有完整响应记录'}</title></rect>`);
      for(const retry of s.retries) {
        const xx=mapX(retry.time);
        append(gi,`<path d="M${xx-8} ${base-9} C${xx-16} ${base-34},${xx+16} ${base-34},${xx+8} ${base-9}" fill="none" stroke="var(--warm)" stroke-width="1.8"/><path d="M${xx+4} ${base-14} L${xx+8} ${base-8} L${xx+12} ${base-14}" fill="none" stroke="var(--warm)" stroke-width="1.4"><title>模型请求重试 · ${esc(retry.failure?.code||'请求失败')} · seq ${retry.seq}</title></path>`);
      }
    }
    for(const b of batchList) {
      const bad=b.status==='error',unknown=b.end===null;
      const color=bad?'var(--error)':unknown?'var(--unknown)':'var(--tool)';
      const start=mapX(b.start),finish=mapX(b.end??b.start),cx=(start+finish)/2;
      const count=b.calls.length,nodeW=count>1?23:13;
      const rights=bad?errorRights:normalRights;
      let lane=rights.findIndex(right=>right<cx-nodeW/2-5);
      if(lane<0)lane=rights.indexOf(Math.min(...rights));
      rights[lane]=cx+nodeW/2+5;
      const cy=bad?base+57+lane*27:base-48-lane*topGap;
      const fork=mapX(b.step.assistantTime??b.start),join=mapX(b.step.end);
      const gi=groupOf(b.step),name=b.name+(count>1?' ×'+count:'');
      const label=(bad||detailed)&&!overview;
      let s=`<path class="branch ${bad?'bad':''}" d="M${fork} ${base} C${fork} ${cy+((bad?-1:1)*19)},${cx-10} ${cy},${cx} ${cy}" fill="none" stroke="${color}"/><path class="branch ${bad?'bad':''}" d="M${cx} ${cy} C${cx+10} ${cy},${join} ${cy+((bad?-1:1)*19)},${join} ${base}" fill="none" stroke="${color}" ${unknown?'stroke-dasharray="3 3"':''}/>`;
      s+=`<rect class="graph-tool-node" x="${cx-nodeW/2}" y="${cy-6}" width="${nodeW}" height="12" rx="4" fill="${color}"><title>${esc(name)} · ${b.status==='error'?'工具报错':unknown?'无结果记录':'结果已返回'} · ${clock(b.start)}${b.end===null?'':' → '+clock(b.end)} · ${count} 次调用</title></rect>`;
      if(count>1)s+=svgText(cx,cy+3,String(count),'graph-node-count','middle');
      else if(bad)s+=`<path d="M${cx-2} ${cy-2} l4 4 m0 -4 l-4 4" stroke="var(--surface)" stroke-width="1.3"/>`;
      if(b.end!==null)s+=`<line x1="${start}" x2="${Math.max(start+.8,finish)}" y1="${cy+10}" y2="${cy+10}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
      if(label)s+=svgText(cx,cy+(bad?25:-13),shorten(name,22),bad?'graph-node-bad':'graph-node-label','middle');
      append(gi,s);
    }
    for(const s of steps)for(const m of s.markers)if(m.type==='subagent/catalog') {
      const child=data.sessions.find(c=>c.id===m.childId);
      if(!child)continue;
      const a=mapX(m.time),last=endOf(child.turns.at(-1)),out=last>endOf(t),b=mapX(Math.min(last,endOf(t))),yy=23;
      const gi=groupOf(s);
      append(gi,`<path d="M${a} ${base} C${a} ${yy},${a+12} ${yy},${a+20} ${yy}" fill="none" stroke="var(--child)" stroke-width="1.4"/><line x1="${a+20}" x2="${Math.max(a+22,b)}" y1="${yy}" y2="${yy}" stroke="var(--child)" stroke-width="4" stroke-linecap="round" ${out?'stroke-dasharray="5 4"':''}/>${svgText(a+24,yy-10,`子任务 · ${child.totals.steps} 步${out?' · 跨轮继续':''}`,'graph-node-label')}`);
    }
    return contents;
  }

  function callKind(c){
    if(/^(read|grep|glob|read_image)$/.test(c.name))return 'read';
    if(/^(edit|write|apply_patch)$/.test(c.name))return 'write';
    if(/^(pwsh|bash)$/.test(c.name))return 'run';
    if(/^(web_search|web_fetch|trajectory_|session_)/.test(c.name))return 'query';
    return 'other';
  }
  function kindLabel(kind){return kind==='read'?'读取':kind==='write'?'修改':kind==='run'?'执行':kind==='query'?'查询':'动作';}
  function kindOfStep(s){
    const calls=s.calls||[];if(!calls.length)return 'other';
    const counts={};for(const c of calls){const k=callKind(c);counts[k]=(counts[k]||0)+1;}
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  }
  function callSubject(c){
    const kind=callKind(c);
    if(kind==='run'){
      const text=(c.args&&c.args.text)||'';let cmd='命令';
      try{cmd=JSON.parse(text).command||cmd;}catch{}
      cmd=String(cmd).trim().split(/\s+/)[0]||'命令';
      return kind+'|'+cmd;
    }
    if(c.target)return kind+'|'+String(c.target).split(/[\\/]/).pop().toLowerCase();
    const text=(c.args&&c.args.text)||'';
    try{const a=JSON.parse(text);const f=a.file_path||a.path||a.query||a.name;if(f)return kind+'|'+String(f).split(/[\\/]/).pop().slice(0,24);}catch{}
    return kind+'|'+c.name;
  }
  function behaviorTitle(kind,subject){
    const name=subject.split('|')[1]||'';
    const verb=kind==='read'?'读 ':kind==='write'?'改 ':kind==='run'?'跑 ':kind==='query'?'查：':'';
    return verb+name;
  }

  function renderTechnicalPath() {
    const t=turn();
    const range=zoom||[t.steps[0].number,t.steps.at(-1).number];
    const steps=t.steps.filter(s=>s.number>=range[0]&&s.number<=range[1]);
    if(!steps.length){renderActionPath();return;}
    const start=steps[0].start,end=steps.at(-1).end,duration=Math.max(1,end-start);
    groups=groupsFor(steps);
    $('turn-heading').innerHTML=`<div class="eyebrow"><strong>第 ${t.number} 轮</strong><span>${day(t.start)}</span><span>细节 · 第 ${range[0]}—${range[1]} 步</span></div><h2 class="prompt">${esc(t.title)}</h2>`;
    if($('prompt-button'))$('prompt-button').onclick=showPrompts;
    $('caption-note').textContent='这一段按动作类型归并 · 点一块看具体调用';
    const w=Math.max(620,$('graph-scroll').clientWidth),h=Math.max(220,$('graph-scroll').clientHeight-2),left=44,right=w-44,top=64,barH=64;
    const x=time=>left+Math.max(0,Math.min(1,(time-start)/duration))*(right-left);
    let html=`<title>模块细节</title><desc>把这一段里的动作按类型归并,点击一块查看原始调用。</desc>`;
    const tick=[1,2,5,10,15,30,60,120,300,600].find(n=>n>=duration/1000/6)||1200;
    for(let sec=0;sec<=duration/1000;sec+=tick){const xx=x(start+sec*1000);html+=`<line x1="${xx}" x2="${xx}" y1="36" y2="${h-30}" stroke="var(--grid)" stroke-dasharray="2 5"/>`+svgText(xx,h-10,elapsed(sec*1000),'graph-axis','middle');}
    const stages=[];
    for(const s of steps){const kind=kindOfStep(s);const last=stages.at(-1);if(last&&last.kind===kind){last.steps.push(s);last.end=s.end;}else stages.push({kind,steps:[s],start:s.start,end:s.end});}
    stages.forEach((g,i)=>{
      const a=x(g.start),b=Math.max(x(g.end),a+4),calls=g.steps.flatMap(s=>s.calls||[]),failures=calls.filter(c=>c.status==='error').length;
      const tone=failures?'var(--error)':'var(--tool)';
      const title=kindLabel(g.kind)+' '+calls.length+' 次'+(failures?' · '+failures+' 次失败':'');
      html+=`<g class="group" data-group="${i}" role="button" tabindex="0" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${a.toFixed(1)}" y="${top}" width="${Math.max(4,b-a).toFixed(1)}" height="${barH}" rx="9" fill="var(--soft)" stroke="${tone}" stroke-opacity=".4"/>`;
      if(b-a>56)html+=svgText((a+b)/2,top+26,kindLabel(g.kind),'action-title','middle')+svgText((a+b)/2,top+46,`${calls.length} 次${failures?' · '+failures+' 失败':''}`,'action-small','middle');
      html+='</g>';
    });
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;
    attachGraphActions();
  }

  const PHASE={read:'研究',query:'研究',write:'改写',run:'验证',other:'其他'};
  function actionPlan(t) {
    const list=[];let cur=null;
    for(const s of t.steps){
      const calls=s.calls||[];
      if(!calls.length){cur=null;continue;}
      const primary=calls[0],kind=callKind(primary),subject=callSubject(primary),phase=PHASE[kind]||'其他';
      const gap=s.start-(cur?cur.end:s.start);
      if(cur&&cur.phase===phase&&gap<20000){cur.steps.push(s);cur.calls.push(...calls);cur.end=s.end;continue;}
      cur={phase,kind,subject,steps:[s],calls:[...calls],start:s.start,end:s.end};
      list.push(cur);
    }
    return list.map(b=>{
      const failures=b.calls.filter(c=>c.status==='error').length;
      return {...b,title:PHASE[b.phase]||'其他',note:`${b.steps.length} 步 · ${b.calls.length} 次${failures?' · '+failures+' 次失败':''}`};
    });
  }

  function fmtTok(value){return value>=1000?(value/1000).toFixed(value>=10000?0:1)+'k':String(value);}
  const KIND={read:'#3b6ea5',write:'#b06a2c',run:'#2f7d5f',query:'#6b4fa0',other:'#5b6a7a'};
  const STEP_ICON={
    read:'<circle cx="0" cy="0" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.2 3.2 L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    write:'<path d="M-4.4 4.4 L-3.3 0.9 L3.1 -5.5 L5.2 -3.4 L-1.2 3 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    run:'<path d="M-4 -4 L-0.6 0 L-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M0.6 4 H5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    query:'<circle cx="0" cy="0" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M-4.4 0 H4.4 M0 -4.4 C-2.4 -1.5 -2.4 1.5 0 4.4 C2.4 1.5 2.4 -1.5 0 -4.4" fill="none" stroke="currentColor" stroke-width="1"/>',
    other:'<circle cx="0" cy="0" r="2.3" fill="currentColor"/>',
  };
  const COND_NAME={FS_NOT_OBSERVED:'目标文件尚未读取',FS_STALE_VERSION:'文件版本已变化',SESSION_QUERY_PERSISTENCE_FAILED:'历史存储不可用',TOOL_TIMEOUT:'调用超时',TOOL_ERROR:'调用报错'};
  function conditionName(c){const code=c&&c.error&&(c.error.code||c.error.name);return COND_NAME[code]||'调用报错';}
  function stepIcon(step){if(!step.calls.length)return STEP_ICON.other;return STEP_ICON[callKind(step.calls[0])]||STEP_ICON.other;}
  function stepLabel(step){
    if(!step.calls.length)return '回复';
    const kind=callKind(step.calls[0]),first=step.calls[0];
    const subject=(first.target?String(first.target).split(/[\\/]/).pop():'')||'';
    return kindLabel(kind)+(step.calls.length>1?' ×'+step.calls.length:(subject?' '+subject:''));
  }
  let selectedStep=0;
  function selectStep(index){selectedStep=index;renderActionPath();}
  function showStep(index){
    const t=turn(),step=t.steps[index];
    if(!step)return;
    let html='';
    for(const c of step.calls)html+=callEntry(c);
    if(!step.calls.length)html+='<div class="source-row">这一步没有工具调用,只有模型输出。</div>';
    if(step.reply)html+=`<span class="code-label">助手原文</span>${block(step.reply)}`;
    openDrawer(`第 ${t.number} 轮 · 第 ${step.number} 步`,`${clock(step.start)} → ${clock(step.end)} · ${step.calls.length} 次工具调用`,html);
  }
  function renderActionPath() {
    const t=turn(),steps=t.steps,count=steps.length;
    $('turn-heading').innerHTML='';
    if($('prompt-button'))$('prompt-button').onclick=showPrompts;
    $('caption-note').textContent='每个圆是一步 · 点圆切换下面的详情 · 双击圆看原始记录';
    const stepGap=112,left=56,right=60;
    const w=Math.max($('graph-scroll').clientWidth,left+right+Math.max(0,count-1)*stepGap+120);
    const h=Math.max(408,$('graph-scroll').clientHeight-2);
    const band={ctx:48,spine:140,label:176,clock:196,cond:216,barBase:330,barMax:72};
    const x=i=>left+30+i*stepGap;
    const prompt=t.prompts&&t.prompts[0]?String(t.prompts[0].text||'').replace(/\s+/g,' '):'';
    const errors=steps.reduce((n,s)=>n+s.calls.filter(c=>c.status==='error').length,0);
    if(selectedStep>=count)selectedStep=0;
    const sel=steps[selectedStep];
    let html=`<title>第 ${t.number} 轮行动路径</title><desc>横向的每个圆是一步。圆下的柱是这一步新增的输入 token。点击切换下方详情。</desc>`;
    html+=svgText(26,28,'第 '+t.number+' 轮 · '+(prompt?prompt.slice(0,58)+(prompt.length>58?'…':''):'（没有记录用户输入）'),'action-note','start');
    html+=svgText(w-26,28,count+' 步 · '+dur(endOf(t)-t.start)+(errors?' · '+errors+' 次失败':' · 无失败'),'action-small','end');
    // 顶部:选中这一步带着什么
    const total=(sel.inTok||0)+(sel.cacheTok||0);
    html+=svgText(26,58,'这一步带着','action-small','start');
    let cx=96;
    const segs=[[sel.cacheTok||0,'var(--branch-good)','缓存'], [sel.inTok||0,'var(--accent)','新增'], [sel.outTok||0,'var(--warm)','输出']];
    const segTotal=segs.reduce((n,s)=>n+s[0],0)||1;
    segs.forEach(([value,color])=>{
      const sw=Math.max(value?3:0,value/segTotal*260);
      if(sw>0)html+=`<rect x="${cx}" y="48" width="${sw.toFixed(1)}" height="10" rx="2" fill="${color}" fill-opacity=".55"/>`;
      cx+=sw;
    });
    html+=svgText(cx+10,58,`${total?fmtTok(total)+' tokens':'这一步没有 usage 记录'}`,'action-small','start');
    // 步骤脊柱
    html+=`<line x1="${left}" x2="${w-right}" y1="${band.spine}" y2="${band.spine}" stroke="var(--line)" stroke-width="1.4"/>`;
    const maxIn=Math.max(1,...steps.map(s=>s.inTok||0));
    const recovered=new Set();
    steps.forEach((step,si)=>{if(si>0&&step.calls.length){const prevBad=steps.slice(0,si).some(p=>p.calls.some(c=>c.status==='error'&&step.calls.some(n=>n.name===c.name)));if(prevBad)recovered.add(si);}});
    steps.forEach((step,i)=>{
      const pos=x(i),bad=step.calls.some(c=>c.status==='error'),active=i===selectedStep;
      const tone=bad?'var(--error)':(step.calls.length?'var(--tool)':'var(--unknown)');
      if(i>0)html+=`<path d="M${x(i-1)+17} ${band.spine} H${pos-18}" stroke="var(--line)" stroke-width="1.2" marker-end="url(#action-arrow)"/>`;
      html+=`<g class="action-step" data-step="${i}" role="button" tabindex="0" aria-label="${esc('第 '+step.number+' 步 · '+stepLabel(step))}"><title>${esc('第 '+step.number+' 步 · '+stepLabel(step)+' · '+dur(step.end-step.start))}</title><circle cx="${pos}" cy="${band.spine}" r="${active?17:15}" fill="var(--surface)" stroke="${tone}" stroke-width="${active?2.4:bad?2:1.4}" ${active?'stroke-dasharray="3 2"':''}/><g transform="translate(${pos} ${band.spine})" style="color:${tone}">${stepIcon(step)}</g>`;
      if(bad)html+=`<circle cx="${pos+11}" cy="${band.spine-11}" r="3.6" fill="var(--error)"/>`;
      if(recovered.has(i))html+=`<circle cx="${pos+11}" cy="${band.spine-11}" r="3.6" fill="var(--branch-good)"/>`;
      html+='</g>';
      const short=stepLabel(step).length>9?stepLabel(step).slice(0,9)+'…':stepLabel(step);
      html+=svgText(pos,band.label,short,'action-small','middle');
      html+=svgText(pos,band.clock,clock(step.start).slice(0,5),'graph-axis','middle');
      if(bad){const c=step.calls.find(c=>c.status==='error');html+=svgText(pos,band.cond,conditionName(c),'graph-axis','middle');}
      const ih=Math.max(2,Math.round((step.inTok||0)/maxIn*band.barMax));
      const barColor=bad?'var(--error)':(KIND[step.calls.length?callKind(step.calls[0]):'other']||KIND.other);
      if(step.inTok)html+=`<rect x="${pos-12}" y="${band.barBase-ih}" width="24" height="${ih}" rx="2" fill="${barColor}" fill-opacity="${active?.75:.5}"/>`+svgText(pos,band.barBase-ih-6,fmtTok(step.inTok),'graph-axis','middle');
    });
    html+=`<defs><marker id="action-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--line)"/></marker></defs>`;
    html+=svgText(26,band.barBase+18,'每步新增输入','action-small','start');
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;
    // 底部详情
    const panel=$('step-panel');
    if(panel){
      panel.classList.add('on');panel.style.display='grid';
      const calls=sel.calls||[];
      const chips=calls.map(c=>`<span class="panel-chip ${c.status==='error'?'bad':''}">${esc(c.name)}${c.status==='error'?' ✗':''}</span>`).join('');
      panel.innerHTML=`<div><h4>这一步</h4><div class="panel-title">第 ${sel.number} 步 · ${stepLabel(sel)}</div><div class="panel-meta">${clock(sel.start)} → ${clock(sel.end)} · ${dur(sel.end-sel.start)} · ${calls.length} 次调用</div><div class="panel-calls">${chips}</div><button class="action-button" id="panel-record">查看调用与回报 ↗</button> <button class="back-link" id="panel-close">收起</button></div><div><h4>这一步带着多少上下文</h4><div class="panel-row"><span>缓存读</span><span>${fmtTok(sel.cacheTok||0)}</span></div><div class="panel-row"><span>新增输入</span><span>${fmtTok(sel.inTok||0)}</span></div><div class="panel-row"><span>输出</span><span>${fmtTok(sel.outTok||0)}</span></div><div class="panel-row"><span>合计</span><span>${fmtTok((sel.cacheTok||0)+(sel.inTok||0)+(sel.outTok||0))}</span></div></div><div><h4>这一步的回复</h4><div class="panel-meta">${sel.reply?esc(String(sel.reply.text||'').replace(/\s+/g,' ').slice(0,120)):'这一步没有文字回复'}</div></div>`;
      const close=$('panel-close');
      if(close)close.onclick=()=>{panel.style.display='none';panel.classList.remove('on');};
      const button=$('panel-record');
      if(button)button.onclick=()=>showStep(selectedStep);
    }
    const graphEl=$('graph');
    if(!graphEl.__stepClick){
      graphEl.__stepClick=true;
      graphEl.addEventListener('click',(event)=>{
        const el=event.target&&event.target.closest?event.target.closest('[data-step]'):null;
        if(el)selectStep(Number(el.dataset.step));
      });
      graphEl.addEventListener('dblclick',(event)=>{
        const el=event.target&&event.target.closest?event.target.closest('[data-step]'):null;
        if(el)showStep(Number(el.dataset.step));
      });
    }
  }

  function renderPath(){
    $('canvas').classList.remove('tree-mode','spine-mode','overview-mode','lane-mode');
    $('graph-caption').innerHTML='<span class="legend-item"><i class="legend-line"></i>普通经过</span><span class="legend-item"><i class="legend-line error"></i>受阻</span><span class="legend-item"><i class="legend-line tool"></i>补齐条件后继续</span><span class="caption-note" id="caption-note"></span>';
    if(zoom)renderTechnicalPath();else renderActionPath();
  }
