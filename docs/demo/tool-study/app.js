import { FAMILIES, baseName, fileId } from './model.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shorten = (value, n=24) => String(value || '').length > n ? String(value).slice(0,n-1)+'…' : String(value || '');
const number = n => Number(n || 0).toLocaleString('en-US');
const duration = ms => ms == null ? '未记录起点' : ms < 1000 ? Math.round(ms)+' ms' : ms < 60000 ? (ms/1000).toFixed(ms<10000?1:0)+' 秒' : Math.floor(ms/60000)+'分'+Math.round(ms%60000/1000)+'秒';
const token = n => Math.abs(n)>=1000?(n/1000).toFixed(1)+'k':Math.round(n);
const ICONS = {
 file:'<path d="M4 1.8h5l3 3v9.4H4zM9 1.8v3h3M6 8h4M6 10.5h4"/>',
 search:'<circle cx="6.7" cy="6.7" r="4.4"/><path d="m10 10 3.7 3.7"/>',
 edit:'<path d="m3 10 7.8-7.8 3 3L6 13l-4 1zM9.5 3.5l3 3"/>',
 terminal:'<path d="m3 4 4 4-4 4M8.5 12h4.5"/>',
 clock:'<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/>',
 globe:'<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-4 3-4 8 0 11 4-3 4-8 0-11"/>',
 branch:'<path d="M4 3v8c0 2 7 2 7-1V4"/><circle cx="4" cy="3" r="1.6"/><circle cx="11" cy="3" r="1.6"/><circle cx="11" cy="11" r="1.6"/>',
 tool:'<path d="m3 8 5-5 5 5-5 5z"/>',
};
const icon = family => '<svg viewBox="0 0 16 16" aria-hidden="true">'+ICONS[FAMILIES[family]?.icon || 'tool']+'</svg>';
const statusText = status => status==='error'?'返回错误':status==='pending'?'尚无返回':'已返回';
const status = call => '<span class="status '+call.status+'">'+statusText(call.status)+'</span>';
let data, callsBySeq, callsByTurn, turnsByNumber, fileById, contextByStep, contextByTurn;
const state = { mode:'turn', turn:1, nav:'turns', search:'', filter:null, selected:null, selectedFile:null, raw:'result', zoom:1, rows:80, navRows:150 };
let chartGroups = [], drag=null, dragged=false, frame=0;
const measure=document.createElement('canvas').getContext('2d');
function svgLabel(text,width,size=11) {
  text=String(text||'');measure.font=size+'px '+getComputedStyle(document.body).fontFamily;
  if(measure.measureText(text).width<=width)return text;
  let lo=0,hi=text.length;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(measure.measureText(text.slice(0,mid)+'…').width<=width)lo=mid;else hi=mid-1;}
  return text.slice(0,lo)+'…';
}
const activeTurn = () => turnsByNumber.get(state.turn);
const scopeCalls = () => state.mode==='all' ? data.calls : callsByTurn.get(state.turn) || [];
const filtered = calls => state.filter ? calls.filter(c=>c.family===state.filter) : calls;
const byFamily = calls => Object.keys(FAMILIES).map(family=>({family,count:calls.filter(c=>c.family===family).length})).filter(r=>r.count);

function callSubject(call) {
  if (call.name === 'grep') return call.search?.total===0?'没有匹配':call.files.length+' 个文件 · '+(call.search?.total??call.search?.shown??'?')+' 处匹配';
  if (call.files.length) return baseName(call.files[0].path);
  return call.subject || call.summary;
}
function leafSummary(calls) {
  if (calls.length===1) return callSubject(calls[0]);
  const paths = new Set(calls.flatMap(c=>c.files.map(f=>fileId(f.path))));
  return paths.size ? paths.size+' 个文件 · '+calls.length+' 次' : calls.length+' 次调用';
}
function groupCalls(calls) {
  const groups=new Map();
  for(const call of calls){const key=call.name+':'+call.status;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(call);}
  return [...groups.values()].sort((a,b)=>a[0].seq-b[0].seq);
}
function openTurn(turn, preferred=null) {
  document.querySelector('.sidebar').classList.remove('is-open');$('nav-toggle').setAttribute('aria-expanded','false');
  state.mode='turn';state.turn=Number(turn);state.zoom=1;state.rows=80;state.selectedFile=null;
  const calls=callsByTurn.get(state.turn)||[];
  state.selected=preferred??calls.find(c=>c.name==='grep'&&c.status==='returned'&&c.files.length)?.seq??calls[0]?.seq??null;
  state.raw='result';$('graph-scroll').scrollLeft=0;
  render();
  if(preferred) requestAnimationFrame(()=>{
    const el=$('graph').querySelector('[data-selected="true"]');
    if(el){const x=Number(el.dataset.x)||0;$('graph-scroll').scrollLeft=Math.max(0,x-$('graph-scroll').clientWidth*.4);}
  });
}
function renderNav() {
  const search=state.search.toLowerCase();
  document.querySelectorAll('[data-nav]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.nav===state.nav)));
  $('search').placeholder=state.nav==='turns'?'查找轮次或工具':'查找文件路径';
  let rows;
  if(state.nav==='turns'){
    rows=data.turns.filter(t=>!search||String(t.number)===search||('第 '+t.number+' 轮 '+t.title+' '+(callsByTurn.get(t.number)||[]).map(c=>c.name).join(' ')).toLowerCase().includes(search));
    $('record-list').innerHTML=rows.map(t=>{
      const calls=callsByTurn.get(t.number)||[], names=[...new Set(calls.map(c=>c.name))];
      return '<button class="record-item" data-turn="'+t.number+'" aria-current="'+(state.mode==='turn'&&t.number===state.turn)+'"><span class="record-title"><span>第 '+t.number+' 轮</span><span>'+t.steps.length+' 步</span></span><span class="record-sub">'+esc(names.join(' · ')||'回复')+'</span></button>';
    }).join('')||'<p class="loading-copy">没有匹配的轮次</p>';
  }else{
    rows=data.files.filter(f=>!search||f.path.toLowerCase().includes(search));
    $('record-list').innerHTML=rows.slice(0,state.navRows).map(f=>{
      const accesses=f.accesses.filter(a=>a.status==='returned'),read=accesses.filter(a=>a.access==='read').length,match=accesses.filter(a=>a.access==='match').length,write=accesses.filter(a=>a.access==='write').length;
      const parts=[read?'读取 '+read:'',match?'匹配 '+match:'',write?'修改 '+write:''].filter(Boolean);
      return '<button class="record-item" data-file="'+esc(f.id)+'" aria-current="'+(f.id===state.selectedFile)+'" title="'+esc(f.path)+'"><span class="file-name">'+esc(f.name)+'</span><span class="record-sub">'+esc(parts.join(' · ')||'未成功 / 未返回')+'</span></button>';
    }).join('')+(rows.length>state.navRows?'<button class="more-button" data-more-files>继续显示文件（'+(rows.length-state.navRows)+'）</button>':'')||'<p class="loading-copy">没有匹配的文件</p>';
  }
}
function renderHeader() {
  const turn=activeTurn(), calls=scopeCalls();
  $('view-crumb').textContent=state.mode==='all'?'全部轮次':'第 '+state.turn+' 轮';
  $('view-title').textContent=state.mode==='all'?'一次对话，实际做了什么':'第 '+state.turn+' 轮的行动';
  $('view-subtitle').textContent=state.mode==='all'?data.counts.turns+' 轮 · '+number(data.counts.steps)+' 步 · '+number(calls.length)+' 项实际工具操作':turn.steps.length+' 步 · '+calls.length+' 项工具操作 · '+duration(turn.end-turn.start);
  $('mode-turn').setAttribute('aria-selected',String(state.mode==='turn'));$('mode-all').setAttribute('aria-selected',String(state.mode==='all'));
}
function leaf(calls,x,y,width=144,extra={}) {
  const first=calls[0], index=chartGroups.length;chartGroups.push(calls);
  const selected=calls.some(c=>c.seq===state.selected), muted=state.filter&&!calls.some(c=>c.family===state.filter);
  const title=extra.title||first.name+(calls.length>1?' ×'+calls.length:''),subtitle=extra.subtitle||leafSummary(calls);
  const family=first.family, tone=calls.some(c=>c.status==='error')?'error':calls.some(c=>c.status==='pending')?'pending':'';
  return '<g class="tool-leaf'+(selected?' is-active':'')+(muted?' is-dim':'')+'" style="--family:'+FAMILIES[family].color+'" data-group="'+index+'" data-selected="'+selected+'" data-x="'+x+'" role="button" tabindex="0" aria-label="'+esc(title+' · '+subtitle)+'"><title>'+esc(title+' · '+subtitle)+'</title><rect class="leaf-bg" x="'+x+'" y="'+y+'" width="'+width+'" height="43" rx="5"/><g transform="translate('+(x+10)+' '+(y+12)+')" class="leaf-icon">'+ICONS[FAMILIES[family].icon]+'</g><text class="leaf-tool" x="'+(x+33)+'" y="'+(y+18)+'">'+esc(svgLabel(title,width-50,11.5))+'</text><circle class="leaf-status '+tone+'" cx="'+(x+width-10)+'" cy="'+(y+15)+'" r="2"/><text class="leaf-target" x="'+(x+10)+'" y="'+(y+33)+'">'+esc(svgLabel(subtitle,width-20,10.5))+'</text></g>';
}
function contextMark(info,x,base,width=24) {
  if(!$('show-context').checked||!info)return '';
  const cap=30000,up=Math.min(66,info.up/cap*66),down=Math.min(25,info.down/cap*66);
  let html='';
  if(up)html+='<rect class="context-bar" x="'+(x-width/2)+'" y="'+(base-9-up)+'" width="'+width+'" height="'+up+'" rx="1"><title>上下文增加 '+number(info.up)+' tokens'+(info.up>cap?'；柱高收起':'')+'</title></rect>';
  if(down)html+='<rect class="context-bar negative" x="'+(x-width/2)+'" y="'+(base+9)+'" width="'+width+'" height="'+down+'" rx="1"><title>上下文减少 '+number(info.down)+' tokens</title></rect>';
  if(up||down)html+='<text class="context-label" x="'+(x+width/2+6)+'" y="'+(up?base-10-up:base+down+7)+'">'+(info.up>=info.down?'+':'−')+token(Math.max(info.up,info.down))+(Math.max(info.up,info.down)>cap?'…':'')+'</text>';
  return html;
}
function renderChart() {
  if(!data)return;
  const W=Math.max(420,$('graph-scroll').clientWidth),base=150;
  const maxGroups=state.mode==='all'?4:Math.max(1,...activeTurn().steps.map(step=>groupCalls((callsByTurn.get(state.turn)||[]).filter(c=>c.step===step.number)).length));
  const H=Math.max(300,204+(Math.min(3,maxGroups)-1)*61+43+(maxGroups>3?44:25));
  chartGroups=[];let html='',width=W;
  if(state.mode==='turn'){
    const turn=activeTurn(),count=turn.steps.length,gap=Math.max(162,Math.min(195,(W-150)/Math.min(count,4)))*state.zoom;
    width=Math.max(W,145+count*gap);
    const positions=turn.steps.map((_,i)=>54+i*gap);
    html+='<path class="chart-rail" d="M24 '+base+'H'+(width-24)+'"/>';
    turn.steps.forEach((step,i)=>{
      const x=positions[i],calls=(callsByTurn.get(turn.number)||[]).filter(c=>c.step===step.number),groups=groupCalls(calls),visible=groups.slice(0,3);
      html+='<path class="chart-grid" d="M'+x+' 56V'+(H-24)+'"/><text class="step-index" x="'+(x+38)+'" y="26">第 '+step.number+' 步</text><text class="step-duration" x="'+(x+38)+'" y="43">'+duration(step.end-step.start)+'</text>';
      html+=contextMark(contextByStep.get(turn.number+':'+step.number),x,base,22);
      html+='<g role="button" tabindex="0" data-step="'+step.number+'" aria-label="查看第 '+step.number+' 步，'+calls.length+' 项工具操作"><circle class="step-dot" cx="'+x+'" cy="'+base+'" r="4.5"/><circle class="column-hit" cx="'+x+'" cy="'+base+'" r="12"/></g>';
      if(!calls.length)html+='<text class="step-label" x="'+(x+34)+'" y="193">模型回复</text>';
      visible.forEach((group,j)=>{
        const y=204+j*61;
        html+='<path class="tool-twig" d="M'+x+' '+(base+5)+'V'+(y+13)+'q0 8 8 8h4"/>';
        html+=leaf(group,x+12,y,Math.min(151,gap-20));
      });
      if(groups.length>3){const rest=groups.slice(3).flat(),index=chartGroups.length;chartGroups.push(rest);html+='<text class="overflow-link" x="'+(x+82)+'" y="'+(H-13)+'" data-group="'+index+'" role="button" tabindex="0">另 '+rest.length+' 项操作 ↗</text>';}
    });
    $('chart-note').textContent='按步骤顺序排列 · 点分支查看具体返回';
  }else{
    width=Math.max(W,W*state.zoom);const bins=Math.max(3,Math.floor(width/174)),size=Math.ceil(data.turns.length/bins),gap=(width-70)/Math.ceil(data.turns.length/size);
    html+='<path class="chart-rail" d="M24 '+base+'H'+(width-24)+'"/>';
    for(let i=0;i<data.turns.length;i+=size){
      const turns=data.turns.slice(i,i+size),x=35+i/size*gap,calls=turns.flatMap(t=>callsByTurn.get(t.number)||[]),groups=groupCalls(calls).sort((a,b)=>b.length-a.length);
      const first=turns[0].number,last=turns.at(-1).number;
      html+='<path class="chart-grid" d="M'+x+' 55V'+(H-24)+'"/><g data-range="'+first+'" role="button" tabindex="0" aria-label="进入第 '+first+' 轮"><text class="all-bin-label" x="'+(x+gap*.47)+'" y="26">'+first+'–'+last+' 轮 ↗</text><text class="all-bin-stat" x="'+(x+gap*.47)+'" y="44">'+calls.length+' 项操作</text></g>';
      const span=turns.map(t=>contextByTurn.get(t.number)).filter(Boolean),net=span.reduce((n,r)=>n+r.net,0);
      html+=contextMark({up:Math.max(0,net),down:Math.max(0,-net)},x+gap*.45,base,Math.min(34,gap/4));
      html+='<circle class="step-dot" cx="'+x+'" cy="'+base+'" r="3.5"/>';
      groups.slice(0,3).forEach((group,j)=>{const y=204+j*61;html+='<path class="tool-twig" d="M'+x+' '+(base+4)+'V'+(y+13)+'q0 8 8 8h4"/>';html+=leaf(group,x+12,y,Math.min(151,gap-20));});
      if(groups.length>3){const rest=groups.slice(3).flat(),index=chartGroups.length;chartGroups.push(rest);html+='<text class="overflow-link" x="'+(x+gap*.48)+'" y="'+(H-13)+'" data-group="'+index+'" role="button" tabindex="0">另 '+rest.length+' 项操作 ↗</text>';}
    }
    $('chart-note').textContent='按连续轮次汇总 · 放大展开更细的工具分支';
  }
  if($('show-context').checked)html='<text class="context-label-note" x="18" y="73"><title>柱高采用固定 tokens 比例；超过显示范围时收起，并标出实际数量。</title>上下文</text>'+html;
  $('graph').setAttribute('width',width);$('graph').setAttribute('height',H);$('graph').setAttribute('viewBox','0 0 '+width+' '+H);$('graph').innerHTML=html;
}
function renderFamilies() {
  $('clear-filter').hidden=!state.filter;
  document.querySelector('.family-strip .eyebrow').textContent=state.mode==='all'?'全程工具':'本轮工具';
  $('family-items').innerHTML=byFamily(scopeCalls()).map(row=>'<button class="family-button'+(state.filter&&state.filter!==row.family?' is-muted':'')+'" data-family="'+row.family+'" style="--family:'+FAMILIES[row.family].color+'" aria-pressed="'+(state.filter===row.family)+'">'+icon(row.family)+FAMILIES[row.family].label+' <strong>'+row.count+'</strong></button>').join('');
}
function renderRows() {
  const calls=filtered(scopeCalls());$('operations-title').textContent=state.mode==='all'?'全程操作记录':'本轮操作';$('operations-count').textContent=calls.length+' 项 · 每次调用保留原记录';
  $('operation-rows').innerHTML=calls.slice(0,state.rows).map(call=>'<button class="operation-row'+(call.seq===state.selected?' is-active':'')+'" data-call="'+call.seq+'"><span class="icon-box" style="--family:'+FAMILIES[call.family].color+'">'+icon(call.family)+'</span><span><span class="tool-name">'+esc(call.name)+'</span><span class="row-step">'+(state.mode==='all'?'第 '+call.turn+' 轮 · ':'')+'第 '+call.step+' 步</span></span><span class="operation-description"><span>'+esc(call.title+(call.subject?' · '+call.subject:''))+'</span><small>'+esc(call.summary)+'</small></span>'+status(call)+'</button>').join('')+(calls.length>state.rows?'<button class="more-button" data-more-rows>继续显示 '+Math.min(80,calls.length-state.rows)+' 项操作</button>':'')||'<p class="empty">这段记录中没有此类工具操作。</p>';
}
function metricsHTML(metrics) {return metrics.length?'<dl class="fact-grid">'+metrics.map(([key,value])=>'<div'+(String(value).length>32?' class="wide"':'')+'><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>':'';}
function showInspector() {$('inspector').classList.add('is-open');}
function inspectorHeader(crumb,body) {return '<div class="detail-head"><div class="detail-crumb">'+crumb+'<button class="inspector-close" data-close-inspector aria-label="关闭详情">×</button></div>'+body+'</div>';}
function renderInspector() {
  if(state.selectedFile)return renderFile(state.selectedFile);
  const call=callsBySeq.get(state.selected);if(!call)return;
  const f=FAMILIES[call.family],output=state.raw==='args'?call.args:state.raw==='source'?JSON.stringify({tool:call.name,turn:call.turn,step:call.step,source:call.inner?'tool/ptc-dispatch':'tool/call + tool/result',startSeq:call.startSeq,resultSeq:call.resultSeq,rootCallSeq:call.rootSeq??null,status:call.status},null,2):call.text;
  const omitted=state.raw==='args'?call.argsOmitted:state.raw==='result'?call.textOmitted:0;
  $('inspector').innerHTML=inspectorHeader('第 '+call.turn+' 轮<span>/</span>第 '+call.step+' 步','<div class="detail-type"><span class="icon-box" style="--family:'+f.color+'">'+icon(call.family)+'</span><span class="tool-name">'+esc(call.name)+'</span></div><h2>'+esc(call.title)+'</h2>'+(call.subject?'<p class="detail-subject">'+esc(call.subject)+'</p>':'')+status(call)+'<span class="seq-reference">#'+call.seq+'</span>')+
    '<section class="detail-section"><h3>实际返回</h3><p class="result-summary '+call.status+'">'+esc(call.summary)+'</p>'+metricsHTML([...call.metrics,['工具耗时',call.start==null||call.end==null?'缺少完整起止记录':duration(call.end-call.start)]])+'</section>'+
    (call.files.length?'<section class="detail-section"><h3>'+(call.name==='grep'?'涉及的文件片段':'关联文件')+'</h3>'+call.files.slice(0,5).map(file=>'<button class="file-evidence" data-file="'+esc(fileId(file.path))+'" title="'+esc(file.path)+'"><span>'+esc(baseName(file.path))+'</span><small>'+(file.access==='match'?'匹配片段 · '+file.lines.length+' 处':file.access==='read'?'直接读取窗口':'写入 / 修改')+' ↗</small></button>').join('')+(call.files.length>5?'<p class="evidence-note">还有 '+(call.files.length-5)+' 个文件；左侧文件列表可查看全部关联。</p>':'')+(call.name==='grep'?'<p class="evidence-note">这里只计入实际返回的匹配行，不表示已读取整份文件。'+(call.search?.truncated?'本次返回有节选。':'')+'</p>':'')+'</section>':'')+
    '<div class="detail-tabs" role="tablist" aria-label="工具原始记录">'+[['result','返回原文'],['args','调用参数'],['source','记录依据']].map(([key,label])=>'<button role="tab" data-raw="'+key+'" aria-selected="'+(state.raw===key)+'">'+label+'</button>').join('')+'</div><pre class="code-block">'+esc(output||'没有文字记录')+'</pre>'+(omitted?'<p class="code-truncated">预览节选 · 另有 '+number(omitted)+' 个字符</p>':'')+'<div class="inspector-bottom"><button data-locate="'+call.seq+'">在第 '+call.turn+' 轮的路径中查看 ↗</button></div>';
}
function renderFile(id) {
  const file=fileById.get(id);if(!file)return;
  const returned=file.accesses.filter(a=>a.status==='returned');
  const read=returned.filter(a=>a.access==='read'),match=returned.filter(a=>a.access==='match'),write=returned.filter(a=>a.access==='write');
  $('inspector').innerHTML=inspectorHeader('文件记录','<div class="detail-type"><span class="icon-box" style="--family:'+FAMILIES.read.color+'">'+icon('read')+'</span><span>全程关联</span></div><h2>'+esc(file.name)+'</h2><p class="file-path">'+esc(file.path)+'</p>')+
  '<section class="detail-section"><h3>不同方式，分别记录</h3>'+metricsHTML([['直接读取',read.length+' 次'],['搜索命中片段',match.length+' 次'],['写入 / 修改',write.length+' 次'],['涉及轮次',new Set(file.accesses.map(a=>a.turn)).size+' 轮']])+'<p class="evidence-note">搜索命中表示模型取得了匹配片段。文件是否完整读入、是否满足修改前置条件，仍以对应的读取与 Harness 记录为准。</p></section><section class="detail-section"><h3>关联操作 · '+file.accesses.length+' 项</h3>'+file.accesses.slice(0,100).map(a=>'<button class="file-history-row" data-file-call="'+a.seq+'"><span><strong>'+({read:'读取窗口',match:'搜索命中片段',write:'写入 / 修改'}[a.access])+'</strong><small>第 '+a.turn+' 轮 · 第 '+a.step+' 步 · '+esc(a.tool)+'</small></span>'+status(a)+'</button>').join('')+'</section>';
}
function openCall(seq) {state.selected=Number(seq);state.selectedFile=null;state.raw='result';renderChart();renderRows();renderInspector();showInspector();$('live-status').textContent='已打开 '+callsBySeq.get(state.selected)?.name+' 工具返回';}
function openGroup(index) {
  const calls=chartGroups[index];if(!calls?.length)return;
  if(calls.length===1)return openCall(calls[0].seq);
  const family=calls[0].family;
  $('inspector').innerHTML=inspectorHeader(calls.every(c=>c.turn===calls[0].turn)?'第 '+calls[0].turn+' 轮':'第 '+Math.min(...calls.map(c=>c.turn))+'–'+Math.max(...calls.map(c=>c.turn))+' 轮','<div class="detail-type"><span class="icon-box" style="--family:'+FAMILIES[family].color+'">'+icon(family)+'</span><span>汇总分支</span></div><h2>'+calls.length+' 项实际操作</h2><p class="detail-subject">'+esc([...new Set(calls.map(c=>c.name))].join(' · '))+'</p>')+'<section class="detail-section"><h3>展开具体调用</h3>'+calls.slice(0,150).map(c=>'<button class="file-history-row" data-call="'+c.seq+'"><span><strong>'+esc(c.name+' · '+shorten(callSubject(c),28))+'</strong><small>第 '+c.turn+' 轮 · 第 '+c.step+' 步</small></span>'+status(c)+'</button>').join('')+(calls.length>150?'<p class="evidence-note">此处先列 150 项。可在左侧按轮次查看其余 '+(calls.length-150)+' 项。</p>':'')+'</section>';showInspector();
}
function render() {renderHeader();renderNav();renderChart();renderFamilies();renderRows();renderInspector();}
function allTurns() {state.mode='all';state.zoom=1;state.rows=80;state.selectedFile=null;$('graph-scroll').scrollLeft=0;render();}
function zoom(factor) {const viewport=$('graph-scroll'),fraction=(viewport.scrollLeft+viewport.clientWidth*.5)/Math.max(1,$('graph').width.baseVal.value);state.zoom=Math.max(.75,Math.min(16,state.zoom*factor));renderChart();viewport.scrollLeft=Math.max(0,fraction*$('graph').width.baseVal.value-viewport.clientWidth*.5);}

document.addEventListener('click',e=>{
  if(dragged){dragged=false;return;}
  const el=e.target.closest('button,[data-group],[data-step],[data-range]');if(!el||!data)return;
  if(el.dataset.turn)return openTurn(el.dataset.turn);
  if(el.dataset.call)return openCall(el.dataset.call);
  if(el.dataset.file){state.selectedFile=el.dataset.file;document.querySelector('.sidebar').classList.remove('is-open');$('nav-toggle').setAttribute('aria-expanded','false');renderNav();renderFile(state.selectedFile);showInspector();return;}
  if(el.dataset.fileCall){const seq=Number(el.dataset.fileCall),call=callsBySeq.get(seq);return openTurn(call.turn,seq);}
  if(el.dataset.locate){const seq=Number(el.dataset.locate),call=callsBySeq.get(seq);return openTurn(call.turn,seq);}
  if(el.dataset.group!==undefined)return openGroup(Number(el.dataset.group));
  if(el.dataset.range)return openTurn(el.dataset.range);
  if(el.dataset.step){const calls=(callsByTurn.get(state.turn)||[]).filter(c=>c.step===Number(el.dataset.step)),i=chartGroups.length;chartGroups.push(calls);return openGroup(i);}
  if(el.dataset.family){state.filter=state.filter===el.dataset.family?null:el.dataset.family;state.rows=80;renderFamilies();renderRows();renderChart();return;}
  if(el.dataset.nav){state.nav=el.dataset.nav;state.search='';state.navRows=150;$('search').value='';renderNav();return;}
  if(el.dataset.raw){state.raw=el.dataset.raw;renderInspector();return;}
  if(el.hasAttribute('data-more-rows')){state.rows+=80;renderRows();return;}
  if(el.hasAttribute('data-more-files')){state.navRows+=200;renderNav();return;}
  if(el.hasAttribute('data-close-inspector'))$('inspector').classList.remove('is-open');
});
$('all-turns').onclick=allTurns;$('mode-all').onclick=allTurns;$('mode-turn').onclick=()=>openTurn(state.turn);
$('nav-toggle').onclick=()=>{const open=document.querySelector('.sidebar').classList.toggle('is-open');$('nav-toggle').setAttribute('aria-expanded',String(open))};
$('preset-mixed').onclick=()=>{state.filter=null;openTurn(data.presets.mixed)};
$('preset-commands').onclick=()=>{state.filter=null;openTurn(data.presets.commands)};
$('clear-filter').onclick=()=>{state.filter=null;renderFamilies();renderRows();renderChart()};
$('zoom-in').onclick=()=>zoom(1.5);$('zoom-out').onclick=()=>zoom(1/1.5);$('zoom-fit').onclick=()=>{state.zoom=1;renderChart();$('graph-scroll').scrollLeft=0};
$('show-context').onchange=renderChart;
$('search').oninput=e=>{state.search=e.target.value;state.navRows=150;renderNav()};
$('graph').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-group],[data-step],[data-range]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
const viewport=$('graph-scroll');
viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,left:viewport.scrollLeft,id:e.pointerId};dragged=false;});
viewport.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x;if(Math.abs(dx)>6){dragged=true;viewport.setPointerCapture(drag.id);viewport.classList.add('dragging');}if(dragged)viewport.scrollLeft=drag.left-dx;});
const release=()=>{if(drag&&viewport.hasPointerCapture(drag.id))viewport.releasePointerCapture(drag.id);drag=null;viewport.classList.remove('dragging');if(dragged)setTimeout(()=>{dragged=false},0);};
viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);window.addEventListener('blur',release);
viewport.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){viewport.scrollLeft+=120;e.preventDefault()}if(e.key==='ArrowLeft'){viewport.scrollLeft-=120;e.preventDefault()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('inspector').classList.remove('is-open');document.querySelector('.sidebar').classList.remove('is-open');$('nav-toggle').setAttribute('aria-expanded','false')}});
new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(renderChart)}).observe(viewport);
try{
  const response=await fetch('/session.json');if(!response.ok)throw Error('读取快照失败');data=await response.json();
  callsBySeq=new Map(data.calls.map(c=>[c.seq,c]));turnsByNumber=new Map(data.turns.map(t=>[t.number,t]));fileById=new Map(data.files.map(f=>[f.id,f]));callsByTurn=new Map();
  for(const call of data.calls){if(!callsByTurn.has(call.turn))callsByTurn.set(call.turn,[]);callsByTurn.get(call.turn).push(call);}
  contextByStep=new Map();contextByTurn=new Map();let previous=null;
  for(const row of data.contextRequests){
    const keys=['system','tools','user','inject','skill','assistant','tool'],parts=keys.map(key=>(row[key]||0)-(previous?.[key]||0));
    const key=row.turn+':'+row.step;if(previous&&!contextByStep.has(key))contextByStep.set(key,{up:parts.reduce((n,v)=>n+Math.max(0,v),0),down:parts.reduce((n,v)=>n+Math.max(0,-v),0)});
    const total=keys.reduce((n,key)=>n+(row[key]||0),0),old=contextByTurn.get(row.turn);contextByTurn.set(row.turn,{total,net:old?old.net+parts.reduce((n,v)=>n+v,0):parts.reduce((n,v)=>n+v,0)});previous=row;
  }
  $('session-title').textContent=data.title;$('file-count').textContent=number(data.files.length);
  $('session-count').textContent=data.counts.turns+' 轮 · '+number(data.counts.steps)+' 步';
  $('source-count').textContent=number(data.calls.length)+' 项工具操作 · 包含内部调用';
  openTurn(data.presets.commands);
  window.__toolStudyReady=true;
  document.fonts.ready.then(renderChart);
}catch(error){$('view-title').textContent='快照读取失败';$('view-subtitle').textContent=error.message;$('record-list').innerHTML='<p class="loading-copy">请运行预览构建脚本后重试。</p>';}
