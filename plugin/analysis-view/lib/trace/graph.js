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

  function renderActionPath() {
    const t=turn();groups=actionPlan(t);
    $('turn-heading').innerHTML='';
    if($('prompt-button'))$('prompt-button').onclick=showPrompts;
    $('caption-note').textContent='三条道:研究 / 改写 / 验证 · 横轴是真实时间 · 红刻线是失败的调用';
    const w=Math.max(640,$('graph-scroll').clientWidth),h=Math.max(240,$('graph-scroll').clientHeight-2);
    const left=64,right=w-28,top=64,laneH=44,barH=14;
    const startTime=t.start,endTime=endOf(t),duration=Math.max(1,endTime-startTime);
    const x=time=>left+Math.max(0,Math.min(1,(time-startTime)/duration))*(right-left);
    const LANES=[['研究','#4f73a0'],['改写','#a06a35'],['验证','#2f7d5f']];
    let html=`<title>第 ${t.number} 轮行动路径</title><desc>三条泳道分别是研究、改写、验证。横向是真实时间,每根细条是一段连续动作,红刻线是失败的调用。</desc>`;
    const prompt=t.prompts&&t.prompts[0]?String(t.prompts[0].text||'').replace(/\s+/g,' ').slice(0,64):'';
    html+=svgText(left,26,'第 '+t.number+' 轮'+(prompt?' · '+prompt+(prompt.length>=64?'…':''):''),'action-small','start');
    LANES.forEach(([name,color],li)=>{
      const y=top+li*laneH;
      html+=svgText(left-12,y+11,name,'action-small','end');
      html+=`<line x1="${left}" x2="${right}" y1="${y+laneH/2}" y2="${y+laneH/2}" stroke="var(--grid)" stroke-dasharray="2 4"/>`;
      const laneGroups=groups.filter(g=>g.phase===name);
      laneGroups.forEach((g,gi)=>{
        const a=x(g.start),b=Math.max(x(g.end),a+2);
        const bad=g.calls.filter(c=>c.status==='error').length>0;
        const title=name+' · '+g.note;
        html+=`<g class="action-block" data-group="${groups.indexOf(g)}" role="button" tabindex="0" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${a.toFixed(1)}" y="${y+3}" width="${(b-a).toFixed(1)}" height="${barH}" rx="3" fill="${color}" fill-opacity=".62"/>`;
        if(bad)html+=`<rect x="${a.toFixed(1)}" y="${y+3+barH}" width="${(b-a).toFixed(1)}" height="2" fill="var(--error)" fill-opacity=".9"/>`;
        html+='</g>';
        if(b-a>52)html+=svgText((a+b)/2,y+3+barH+16,g.note,'action-small','middle');
      });
      for(const g of laneGroups){for(const c of g.calls){if(c.status!=='error')continue;const xx=x(c.start);html+=`<path d="M${xx.toFixed(1)} ${y-2} v${barH+10}" stroke="var(--error)" stroke-width="1" stroke-opacity=".55"/>`;}}
    });
    const tick=[10,15,30,60,120,300,600].find(n=>n>=duration/1000/6)||900;
    for(let sec=0;sec<=duration/1000;sec+=tick){const xx=x(startTime+sec*1000);html+=svgText(xx,top+LANES.length*laneH+22,elapsed(sec*1000),'graph-axis','middle');}
    html+=svgText(left,top+LANES.length*laneH+22,clock(startTime).slice(0,5),'graph-axis','start');
    html+=svgText(right,top+LANES.length*laneH+22,clock(endTime).slice(0,5)+' · '+dur(duration),'graph-axis','end');
    $('graph').setAttribute('viewBox',`0 0 ${w} ${h}`);$('graph').setAttribute('height',h);$('graph').style.width='100%';$('graph').innerHTML=html;
    attachGraphActions();
    const graphEl=$('graph');
    if(!graphEl.__blockClick){
      graphEl.__blockClick=true;
      graphEl.addEventListener('click',(event)=>{
        const el=event.target&&event.target.closest?event.target.closest('[data-group]'):null;
        if(el)showGroup(Number(el.dataset.group));
      });
    }
  }

  function renderPath(){
    $('canvas').classList.remove('tree-mode','spine-mode','overview-mode','lane-mode');
    $('graph-caption').innerHTML='<span class="legend-item"><i class="legend-line"></i>普通经过</span><span class="legend-item"><i class="legend-line error"></i>受阻</span><span class="legend-item"><i class="legend-line tool"></i>补齐条件后继续</span><span class="caption-note" id="caption-note"></span>';
    if(zoom)renderTechnicalPath();else renderActionPath();
  }
