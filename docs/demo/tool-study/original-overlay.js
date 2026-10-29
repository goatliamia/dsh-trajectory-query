  // Preview-only additions inside the original renderer's scope. No card
  // surfaces, new palette, persistent sidebar or replacement canvas is added.
  const studyFacts=reviewContextData.callFacts||{};
  const studyBySeq=new Map(session.turns.flatMap(t=>t.steps.flatMap(s=>s.calls)).map(c=>[c.seq,c]));
  const studyFilesBySeq=new Map();
  for(const operation of reviewFileOperations){if(!studyFilesBySeq.has(operation.seq))studyFilesBySeq.set(operation.seq,[]);studyFilesBySeq.get(operation.seq).push(operation);}
  const studyLabel=result=>{
    if(!result.study)return studyOldResultLabel(result);
    const calls=result.calls,call=calls[0],fact=call.fact,meta=fact?.study,name=call.name;
    if(calls.length>1)return name+' ×'+calls.length;
    if(call.status==='error')return name+' · 受阻';
    if(call.status==='unknown')return name+' · 待返回';
    if(name==='grep')return 'grep · '+(meta?.search?.total??meta?.search?.shown??'?')+' 处匹配';
    if(name==='glob')return 'glob · 发现路径';
    if(meta?.family==='read')return 'read · '+(meta.metrics.find(([key])=>key==='返回行数')?.[1]||'取回内容');
    if(meta?.family==='write')return name+' · '+(meta.files[0]?.path.split(/[\\/]/).at(-1)||'文件修改');
    if(meta?.family==='command'){
      const program=meta.subject.match(/\b(?:node|python3?|lean|lake|git|rg|pnpm|npm|Get-Content|Select-String)\b/)?.[0];
      return name+' · '+(program||'命令输出');
    }
    return name+' · '+({process:'后台输出',web:'网页返回',coordination:'协作返回'}[meta?.family]||'工具返回');
  };
  const studyOldResultLabel=toolResultLabel;
  toolResultLabel=function(result){return studyLabel(result);};
  const studyOldOutcomeText=geistOutcomeText;
  const studyCompactCall=call=>{
    const meta=call.fact?.study;
    if(call.status==='error')return call.name+' 受阻';
    if(call.name==='grep')return 'grep '+(meta?.search?.total??meta?.search?.shown??'?')+'处';
    if(meta?.family==='read')return 'read '+(meta.metrics.find(([key])=>key==='返回行数')?.[1]||'内容').replace(/\s+/g,'');
    if(meta?.family==='command'){const program=meta.subject.match(/\b(?:node|python3?|lean|lake|git|rg|pnpm|npm)\b/)?.[0];return program?call.name+'/'+program:call.name;}
    if(call.name==='job_output')return '后台输出';
    return call.name;
  };
  geistOutcomeText=function(members){
    if(!members.some(m=>m.result.study))return studyOldOutcomeText(members);
    const counts=new Map();
    for(const member of members)for(const call of member.result.calls||[])counts.set(call.name,(counts.get(call.name)||0)+1);
    if(members.length===1)return shorten(studyLabel(members[0].result),22);
    const calls=members.flatMap(m=>m.result.calls||[]);
    return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([name,n])=>n===1?studyCompactCall(calls.find(c=>c.name===name)):name+' ×'+n).join(' · ');
  };
  const studyResults=[];
  for(const t of session.turns)for(const step of t.steps){
    const groups=new Map();
    for(const call of step.calls){
      const fact=studyFacts[call.seq],family=fact?.study?.family;
      const kind=call.status==='error'?'error':call.status==='unknown'?'pending':family==='write'?'change':family==='search'?'query':family||'command';
      const key=call.name+':'+kind;
      if(!groups.has(key))groups.set(key,{id:'study:'+t.number+':'+step.number+':'+key,study:true,kind,family,turn:t.number,step:step.number,time:call.end??call.start,seqs:[],calls:[]});
      const result=groups.get(key);result.seqs.push(call.seq);result.calls.push({...call,fact,file:(studyFilesBySeq.get(call.seq)||[])[0]?.path||null});result.time=Math.max(result.time,call.end??call.start);
    }
    studyResults.push(...groups.values());
  }
  geistOutcomes=studyResults.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const studyOldGlyph=geistOutcomeGlyph;
  geistOutcomeGlyph=function(result,x,y){
    if(result.kind==='error'||result.kind==='incident'||result.kind==='recovered')return studyOldGlyph(result,x,y);
    if(result.kind==='pending')return '<g transform="translate('+x+' '+y+')" class="geist-result-glyph pending"><circle r="5"/><path d="M0-3v3l2 1"/></g>';
    const kind=result.family||result.kind;
    const glyph=kind==='read'?geistReportIcon:kind==='change'||kind==='write'?STEP_ICON.write:kind==='query'||kind==='search'?STEP_ICON.read:kind==='command'?STEP_ICON.run:kind==='process'?'<circle r="5"/><path d="M0-3v3l2 1"/>':kind==='coordination'?'<path d="M-4-5v7q0 3 4 3h4M-4-1h5q3 0 3-4"/><circle cx="-4" cy="-5" r="1"/><circle cx="4" cy="-5" r="1"/>':STEP_ICON.query;
    return '<g transform="translate('+x+' '+y+')" class="geist-result-glyph '+(kind==='query'?'search':kind==='write'?'change':kind)+'">'+glyph+'</g>';
  };
  // One endpoint carries either the operation type or its exceptional state.
  // Aggregated tools stay in the label and drawer, never in a row of glyphs.
  const studyEndpointPriority=result=>result.kind==='error'||result.kind==='incident'&&!result.incident?.complete?3:result.kind==='pending'?2:1;
  const studyBranchEndpoint=members=>members.reduce((chosen,member)=>studyEndpointPriority(member.result)>studyEndpointPriority(chosen)?member.result:chosen,members[0].result);
  // The original twig geometry and transparent hit area remain unchanged.
  geistResultBranchBody=function(p,base){
    const y=base+p.dy,sign=p.dy>0?1:-1;
    const twig='M'+p.x+' '+(base+sign*2)+'V'+(y-sign*10)+'Q'+p.x+' '+y+' '+(p.x+10)+' '+y+'H'+(p.x+14);
    const endpoint=studyBranchEndpoint(p.members);
    const glyph='<g class="study-branch-tip" data-endpoint-kind="'+esc(endpoint.kind)+'" aria-hidden="true">'+geistOutcomeGlyph(endpoint,p.x+20,y)+'</g>';
    return '<rect class="br-hit" x="'+(p.left-4)+'" y="'+(base+p.top-3)+'" width="'+(p.right-p.left+8)+'" height="'+(p.bottom-p.top+6)+'"/>'+'<path d="'+twig+'" class="br-connector"/>'+glyph+brText(p.cx,p.dy>0?y+21:y-14,p.label,'br-label');
  };
  const studyOldCallKind=callKind;
  callKind=function(call){const family=studyFacts[call.seq]?.study?.family;return ({read:'read',write:'write',search:'query',web:'query',command:'run',process:'run'})[family]||studyOldCallKind(call);};
  const studyOldStepIcon=stepIcon;
  stepIcon=function(step){const first=step.calls[0],family=studyFacts[first?.seq]?.study?.family;return family==='read'?geistReportIcon:family==='search'?STEP_ICON.read:studyOldStepIcon(step);};
  reviewActionStepLabel=function(step){const names=[...new Set(step.calls.map(c=>c.name))];return names.length?names.slice(0,2).join(' / ')+(names.length>2?' 等':''):'回复';};
  const studyFileCache=new Map();
  fileObjects=function(operations,scope=null){
    const cacheKey=operations===reviewFileOperations?(scope?[...scope].sort((a,b)=>a-b).join(','):'*'):null;
    if(cacheKey&&studyFileCache.has(cacheKey))return studyFileCache.get(cacheKey);
    const byPath=new Map();
    for(const op of operations){if(scope&&!scope.has(op.turn))continue;const id=fileIdentity(op.path);if(!byPath.has(id))byPath.set(id,{id,path:op.path,operations:[]});byPath.get(id).operations.push(op);}
    const files=[...byPath.values()],suffixes=new Map();
    for(const file of files){file.parts=file.path.replace(/\\/g,'/').split('/');for(let i=1;i<=file.parts.length;i++){const key=file.parts.slice(-i).join('/').toLowerCase();suffixes.set(key,(suffixes.get(key)||0)+1);}}
    for(const file of files){file.operations.sort((a,b)=>a.seq-b.seq);file.reads=file.operations.filter(op=>op.kind==='read'&&op.status==='returned');file.changes=file.operations.filter(op=>op.kind==='change'&&op.status==='returned');file.failed=file.operations.filter(op=>op.status==='error');file.pending=file.operations.filter(op=>op.status==='unknown');file.lane=file.changes.length||!file.reads.length&&file.operations.some(op=>op.kind==='change')?'change':'read';let n=1;while(n<file.parts.length&&suffixes.get(file.parts.slice(-n).join('/').toLowerCase())>1)n++;file.label=file.parts.slice(-n).join('/');delete file.parts;}
    files.sort((a,b)=>a.operations[0].seq-b.operations[0].seq);
    if(cacheKey){if(studyFileCache.size>16)studyFileCache.clear();studyFileCache.set(cacheKey,files);}return files;
  };
  const studyOldOpenResult=geistOpenResult;
  geistOpenResult=function(result){
    if(!result.study)return studyOldOpenResult(result);
    const paths=[...new Set(result.calls.flatMap(c=>(studyFilesBySeq.get(c.seq)||[]).map(op=>op.path)))];
    let html=result.calls.map(call=>'<section class="study-operation-detail"><strong>'+esc(call.fact?.title||call.name)+'</strong><p>'+esc(call.fact?.outcome||'返回已记录')+'</p><p class="study-evidence-source">'+esc(call.inner?'内部工具 · ':'')+'seq '+call.seq+(call.rootSeq?' · 外层调用 #'+call.rootSeq:'')+'</p>'+callEntry(call)+'</section>').join('');
    if(paths.length)html+='<div class="geist-outcome-files">'+paths.map((path,i)=>'<button class="geist-text-action" data-study-file="'+i+'">'+esc(path.split(/[\\/]/).at(-1))+' · 全程记录 ↗</button>').join('')+'</div>';
    if(result.calls.some(c=>c.name==='grep'))html+='<p class="review-quiet">搜索记录关联的是实际返回的匹配片段，不表示读入了整份文件。</p>';
    html+='<div class="drawer-actions"><button class="action-button" id="study-result-step">在行动路径中查看 ↗</button></div>';
    openDrawer(studyLabel(result),'第 '+result.turn+' 轮 · 第 '+result.step+' 步',html);
    $('study-result-step').onclick=()=>{closeDrawer();reviewEnterPath(result.turn,result.step);};
    $('drawer-body').querySelectorAll('[data-study-file]').forEach(button=>button.onclick=()=>{const file=fileObjects(reviewFileOperations).find(f=>f.id===fileIdentity(paths[Number(button.dataset.studyFile)]));if(file){closeDrawer();reviewSelectFile(file.id);reviewOpenFileHistory(file);}});
  };
  const studyOldPaintDetail=reviewPaintDetail;
  reviewPaintDetail=function(...args){const value=studyOldPaintDetail(...args),body=$('review-detail-body');if(!body)return value;
    body.querySelectorAll('[data-history-operation]').forEach(row=>{const seq=Number(row.dataset.historyOperation),op=reviewFileOperations.find(o=>o.seq===seq&&o.access==='match');if(op){const title=row.querySelector('.geist-history-operation-title strong');if(title)title.textContent='匹配片段';}});
    const history=body.querySelector('.geist-history-overview');if(history){const label=$('review-detail-subtitle')?.textContent;const file=fileObjects(reviewFileOperations).find(f=>f.path===label);if(file){const direct=file.reads.filter(op=>op.access!=='match').length,matches=file.reads.filter(op=>op.access==='match').length;const line=history.querySelector('p>span');if(line)line.textContent='直接读取 '+direct+' 次 · 搜索片段 '+matches+' 次'+(file.changes.length?' · 修改 '+file.changes.length+' 次':'');
      const reads=body.querySelector('#review-history-reads')?.getAttribute('aria-pressed')==='true';
      for(const section of body.querySelectorAll('[data-history-round]')){const round=file.rounds.find(r=>r.turn===Number(section.dataset.historyRound));if(!round)continue;const ok=round.operations.filter(op=>op.status==='returned'),count=access=>ok.filter(op=>op.access===access).length;const parts=[count('write')?count('write')+' 次写入/修改':'',reads&&count('read')?count('read')+' 次直接读取':'',reads&&count('match')?count('match')+' 次匹配片段':'',round.failed?round.failed+' 次受阻':'',round.pending?round.pending+' 次待确认':''].filter(Boolean);const span=section.querySelector('summary>span');if(span)span.textContent=parts.join(' · ');}
    }}
    return value;};
  const studySwitches=document.createElement('span');studySwitches.className='tool-study-switches';
  studySwitches.innerHTML='<span>试作</span><button id="study-search">搜索与读取</button><button id="study-command">命令与修改</button>';
  document.querySelector('.review-toolbar .review-spacer').before(studySwitches);
  $('study-search').onclick=()=>{closeDrawer();reviewEnterPath(data.toolStudy.presets.mixed);};
  $('study-command').onclick=()=>{closeDrawer();reviewEnterPath(data.toolStudy.presets.commands);};
  const studyRequested=Number(new URLSearchParams(location.search).get('turn'));
  if(session.turns.some(t=>t.number===studyRequested)){turnIndex=session.turns.findIndex(t=>t.number===studyRequested);view='path';requestAnimationFrame(reviewSyncNavigation);}
