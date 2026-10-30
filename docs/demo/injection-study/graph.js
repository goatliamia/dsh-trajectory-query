const colors={system:'#8053e3',tools:'#d49b00',user:'#44a56b',inject:'#c442a7',skill:'#e66d26',assistant:'#5b9fe8',tool:'#3ab4a4',messages:'#8296ab'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'—':n>=1000?(n/1000).toFixed(1)+'k':n.toLocaleString('en-US');
const pct=n=>n==null?'未上报':(n*100).toFixed(n>.999||n<.05?2:1)+'%';
const line=(x1,y1,x2,y2,cls='region-rule')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
const txt=(x,y,value,cls='region-copy',attrs='')=>`<text x="${x}" y="${y}" class="${cls}" ${attrs}>${esc(value)}</text>`;

export function paintContextGraph({element,data,groups,focus,selectedSlot,producer,category,receipt,animate,name,stateLabel,recordColor,projectedCategory,labels,onProducer,onSlot,onEvidence}){
  const slots=data.injections.slots,compact=element.parentElement.clientWidth<900,W=compact?760:1100,H=Math.max(620,230+groups.length*27);
  const cx=compact?485:755,cw=compact?240:300,sourceEnd=compact?180:248,countX=compact?158:220;
  const gateL=compact?270:410,gateR=compact?325:475,endX=compact?410:630;
  const sy=70,ty=142,hy=245,hb=H-205,receiptY=H-134;
  const head=slots.find(s=>s.seq===data.structure?.headSystemSeq),history=slots.filter(s=>s!==head);
  const historyIndex=new Map(history.map((s,i)=>[s.seq,i]));
  const ySlot=s=>s===head?sy+33:hy+(historyIndex.get(s.seq)+.5)/Math.max(1,history.length)*(hb-hy);
  const sourceY=new Map(groups.map(([p],i)=>[p,78+i*27])),routeY={'next-step':117,'next-turn':205,direct:294};
  const nodeTokens=data.composition.nodeEstimates||{},request=receipt?.request,usage=request?.usage,change=request?.logicalChange;
  const systemEstimate=data.composition.categories.find(c=>c.key==='system')?.tokens;
  const linked=receipt?.relation==='first-observed-input',excluded=receipt?.relation==='not-admitted';
  let svg=txt(10,25,'来源记录','col-title')+txt(countX,25,'保留量估算','col-small','text-anchor="end"')+txt(gateL+8,25,'进入方式','col-title')+txt(cx,25,'请求结构与消息落点','col-title');
  svg+=line(compact?224:325,43,compact?224:325,H-170,'route-guide')+line(cx-35,43,cx-35,H-170,'route-guide');
  for(const [kind,y]of Object.entries(routeY))svg+=line(gateL,y,gateR,y)+txt(gateL+8,y-9,kind==='direct'?'直接记录':kind,'route-label');

  // Structure areas have separate authorities. Tools are declarations, not a
  // fabricated message slot. Later system nodes remain inside history.
  svg+=`<g class="reveal-structure">${line(cx,sy-18,cx+cw,sy-18)}${txt(cx,sy,'01  系统提示','region-title')}`;
  svg+=txt(cx+cw,sy,head?'#'+(head.ordinal+1):'未见头部节点','region-meta','text-anchor="end"');
  if(head){svg+=`<rect data-slot="${head.seq}" x="${cx}" y="${sy+13}" width="${cw}" height="37" fill="#faf8fd"/>`;
    const headTokens=nodeTokens[head.seq]??(slots.filter(s=>s.role==='system').length===1?systemEstimate:null);
    svg+=line(cx,sy+13,cx,sy+50,'system-rule')+txt(cx+10,sy+35,'system · '+(headTokens!=null?'≈'+fmt(headTokens)+' token':'system/message'),'region-copy');
  }else svg+=txt(cx,sy+32,'没有把历史中的系统更新移到这里','region-copy');
  svg+='</g>';
  const tools=data.structure||{},toolEstimate=data.composition.categories.find(c=>c.key==='tools')?.tokens;
  svg+=`<g class="reveal-structure tools-structure">${line(cx,ty-11,cx+cw,ty-11)}${txt(cx,ty+6,'02  工具定义','region-title')}`;
  svg+=txt(cx+cw,ty+6,tools.toolCount==null?'未记录':tools.toolCount+' 项声明','region-meta','text-anchor="end"');
  svg+=txt(cx+10,ty+29,(toolEstimate==null?'估算未提供':'≈'+fmt(toolEstimate)+' token')+' · '+(tools.toolNames?.slice(0,2).join(' / ')||'未见工具名'),'region-copy');
  if(tools.headerSeq!=null)svg+=`<g class="evidence-link" data-evidence="${tools.headerSeq}" role="button" tabindex="0" aria-label="查看工具定义原始事件">${txt(cx+10,ty+47,'header '+tools.headerSeq+' ↗','evidence-text')}</g>`;
  svg+='</g>';
  svg+=line(cx,hy-32,cx+cw,hy-32)+txt(cx,hy-14,'03  对话历史','region-title')+txt(cx+cw,hy-14,history.length+' 条消息','region-meta','text-anchor="end"');
  svg+=`<rect x="${cx}" y="${hy}" width="${cw}" height="${hb-hy}" fill="#fafafa"/>`;

  const chains=[];
  for(const [p,list]of groups){const own=focus&&(focus.producer||'unknown')===p?focus:list.findLast(r=>r.presence==='retained')||list.findLast(r=>r.presence==='pending'||r.presence==='canceled')||list.at(-1);if(own)chains.push(own)}
  for(const r of chains){
    const a=sourceY.get(r.producer||'unknown')-3,b=routeY[r.queued?.target||'direct'],color=recordColor(r),active=r.id===focus?.id;
    const muted=producer&&(r.producer||'unknown')!==producer||category&&projectedCategory(slots.find(s=>s.recordId===r.id))!==category;
    const cls='origin-path'+(active?' selected trace-entry':'')+(muted?' muted':'');
    const target=slots.find(s=>s.recordId===r.id),targetY=target?ySlot(target):b+26;
    let path=`M${sourceEnd} ${a} C${sourceEnd+50} ${a},${gateL-50} ${b},${gateL} ${b} L${gateR} ${b}`;
    path+=target?` C${gateR+90} ${b},${cx-80} ${targetY},${cx} ${targetY}`:` C${gateR+35} ${b},${endX-35} ${targetY},${endX} ${targetY}`;
    svg+=`<path d="${path}" pathLength="100" class="${cls}" stroke="${color}"${r.presence==='shadowed'?' stroke-dasharray="4 4"':''}/>`;
    if(active&&!target){svg+=r.presence==='canceled'?`<path d="M${endX-4} ${targetY-4}l8 8m-8 0l8-8" stroke="#888" stroke-width="1.4"/>`:`<circle cx="${endX}" cy="${targetY}" r="3" fill="white" stroke="${color}"/>`;
      svg+=txt(endX-12,targetY+23,stateLabel(r),'state-text','text-anchor="middle"');}
  }

  const turns=new Set(history.map(s=>s.turn)),batchKeys=[];
  for(const s of history){const key=turns.size>1?'turn:'+s.turn:'step:'+s.step;if(batchKeys.at(-1)!==key)batchKeys.push(key)}
  let batch=-1,lastKey=null,phase=-1;
  for(const s of history){
    const key=turns.size>1?'turn:'+s.turn:'step:'+s.step;
    if(key!==lastKey){batch++;lastKey=key;}
    const stage=Math.floor(batch/Math.max(1,batchKeys.length/12));
    if(stage!==phase){if(phase>=0)svg+='</g>';phase=stage;svg+=`<g class="reveal-batch" style="--reveal-delay:${100+stage*85}ms">`;}
    const y=ySlot(s),active=s.recordId===focus?.id||s.seq===selectedSlot,dim=category&&projectedCategory(s)!==category;
    const color=colors[s.category]||'#aaa',pitch=(hb-hy)/Math.max(1,history.length),h=Math.max(.5,Math.min(4.3,pitch*.7));
    svg+=`<rect class="surface-slot${active?' is-selected':''}" data-slot="${s.seq}" x="${cx}" y="${y-h/2}" width="${cw}" height="${h}" fill="${color}" opacity="${dim ? .08 : active ? .95 : s.recordId ? .4 : .2}"/>`;
    if(active)svg+=line(cx,y,cx+cw,y,'selected-slot-rule')+`<circle cx="${cx}" cy="${y}" r="3" fill="${color}"/>`+txt(cx+8,Math.max(hy+11,y-7),'#'+(s.ordinal+1)+' · '+(labels[s.category]||s.role),'slot-label');
  }
  if(phase>=0)svg+='</g>';
  svg+=line(cx+cw+8,hy,cx+cw+8,hb,'surface-axis');
  for(const fraction of[0,.5,1])svg+=txt(cx+cw+13,hy+(hb-hy)*fraction+3,history.length?history[Math.min(history.length-1,Math.floor(history.length*fraction))].ordinal+1:'—','slot-order');
  svg+=`<rect x="${cx}" y="${hy}" width="${cw}" height="${hb-hy}" fill="transparent" id="surface-hit" style="cursor:crosshair"/>`;
  svg+=txt(cx,hb+19,'当前保留历史 · 按轮次分批展开','surface-label');

  for(const [p,list]of groups){const y=sourceY.get(p),active=producer===p||focus&&(focus.producer||'unknown')===p,color=recordColor(list.find(r=>r.presence==='retained')||list[0]);
    const retained=list.filter(r=>r.presence==='retained'),estimated=retained.map(r=>nodeTokens[r.admitted?.seq]).filter(n=>n!=null);
    const count=p==='system-prompt'&&systemEstimate!=null?'≈'+fmt(systemEstimate):estimated.length===retained.length&&retained.length?'≈'+fmt(estimated.reduce((a,b)=>a+b,0)):'—';
    const sourceName=p==='tool'?'工具结果替换':name(p);
    svg+=`<g class="source-row${active?' selected':''}" data-producer="${esc(p)}" role="button" tabindex="0" aria-label="查看${esc(sourceName)}记录"><title>${esc(sourceName)}：保留 ${retained.length}，记录 ${list.length}；数值为这些记录的内容估算</title><rect class="source-hit" x="0" y="${y-16}" width="${sourceEnd+10}" height="26"/><circle cx="13" cy="${y-3}" r="2.5" fill="${color}"/>${txt(27,y,sourceName,'source-label')}${txt(countX,y,count,'source-count','text-anchor="end"')}<line class="source-rule" x1="${sourceEnd-18}" x2="${sourceEnd}" y1="${y-3}" y2="${y-3}" stroke="${color}"/></g>`;
  }
  const factY=Math.max(355,88+groups.length*27);
  if(focus&&factY+62<H-165){
    const ownTokens=nodeTokens[focus.admitted?.seq],where=focus.ordinal==null?'':focus.ordinal===slots.length-1?'末尾追加':'历史第 '+(focus.ordinal+1)+' 条';
    let headline=focus.presence==='canceled'?'这段内容已撤回，没有提交':focus.admitted?.operation==='replace'?where+'被替换':ownTokens!=null?'本条内容 ≈'+fmt(ownTokens)+' token':focus.characters.toLocaleString()+' 文本字符';
    let detail=focus.presence==='canceled'?'不会把本条计入后续请求':linked&&change?.appendOnly?'相邻请求间，已有 '+change.unchangedPrefixMessages+' 条逻辑消息未改':linked&&change?.firstChangedOrdinal!=null?'到关联请求前，首处历史变化在第 '+(change.firstChangedOrdinal+1)+' 条':where||'没有推断未记录的原始入口';
    svg+=txt(10,factY,'所选：'+name(focus.producer),'fact-kicker')+txt(10,factY+24,headline,'fact-title')+txt(10,factY+45,detail,'fact-copy');
    if(linked&&change?.replacementCount)svg+=txt(10,factY+64,'相邻输入间共 '+change.replacementCount+' 处替换；不把缓存变化归因于单条内容','fact-copy');
  }

  // Whole-request receipt occupies a distinct lane. No cache percentage is
  // painted across logical messages as though it were a token position.
  svg+=`<g class="reveal-receipt">${line(10,H-157,W-35,H-157)}`;
  const receiptLabel=request?(linked?(receipt.receiptAfterContextCut?'后续首次请求':'首次关联请求'):'最近一次回执')+' · 第 '+request.turn+' 轮第 '+request.step+' 步':'请求回执';
  svg+=txt(10,receiptY,receiptLabel,'fact-kicker');
  svg+=txt(10,receiptY+30,usage?.cacheRate!=null?pct(usage.cacheRate)+' 输入命中缓存':receipt?'缓存命中量未完整上报':'正在读取关联请求…','receipt-number');
  const before=receipt?.previous?.usage?.cacheRate,delta=receipt?.comparison?.deltaRate;
  let compare=excluded?'本条未提交；这里是取消前的最近回执':receipt?.relation==='no-observed-input'?'尚未观察到包含本条内容的后续输入':before!=null&&delta!=null?'上一次 '+pct(before)+' → 本次 '+pct(usage.cacheRate)+' · '+(delta>=0?'+':'−')+Math.abs(delta*100).toFixed(1)+' 个百分点':'缓存用量取自这次请求的结算记录';
  svg+=txt(10,receiptY+53,compare,'receipt-compare');
  if(linked&&change)svg+=txt(10,receiptY+74,(receipt?.comparison?.routeChanged?'模型路由有变化 · ':'')+(change.appendOnly?'逻辑历史仅追加':'历史第 '+(change.firstChangedOrdinal+1)+' 条起变化')+' · '+change.replacementCount+' 处替换','fact-copy');
  if(request?.settlementSeq!=null)svg+=`<g class="evidence-link" data-evidence="${request.usage?.evidenceSeq??request.settlementSeq}" role="button" tabindex="0" aria-label="查看本次请求缓存证据">${txt(10,receiptY+95,'查看回执 seq '+(request.usage?.evidenceSeq??request.settlementSeq)+' ↗','evidence-text')}</g>`;
  const prompt=usage?.promptTokens,read=usage?.cacheReadTokens,miss=usage?.uncachedInputTokens,write=usage?.cacheWriteTokens;
  svg+=txt(cx,receiptY,'整次请求输入 · '+fmt(prompt)+' token','region-title');
  svg+=`<rect x="${cx}" y="${receiptY+15}" width="${cw}" height="11" rx="1" fill="#eeeeee"/>`;
  if(prompt>0&&usage?.consistent){
    if(read!=null)svg+=`<rect class="cache-fill" x="${cx}" y="${receiptY+15}" width="${cw*read/prompt}" height="11" fill="#476478"/>`;
    if(miss!=null)svg+=`<rect x="${cx+cw*(read??0)/prompt}" y="${receiptY+15}" width="${cw*miss/prompt}" height="11" fill="#d8d8d8"/>`;
    if(write>0)svg+=`<rect x="${cx+cw*((read??0)+(miss??0))/prompt}" y="${receiptY+15}" width="${cw*write/prompt}" height="11" fill="#d49b00"/>`;
  }
  svg+=txt(cx,receiptY+47,'命中 '+fmt(read),'receipt-bucket')+txt(cx+cw,receiptY+47,'未命中 '+fmt(miss),'receipt-bucket','text-anchor="end"');
  svg+=txt(cx,receiptY+68,write>0?'另有缓存写入 '+fmt(write):request?.route?.model||(usage?'模型未记录':'请求用量未上报'),'region-meta');
  svg+=txt(cx,receiptY+88,'命中量未提供逐消息边界','region-meta');
  svg+='</g>';

  element.setAttribute('viewBox',`0 0 ${W} ${H}`);element.classList.toggle('compact',compact);element.classList.toggle('is-revealing',animate);element.innerHTML=svg;
  element.querySelectorAll('[data-producer]').forEach(g=>{const activate=()=>onProducer(g.dataset.producer);g.onclick=activate;g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate()}}});
  element.querySelectorAll('[data-slot]').forEach(g=>g.onclick=()=>onSlot(Number(g.dataset.slot)));
  element.querySelectorAll('[data-evidence]').forEach(g=>{g.onclick=()=>onEvidence(Number(g.dataset.evidence));g.onkeydown=e=>{if(e.key==='Enter'){onEvidence(Number(g.dataset.evidence))}}});
  element.querySelector('#surface-hit').onclick=e=>{const point=element.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(element.getScreenCTM().inverse());const i=Math.min(history.length-1,Math.max(0,Math.floor((p.y-hy)/(hb-hy)*history.length)));if(history[i])onSlot(history[i].seq)};
}
