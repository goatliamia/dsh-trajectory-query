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
    $('prompt-button').onclick=showPrompts;
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

  function actionPlan(t) {
    const list=[];let cur=null;
    for(const s of t.steps){
      const calls=s.calls||[];
      if(!calls.length){cur=null;continue;}
      const primary=calls[0],kind=callKind(primary),subject=callSubject(primary);
      const gap=s.start-(cur?cur.end:s.start);
      if(cur&&cur.kind===kind&&cur.subject===subject&&gap<120000){cur.steps.push(s);cur.calls.push(...calls);cur.end=s.end;continue;}
      cur={kind,subject,steps:[s],calls:[...calls],start:s.start,end:s.end};
      list.push(cur);
    }
    return list.map(b=>{
      const failures=b.calls.filter(c=>c.status==='error').length;
      return {...b,title:behaviorTitle(b.kind,b.subject),note:`${b.steps.length} 步 · ${b.calls.length} 次调用${failures?' · '+failures+' 次失败':''}`};
    });
  }

  function renderActionPath() {
    const t=turn();groups=actionPlan(t);
    $('turn-heading').innerHTML=`<div class="eyebrow"><strong>第 ${t.number} 轮</strong><span>${day(t.start)}</span><span>行动路径</span></div><h2 class="prompt">${esc(t.title)}</h2><div class="turn-subline"><span class="mono">${clock(t.start)} → ${clock(endOf(t))}</span><span>${dur(endOf(t)-t.start)}</span><span class="spacer"></span><button class="back-link" id="prompt-button" aria-label="查看本轮用户原文">查看对话 ↗</button></div>`;
    $('prompt-button').onclick=showPrompts;
    $('caption-note').textContent='先看行动，再点开记录 · 下方时间带表示真实用时';
    const available=$('graph-scroll').clientWidth,w=Math.max(1040,available),h=Math.max(318,$('graph-scroll').clientHeight-2);
    const left=38,right=w-38,gap=30,episode=groups.find(g=>g.episode),normalCount=groups.length-(episode?1:0),specialWidth=episode?Math.max(370,(w-left-38)*.40):0;
    const normalW=(w-left-38-gap*(groups.length-1)-specialWidth)/Math.max(1,normalCount),mainY=Math.round(h*.43),cardH=76;
    let cursor=left;
    const layout=groups.map(g=>{const width=g.episode?specialWidth:normalW;const o={...g,x:cursor,width};cursor+=width+gap;return o});
    const selectedDuration=endOf(t)-t.start,barLeft=left+60,barRight=right,barY=h-61;
    let html=`<title>从行动理解第 ${t.number} 轮的执行过程</title><desc>节点表示连续行动。受阻片段展开为首次尝试、补充读取、再次修改；点击节点查看真实事件。节点位置表示先后，下方时间带按真实时间等比例。</desc><defs><marker id="action-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="var(--unknown)"/></marker><marker id="recovery-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="var(--tool)"/></marker></defs>`;
    layout.forEach((g,i)=>{
      const next=layout[i+1],nodeMid=g.x+g.width/2;
      if(next)html+=`<path d="M${g.x+g.width+4} ${mainY} H${next.x-7}" fill="none" stroke="var(--ink)" stroke-width="3" marker-end="url(#action-arrow)"/>`;
      html+=`<g class="action-group" data-group="${i}" role="button" tabindex="0" aria-label="${esc(g.title+'，'+dur(g.end-g.start)+'，查看真实记录')}"><title>${esc(g.title)} · ${stepName(g)} · ${dur(g.end-g.start)}</title>`;
      if(g.episode){
        const panelTop=mainY-103,panelHeight=187,padding=14,innerGap=10,innerWidth=(g.width-padding*2-innerGap*2)/3,cy=mainY+14;
        html+=`<rect class="action-panel" x="${g.x}" y="${panelTop}" width="${g.width}" height="${panelHeight}" rx="12" fill="var(--surface)" stroke="var(--line)"/>${svgText(g.x+17,panelTop+26,g.title,'action-title')}${svgText(g.x+17,panelTop+47,g.note,'action-note')}${svgText(g.x+g.width-16,panelTop+26,dur(g.end-g.start),'action-note','end')}`;
        const stages=[{number:26,title:'首次修改受阻',note:'需先读取目标文件',state:'blocked',count:'7 处修改'},{number:27,title:'补充读取',note:'读取 2 个目标文件',state:'normal',count:'6 次读取'},{number:28,title:'再次修改完成',note:'7 处均已返回',state:'recovered',count:'7 处修改'}];
        stages.forEach((stage,j)=>{
          const step=g.steps.find(s=>s.number===stage.number),nx=g.x+padding+j*(innerWidth+innerGap),y=cy-30;
          const tone=stage.state==='blocked'?'var(--error)':stage.state==='recovered'?'var(--tool)':'var(--unknown)';
          const fill=stage.state==='blocked'?'var(--error-bg)':stage.state==='recovered'?'var(--tool-soft)':'var(--bg)';
          html+=`<rect x="${nx}" y="${y}" width="${innerWidth}" height="67" rx="8" fill="${fill}" stroke="${tone}" stroke-opacity=".28"/><text x="${nx+innerWidth/2}" y="${y+23}" class="action-stage-title" text-anchor="middle" style="fill:${tone}">${stage.title}</text>${svgText(nx+innerWidth/2,y+43,stage.count,'action-note','middle')}${svgText(nx+innerWidth/2,y+59,dur(step.end-step.start),'action-small','middle')}`;
          if(j<2)html+=`<path d="M${nx+innerWidth+1} ${cy+3} H${nx+innerWidth+innerGap-2}" stroke="${j===1?'var(--tool)':'var(--unknown)'}" stroke-width="1.3" fill="none" marker-end="url(#${j===1?'recovery-arrow':'action-arrow'})"/>`;
        });
        html+=svgText(nodeMid,cy+61,'补齐读取条件后，原来的 7 处修改继续完成','action-small','middle');
      }else{
        const y=mainY-cardH/2;
        html+=`<rect class="action-panel" x="${g.x}" y="${y}" width="${g.width}" height="${cardH}" rx="11" fill="var(--surface)" stroke="var(--line)"/><rect x="${g.x+14}" y="${y+17}" width="5" height="5" rx="1" fill="var(--unknown)"/>${svgText(g.x+28,y+24,g.title,'action-title')}${svgText(g.x+14,y+47,shorten(g.note,Math.max(10,Math.floor((g.width-26)/11))),'action-note')}${svgText(g.x+14,y+65,dur(g.end-g.start),'action-small')}`;
      }
      html+=svgText(nodeMid,g.episode?mainY+102:mainY+66,`${clock(g.start).slice(0,5)} · ${stepName(g)}`,'action-small','middle');
      html+='</g>';
    });
    html+=svgText(left,barY+8,'实际用时','action-small');
    layout.forEach((g,i)=>{
      const a=barLeft+(g.start-t.start)/selectedDuration*(barRight-barLeft),b=barLeft+(g.end-t.start)/selectedDuration*(barRight-barLeft);
      html+=`<g data-group="${i}" role="button" tabindex="0" aria-label="${esc(g.title+'的时间范围')}" style="cursor:pointer"><rect x="${a}" y="${barY}" width="${Math.max(2,b-a-2)}" height="12" rx="3" fill="var(--unknown)" opacity="${g.episode?.65:.34}"/><title>${esc(g.title)} · ${clock(g.start)} → ${clock(g.end)} · ${dur(g.end-g.start)}</title></g>`;
      if(g.episode)for(const [number,color]of[[26,'var(--error)'],[28,'var(--tool)']]){const s=g.steps.find(s=>s.number===number),a=barLeft+(s.start-t.start)/selectedDuration*(barRight-barLeft),b=barLeft+(s.end-t.start)/selectedDuration*(barRight-barLeft);html+=`<rect x="${a}" y="${barY}" width="${Math.max(2,b-a)}" height="12" rx="2" fill="${color}"/>`;}
    });
    for(let seconds=0;seconds<selectedDuration/1000;seconds+=60){const xx=barLeft+seconds*1000/selectedDuration*(barRight-barLeft);html+=svgText(xx,barY+31,elapsed(seconds*1000),'graph-axis',seconds?'middle':'start')}
    html+=svgText(barRight,barY+31,elapsed(selectedDuration),'graph-axis','end');
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width=w+'px';$('graph').innerHTML=html;attachGraphActions();
  }

  function renderPath(){
    $('canvas').classList.remove('tree-mode','spine-mode','overview-mode','lane-mode');
    $('graph-caption').innerHTML='<span class="legend-item"><i class="legend-line"></i>普通经过</span><span class="legend-item"><i class="legend-line error"></i>受阻</span><span class="legend-item"><i class="legend-line tool"></i>补齐条件后继续</span><span class="caption-note" id="caption-note"></span>';
    if(zoom)renderTechnicalPath();else renderActionPath();
  }
