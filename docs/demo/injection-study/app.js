import {paintContextGraph} from './graph.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors={system:'#8053e3',tools:'#d49b00',user:'#44a56b',inject:'#c442a7',skill:'#e66d26',assistant:'#5b9fe8',tool:'#3ab4a4',messages:'#8296ab'};
const labels={system:'系统提示',tools:'工具定义',user:'用户消息',inject:'注入内容',skill:'技能内容',assistant:'助手消息',tool:'工具结果',messages:'消息历史'};
const producerNames={'system-prompt':'系统提示',user:'用户输入','user-approval':'审批输入','agent-instructions':'工作区指令','runtime-context':'运行时快照','skill-catalog':'Skill 目录','skill-invocation':'Skill 引用','tool-jobs':'后台任务','agent-message':'代理消息','subagent-settled':'子代理状态',goal:'目标续轮','compact-checkpoint':'压缩检查点','tool-goal':'目标状态','tool-registry':'工具声明',tool:'工具返回',compaction:'上下文压缩'};
const presenceNames={retained:'仍在上下文',shadowed:'已被替换',canceled:'已取消投递',pending:'等待领取','claimed-uncommitted':'已领取，未提交','empty-surface-node':'空系统节点'};
const roleNames={system:'system · 系统',developer:'developer · 声明变化',user:'user · 输入内容',assistant:'assistant · 模型回复',tool:'tool · 工具结果'};
const fmt=n=>n==null?'—':Math.abs(n)>=1000000?(n/1000000).toFixed(2)+'m':Math.abs(n)>=1000?(n/1000).toFixed(1)+'k':Number(n).toLocaleString('en-US');
const name=p=>producerNames[p]||p||'来源未声明';
let manifest,data,selected=null,selectedSlot=null,producer=null,category=null,history=false,rows=35,generation=0,raw=null;
const cache=new Map(),receiptCache=new Map();
let receipt=null,animateNextGraph=false;
let recordById,slotBySeq,slotByRecord,sourceGroups;
function recordColor(r){return colors[slotByRecord?.get(r.id)?.category]||colors[r.role==='system'?'system':r.producer==='user'?'user':r.role==='tool'?'tool':'inject']||'#888'}
function stateLabel(r){return presenceNames[r.presence]||r.presence}
function projectedCategory(s){return s?.categoryBasis==='registered-projection'?s.category:null}
async function json(url){const res=await fetch(url);if(!res.ok)throw Error('读取失败：'+res.status);return res.json()}
function fail(error){$('error').hidden=false;$('error').textContent=String(error.message||error)}
function filteredRecords(){
  return data.injections.records.filter(r=>
    (history||['retained','pending','canceled','claimed-uncommitted'].includes(r.presence)||r.id===selected)
    &&(!producer||(r.producer||'unknown')===producer)&&(!category||projectedCategory(slotByRecord.get(r.id))===category))
    .sort((a,b)=>(b.admitted?.seq??b.queued?.seq??0)-(a.admitted?.seq??a.queued?.seq??0));
}
function updateUrl(){const u=new URL(location);u.searchParams.set('case',data.id);if(history)u.searchParams.set('history','1');else u.searchParams.delete('history');window.history.replaceState(null,'',u)}
async function openCase(id){
  const request=++generation;$('error').hidden=true;document.querySelector('main').classList.add('loading');
  try{
    let value=cache.get(id);if(!value){value=await json('/snapshot?id='+encodeURIComponent(id));cache.set(id,value);while(cache.size>2)cache.delete(cache.keys().next().value)}
    if(request!==generation)return;data=value;selected=value.selected;selectedSlot=value.selectedSeq??null;producer=category=raw=null;rows=35;
    recordById=new Map(data.injections.records.map(r=>[r.id,r]));slotBySeq=new Map(data.injections.slots.map(s=>[s.seq,s]));slotByRecord=new Map(data.injections.slots.filter(s=>s.recordId).map(s=>[s.recordId,s]));
    if(selectedSlot!=null)selected=slotBySeq.get(selectedSlot)?.recordId;
    else if(!recordById.has(selected))selected=data.injections.records.findLast(r=>r.presence==='retained')?.id;
    $('session-note').textContent=manifest.sourceLabel;$('cut-label').textContent='第 '+(data.position?.turn??'—')+' 轮 · 第 '+(data.position?.step??'—')+' 步 · seq '+data.cut.asOfSeq;
    $('case-tabs').innerHTML=manifest.cases.map(c=>'<button role="tab" aria-selected="'+(c.id===id)+'" data-case="'+esc(c.id)+'" title="'+esc(c.subtitle)+'">'+esc(c.title)+'</button>').join('');
    $('case-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>openCase(b.dataset.case));
    $('source-note').textContent=data.composition.estimate.source.name+' '+(data.composition.estimate.source.version||'')+' · 构成估算与实测输入分列';
    receipt=value.requestEvidence;animateNextGraph=true;renderComposition();render();updateUrl();
    window.__contextStudy={case:id,cut:data.cut.asOfSeq,messages:data.injections.slots.length,records:data.injections.records.length,renderedAt:performance.now()};
  }catch(error){if(request===generation)fail(error)}finally{if(request===generation)document.querySelector('main').classList.remove('loading')}
}
function renderComposition(){
  const c=data.composition,total=c.estimate.total,o=c.occupancy;
  $('estimated-total').textContent=total==null?'—':'≈'+fmt(total);
  $('occupancy').innerHTML='<span>预计下次输入<b>'+(o.projectedInputTokens==null?'—':'≈'+fmt(o.projectedInputTokens))+'</b></span><span>此前实测输入<b>'+fmt(o.reportedInputTokens)+'</b></span><span>路由窗口<b>'+fmt(o.contextWindow)+'</b></span>';
  $('composition-bar').innerHTML=c.categories.filter(r=>r.tokens>0).map(r=>'<button style="width:'+r.tokens/Math.max(1,total)*100+'%;background:'+colors[r.key]+'" data-category="'+r.key+'" title="'+labels[r.key]+' · 估算 '+fmt(r.tokens)+'，占构成 '+(r.tokens/total*100).toFixed(1)+'%"></button>').join('');
  $('composition-legend').innerHTML=c.categories.map(r=>'<button data-category="'+r.key+'"><i style="background:'+colors[r.key]+'"></i>'+labels[r.key]+'<b>≈'+fmt(r.tokens)+' '+(r.tokens/Math.max(1,total)*100).toFixed(1)+'%</b></button>').join('');
  document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=category===b.dataset.category?null:b.dataset.category;producer=null;rows=35;render()});
}
function render(){
  document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===category));$('composition-bar').classList.toggle('filtered',!!category);
  renderGraph();renderInspector();renderRecords();
}
function choose(id,seq=null){selected=id;selectedSlot=seq;raw=null;receipt=null;render();loadReceipt()}
function renderGraph(){
  const groups=new Map();
  for(const r of data.injections.records){if(!history&&r.presence==='shadowed'&&r.id!==selected)continue;const key=r.producer||'unknown';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
  const order=['system-prompt','user','agent-instructions','runtime-context','skill-catalog','tool-jobs','goal'];
  sourceGroups=[...groups].sort((a,b)=>(order.includes(a[0])?order.indexOf(a[0]):99)-(order.includes(b[0])?order.indexOf(b[0]):99)||a[0].localeCompare(b[0]));
  paintContextGraph({element:$('graph'),data,groups:sourceGroups,focus:recordById.get(selected),selectedSlot,producer,category,receipt,animate:animateNextGraph,
    name,stateLabel,recordColor,projectedCategory,labels,
    onProducer:p=>{producer=producer===p?null:p;category=null;rows=35;const list=groups.get(p);if(producer){const r=list.findLast(r=>r.presence==='retained')||list.at(-1);choose(r?.id)}else render()},
    onSlot:seq=>{const slot=slotBySeq.get(seq);if(slot)choose(slot.recordId,seq)},onEvidence:loadEvidence});
  animateNextGraph=false;
  $('graph-note').textContent=category?'已突出显示：'+labels[category]:data.subtitle;
}
async function loadEvidence(seq){
  try{const before=generation,chosen=selected,slot=selectedSlot;const value=await json('/evidence?seq='+seq);if(before!==generation||chosen!==selected||slot!==selectedSlot)return;raw=value;renderInspector()}catch(error){fail(error)}
}
async function loadReceipt(){
  const chosen=selected,slot=selectedSlot,epoch=generation,r=recordById.get(selected),seq=r?.admitted?.seq??selectedSlot;
  if(seq==null){receipt={...data.requestBaseline,relation:r?.presence==='canceled'?'not-admitted':'no-observed-input'};renderGraph();return}
  try{
    let value=receiptCache.get(seq);if(!value){value=await json('/receipt?seq='+seq);receiptCache.set(seq,value);while(receiptCache.size>4)receiptCache.delete(receiptCache.keys().next().value)}
    if(epoch!==generation||chosen!==selected||slot!==selectedSlot)return;
    receipt={...value,contextCut:data.cut,receiptAfterContextCut:value.request?.settlementSeq>data.cut.asOfSeq};renderGraph();
  }catch(error){if(epoch===generation&&chosen===selected&&slot===selectedSlot)fail(error)}
}
function renderInspector(){
  const r=recordById.get(selected),s=selectedSlot!=null?slotBySeq.get(selectedSlot):slotByRecord.get(selected);
  if(!r&&!s){$('inspector').innerHTML='<p class="detail-body">选择一条来源或上下文中的位置查看证据。</p>';return}
  const p=r?.producer||s.producer,color=r?recordColor(r):colors[s.category]||'#888',seq=r?.admitted?.seq??r?.queued?.seq??s.seq;
  let chain='';
  if(r?.queued){chain='<span>入队</span><b>'+r.queued.seq+'</b><em>→</em>';
    if(r.queued.exitSeq!=null)chain+='<span>'+(r.queued.outcome==='canceled'?'取消':'领取')+'</span><b>'+r.queued.exitSeq+'</b>'+(r.admitted?'<em>→</em>':'');
    if(r.admitted)chain+='<span>提交</span><b>'+r.admitted.seq+'</b>';
  }else chain='<span>正式记录</span><b>'+seq+'</b><span>'+(r?.queueCorrelation==='ambiguous-message-id'?'有多条同 ID 投递，关联存在歧义':'没有匹配的收件箱关联')+'</span>';
  const role=r?.role||s.role,content=r?.excerpt||s.excerpt;
  const position=s?'第 '+(s.ordinal+1)+' / '+data.injections.slots.length+' 条':r?.admitted?'不在当前逻辑上下文':'尚无正式消息位置';
  const status=r?stateLabel(r):'仍在上下文',extra=(r?.laterSnapshotSeq?' · 该来源已有后续快照':'')+(r?.replacement?' · 替换 '+r.replacement.startSeq+'–'+r.replacement.endSeq:'')+(r?.shadowedAt!=null?' · 被 seq '+r.shadowedAt+' 替换':'');
  const evidence=[...new Set([...(r?.evidence||[seq]),...(r?.shadowedAt!=null?[r.shadowedAt]:[])])];
  let html='<div><div class="detail-kicker">所选内容</div><h3 class="detail-title"><i style="background:'+color+'"></i>'+esc(name(p))+'</h3><div class="detail-sub">'+esc(p)+' · '+esc(r?.form||s?.form||'未声明形态')+'</div><div class="status-line"><b>'+esc(status)+'</b>'+esc(extra)+'</div></div>';
  html+='<div><div class="detail-kicker">'+(r?.queued?'可核对的投递链':'记录与正文')+'</div><div class="trace-line">'+chain+'</div><p class="detail-body">'+esc(content.text||'此处没有文本块；请查看原始事件。')+'</p>'+(content.omitted?'<span class="detail-omitted">节选省略 '+content.omitted.toLocaleString()+' 字符</span>':'')+'</div>';
  html+='<div class="detail-right"><dl class="detail-facts"><dt>上下文角色</dt><dd>'+esc(roleNames[role]||role)+'</dd><dt>当前落点</dt><dd>'+esc(position)+'</dd><dt>投递目标</dt><dd>'+esc(r?.queued?.target||'未见队列关联')+'</dd><dt>原始 API</dt><dd>未记录</dd></dl><div class="evidence-buttons">'+evidence.map(n=>'<button data-evidence="'+n+'">seq '+n+' ↗</button>').join('')+'</div></div>';
  if(r?.sections?.length)html+='<div class="sections"><span>记录中的具名部分</span>'+r.sections.map(s=>'<span><b>'+esc(s.name)+'</b>'+s.characters.toLocaleString()+' 文本字符</span>').join('')+'</div>';
  if(r?.toolChanges?.length)html+='<div class="sections"><span>工具声明变化</span>'+r.toolChanges.map(c=>'<span><b>'+esc(c.toolName)+'</b>'+(c.type==='tool-addition'?'加入':'移除')+'</span>').join('')+(r.declarationHeader?'<span>定义引用 header seq '+r.declarationHeader.seq+(r.declarationHeader.resolved?'':' · 无法解析')+'</span>':'')+'</div>';
  if(r?.payloadChangedOnAdmission)html+='<div class="sections"><span>相同消息身份的正式提交内容与入队内容不同，已按完整 payload 哈希核对。</span></div>';
  if(raw)html+='<div class="raw-evidence"><header><span>'+esc(raw.type)+' · seq '+raw.seq+'</span><button id="close-raw">收起原始事件</button></header><pre>'+esc((raw.facts?'已记录字段\n'+JSON.stringify(raw.facts,null,2)+'\n\n原始事件节选\n':'')+raw.raw)+'</pre>'+(raw.omitted?'<span class="detail-omitted">原始事件节选，另省略 '+raw.omitted.toLocaleString()+' 字符</span>':'')+'</div>';
  $('inspector').innerHTML=html;
  $('inspector').querySelectorAll('[data-evidence]').forEach(b=>b.onclick=async()=>{try{const before=generation,chosen=selected,slot=selectedSlot;const value=await json('/evidence?seq='+b.dataset.evidence);if(before!==generation||chosen!==selected||slot!==selectedSlot)return;raw=value;renderInspector()}catch(error){fail(error)}});
  if($('close-raw'))$('close-raw').onclick=()=>{raw=null;renderInspector()};
}
function renderRecords(){
  const list=filteredRecords();$('record-heading').textContent=producer?name(producer)+'的记录':category?labels[category]+'中的来源记录':'当前切点的记录';
  $('record-count').textContent=list.length+' 项'+(history?' · 含历史':' · 已保留、待处理与取消');
  $('clear-filter').hidden=!producer&&!category;
  $('record-body').innerHTML=list.slice(0,rows).map(r=>'<tr data-record="'+esc(r.id)+'" class="'+(r.id===selected?'selected':'')+'"><td><span class="dot" style="background:'+recordColor(r)+'"></span>'+esc(name(r.producer))+'</td><td>'+esc(r.queued?.target||'直接记录')+(r.admitted?' → 第 '+(r.admitted.turn??'—')+' 轮 · '+(r.admitted.step??'—')+' 步':'')+'</td><td>'+esc(r.admitted?.operation==='replace'?'替换 '+r.replacement.startSeq+'–'+r.replacement.endSeq:r.ordinal!=null?'第 '+(r.ordinal+1)+' 条':r.admitted?'已移出':'—')+'</td><td class="state-'+r.presence+'">'+esc(stateLabel(r))+(r.laterSnapshotSeq&&r.presence==='retained'?' · 旧快照':'')+'</td><td class="mono">seq '+(r.admitted?.seq??r.queued?.seq)+'</td></tr>').join('');
  $('record-body').querySelectorAll('[data-record]').forEach(tr=>tr.onclick=()=>choose(tr.dataset.record));$('more').hidden=list.length<=rows;
}
$('include-history').onchange=e=>{history=e.target.checked;rows=35;render();updateUrl()};
$('reset').onclick=$('clear-filter').onclick=()=>{producer=category=null;rows=35;render()};
$('more').onclick=()=>{rows+=70;renderRecords()};
$('replay').onclick=()=>{animateNextGraph=true;renderGraph()};
let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(data)renderGraph()})});
try{manifest=await json('/manifest.json');history=new URL(location).searchParams.get('history')==='1';$('include-history').checked=history;const chosen=new URL(location).searchParams.get('case');await openCase(manifest.cases.some(c=>c.id===chosen)?chosen:'notice')}catch(error){fail(error)}
