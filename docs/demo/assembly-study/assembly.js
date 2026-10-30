// A deliberately fictional twelve-round sequence for motion and composition.
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const colors={system:'#8053e3',tools:'#d49b00',user:'#44a56b',skill:'#e66d26',assistant:'#5b9fe8',tool:'#3ab4a4',inject:'#c442a7',red:'#ce5757'};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const X=280,WIDTH=352,BASE=178,PITCH=21,animations=new Set();
let round=0,phase='baseline',playing=false,timer=null,due=0,remaining=0,next=null;
function svg(tag,attrs={},parent=$('scene')){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e}
function label(x,y,value,cls,parent){const e=svg('text',{x,y,class:cls},parent);e.textContent=value;return e}
function animate(el,frames,options={}){const a=el.animate(frames,{duration:reduced?1:750,easing:'cubic-bezier(.22,.75,.2,1)',...options,...(reduced?{duration:1,delay:0}:{})});animations.add(a);if(!playing)a.pause();a.finished.catch(()=>{}).finally(()=>animations.delete(a));return a}
function schedule(fn,ms){next=fn;remaining=reduced?1:ms;if(playing){due=performance.now()+remaining;timer=setTimeout(()=>{timer=null;next=null;fn()},remaining)}}
function play(){if(round===12&&phase==='done'){restart();return}playing=true;for(const a of animations)a.play();if(next&&timer==null){due=performance.now()+remaining;timer=setTimeout(()=>{timer=null;const fn=next;next=null;fn?.()},remaining)}updateControls()}
function pause(){playing=false;if(timer!=null){clearTimeout(timer);timer=null;remaining=Math.max(0,due-performance.now())}for(const a of animations)a.pause();updateControls()}
function clearMotion(){if(timer!=null)clearTimeout(timer);timer=null;next=null;for(const a of animations)a.cancel();animations.clear()}
function updateControls(){$('play').textContent=phase==='done'?'↻ 再看一次':playing?'Ⅱ 暂停':'▶ 播放';$('play').setAttribute('aria-label',playing?'暂停动画':'播放动画');$('position').textContent=String(round).padStart(2,'0')+' / 12';document.querySelectorAll('#timeline button').forEach((b,i)=>{b.classList.toggle('past',i+1<round);b.classList.toggle('active',i+1===round)})}
function tell(eyebrow,sentence,state,prefix,action,red=false){$('round').textContent=eyebrow;$('sentence').textContent=sentence;$('state').textContent=state;$('prefix').textContent=prefix;$('action').textContent=action;document.querySelector('.story').classList.toggle('rewrite',red);$('assembled').innerHTML=String(round).padStart(2,'0')+' <small>轮</small>';updateControls()}
function buildStage(){
  $('scene').innerHTML='';
  const defs=svg('defs');const pattern=svg('pattern',{id:'paper-grid',width:21,height:21,patternUnits:'userSpaceOnUse'},defs);svg('circle',{cx:1,cy:1,r:.65,fill:'#efefeb'},pattern);
  svg('rect',{x:240,y:52,width:440,height:397,fill:'url(#paper-grid)',opacity:.6});
  label(20,36,'这一轮带来的材料','s-head');label(X,36,'正在装配的上下文','s-head');label(680,36,'轮次','s-small');
  svg('path',{d:`M${X-22} 61 h-9 v76 h9`,class:'quiet-guide'});
  label(X-13,73,'系统提示','s-small');svg('rect',{x:X,y:86,width:WIDTH,height:7,rx:1,fill:colors.system,'fill-opacity':.22});svg('line',{x1:X,y1:94,x2:X+WIDTH,y2:94,stroke:colors.system,'stroke-opacity':.45});
  label(X-13,115,'工具定义','s-small');svg('rect',{x:X,y:128,width:WIDTH,height:6,rx:1,fill:colors.tools,'fill-opacity':.24});
  label(X-13,164,'逐轮拼入的历史','s-small');
  for(const [i,[key,name]]of [['user','用户消息'],['skill','Skill 内容'],['tool','工具结果'],['assistant','助手消息']].entries()){
    const y=202+i*44;svg('circle',{cx:25,cy:y-4,r:2.6,fill:colors[key]});label(38,y,name,'s-label');svg('line',{x1:38,y1:y+11,x2:106,y2:y+11,stroke:colors[key],'stroke-opacity':.45,'stroke-width':2});
  }
  svg('g',{id:'feed'});svg('g',{id:'rows'});svg('g',{id:'fragments'});
  svg('path',{id:'cache-brace',d:`M${X-16} 84 h-7 v51 h7`});
  svg('path',{id:'cache-tail',d:''});
  svg('line',{id:'break-line',x1:X-37,y1:BASE+PITCH*2+5,x2:X+WIDTH+45,y2:BASE+PITCH*2+5});
  label(X+WIDTH+47,BASE+PITCH*2+9,'←','s-note red').id='break-label';
  label(20,423,'每一轮只接上新增的部分。','s-note-strong').id='scene-note';
  label(20,448,'已装好的内容，继续留在原位。','s-note').id='scene-detail';
  svg('path',{class:'end-mark',id:'end-mark',d:'M697 409l5 5 10-12','fill':'none',stroke:'#4d897b','stroke-width':1.8});
}
function brace(last=round){const end=last?BASE+(last-1)*PITCH+7:135;$('cache-brace').setAttribute('d',`M${X-16} 84 h-7 V${end} h7`)}
function rowParts(n){const keys=n===3?['user','skill','assistant','tool','assistant']:['user','assistant','tool','assistant'];const weights=keys.map((_,i)=>16+((n*37+i*53)%63));const total=weights.reduce((a,b)=>a+b,0);return keys.map((key,i)=>({key,width:(WIDTH-(keys.length-1)*5)*weights[i]/total}))}
function addRound(n,motion=true){
  const y=BASE+(n-1)*PITCH,row=svg('g',{class:'round-row',id:'row-'+n},$('rows'));
  svg('line',{x1:X-4,y1:y+15,x2:X+WIDTH+7,y2:y+15,class:'row-divider'},row);
  const parts=rowParts(n);let offset=0;
  for(const [i,p]of parts.entries()){
    const wrapper=svg('g',{transform:`translate(${X+offset} ${y})`,'data-key':p.key,'data-width':p.width},row),piece=svg('g',{class:'piece'},wrapper);
    svg('rect',{width:p.width,height:7,rx:1,fill:colors[p.key],class:'piece-fill'},piece);
    svg('line',{x1:0,y1:8,x2:p.width,y2:8,stroke:colors[p.key],class:'piece-edge'},piece);
    if(motion){const sourceY={user:198,skill:242,tool:286,assistant:330}[p.key],dx=112-X-offset,dy=sourceY-y;
      animate(piece,[{transform:`translate(${dx}px,${dy}px) scaleX(.65)`,opacity:0},{offset:.55,transform:`translate(${dx*.3}px,${dy*.25-14}px) scaleX(.94)`,opacity:.8},{transform:'translate(0px,0px) scaleX(1)',opacity:1}],{duration:850,delay:i*85});}
    offset+=p.width+5;
  }
  label(680,y+8,String(n).padStart(2,'0'),'s-round',row);
  if(motion){const path=svg('path',{d:`M112 286 C195 286,202 ${y+4},${X-7} ${y+4}`,stroke:colors.tool,class:'feed-path'},$('feed'));animate(path,[{opacity:0},{opacity:.4,offset:.3},{opacity:0}],{duration:1100});}
  for(const old of document.querySelectorAll('.round-row'))old.classList.toggle('settled',old!==row);
  brace(n);
}
function ordinaryRound(){
  round++;phase='append';addRound(round);
  const prefix=round<7?'连续保留':round<9?'新的片段已接回':'新的前缀稳定';
  tell('第 '+String(round).padStart(2,'0')+' 轮 · 追加',round===3?'这一轮，带来了一份 Skill。':round===8?'从改写后的历史，继续往下拼。':'新一轮，从末尾接上。','拼入中',prefix,'末尾追加');
  $('scene-note').textContent=round<7?'每一轮只接上新增的部分。':'改写留下一道痕迹，后续仍然可以接着拼。';
  $('scene-detail').textContent=round<7?'已装好的内容，继续留在原位。':'系统与工具基线保持原位，新的历史继续累积。';
  if(round>=9){$('scene').classList.remove('rewrite');document.querySelectorAll('.round-row.unstable').forEach(r=>r.classList.remove('unstable'));}
  schedule(nextRound,1450);
}
function nextRound(){
  if(round===6){beginRewrite();return}
  if(round===12){phase='done';playing=false;$('scene-note').textContent='12 轮，一次局部历史改写。';$('scene-detail').textContent='新的上下文，沿着修改过的结构继续长出来。';$('end-mark').style.opacity='1';tell('装配完成','上下文不是一次装好，而是不断拼装。','已完成','新的前缀稳定','继续追加');return}
  ordinaryRound();
}
function beginRewrite(){
  round=7;phase='detect';$('scene').classList.add('rewrite');brace(2);
  $('cache-tail').setAttribute('d',`M${X-23} ${BASE+PITCH*2} V${BASE+PITCH*5+8} h7`);
  const target=$('row-3').querySelector('[data-key="tool"]');
  const tint=svg('rect',{x:X-3,y:BASE+PITCH*2-5,width:WIDTH+6,height:PITCH+3,class:'rewrite-tint'},$('fragments'));
  animate(tint,[{opacity:0},{opacity:.62,offset:.4},{opacity:.18}],{duration:900,fill:'forwards'});
  target.querySelector('rect').setAttribute('fill',colors.red);target.querySelector('line').setAttribute('stroke',colors.red);
  for(const n of [3,4,5,6])$('row-'+n)?.classList.add('unstable');
  tell('第 07 轮 · 历史改写','较早的一块内容，突然变了。','前缀变化','第 3 轮起变化','改写历史片段',true);
  $('scene-note').textContent='不是接在末尾，这次改到了前面。';$('scene-detail').textContent='第 3 轮的工具结果被改写，原来的连续结构在这里断开。';
  schedule(()=>fracture(target),900);
}
function fracture(target){
  phase='fracture';const box=target.getAttribute('transform'),width=Number(target.dataset.width),parent=svg('g',{transform:box},$('fragments'));
  target.querySelector('.piece').style.opacity='0';
  for(let i=0;i<4;i++){const fragment=svg('rect',{x:i*width/4,y:0,width:Math.max(2,width/4-3),height:8,rx:1,fill:colors.red,'fill-opacity':.45},parent);
    animate(fragment,[{transform:'translate(0,0) rotate(0deg)',opacity:.8},{transform:`translate(${(i-1.5)*18}px,${16+i*5}px) rotate(${(i-1.5)*7}deg)`,opacity:0}],{duration:1250,fill:'forwards'});}
  tell('第 07 轮 · 拆开旧片段','旧片段松开，后面的连接也暗了下来。','正在拆开','稳定部分退到第 2 轮','局部拆解',true);
  schedule(()=>repair(target),1400);
}
function repair(target){
  phase='repair';const piece=target.querySelector('.piece');piece.style.opacity='1';piece.querySelector('rect').setAttribute('fill',colors.tool);piece.querySelector('line').setAttribute('stroke',colors.tool);
  animate(piece,[{transform:'translate(-210px,-24px) scaleX(.5)',opacity:0},{offset:.7,transform:'translate(7px,0) scaleX(1.02)',opacity:1},{transform:'translate(0,0) scaleX(1)',opacity:1}],{duration:1100});
  tell('第 07 轮 · 装入新片段','新的内容，嵌回原来的位置。','重新拼合','局部重新组装','换入新内容',true);
  $('scene-note').textContent='只换这一块，留下其他已经拼好的内容。';$('scene-detail').textContent='红色退去，接缝仍然指出这次历史改写发生在哪里。';
  schedule(()=>{phase='after-repair';addRound(7);$('scene').classList.remove('rewrite');$('fragments').innerHTML='';brace(7);tell('第 07 轮 · 继续装配','修好的历史，接住这一轮的新内容。','已拼回','从新结构继续','追加本轮内容');schedule(nextRound,1500)},1400);
}
function resetTo(n){clearMotion();buildStage();$('scene').classList.remove('rewrite');round=0;phase='append';for(let i=1;i<=n;i++){addRound(i,false);round=i}brace(n);tell('第 '+String(n).padStart(2,'0')+' 轮','已经拼入的内容，留在这里。','已就位','连续保留','末尾追加')}
function restart(){clearMotion();playing=true;round=0;phase='baseline';buildStage();tell('准备装配','先放好系统与工具。','开始','等待装配','放入基线');schedule(nextRound,700)}
function jump(){resetTo(6);playing=true;updateControls();schedule(beginRewrite,350)}
$('play').onclick=()=>playing?pause():play();$('restart').onclick=restart;$('jump').onclick=jump;
for(let i=1;i<=12;i++){const b=document.createElement('button');b.className=i===7?'break':'';b.innerHTML='<span>'+String(i).padStart(2,'0')+'</span>';b.setAttribute('aria-label','查看第 '+i+' 轮');b.onclick=()=>{if(i===7){jump();return}resetTo(i);playing=false;phase=i===12?'done':'append';schedule(nextRound,400);updateControls()};$('timeline').append(b)}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)pause()});
if(reduced){resetTo(12);phase='done';playing=false;updateControls()}else restart();
