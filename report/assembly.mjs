import { CONTEXT_SERIES, VISUAL_TOKENS } from './palette.mjs';
import { assemblyFrames, assemblyDiff, assemblyLayout } from './assembly-model.mjs';

const assemblyEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assemblyColors=Object.fromEntries(CONTEXT_SERIES.map(([key,,color])=>[key,color]));
const assemblyNames=Object.fromEntries(CONTEXT_SERIES.map(([key,label])=>[key,label]));
const assemblyText=(x,y,text,cls='assembly-copy')=>'<text x="'+x+'" y="'+y+'" class="'+cls+'">'+assemblyEscape(text)+'</text>';
const assemblyFrameLabel=frame=>frame.label||'第 '+frame.turn+' 轮'+(frame.step!=null?' · 第 '+frame.step+' 步':'');

function assemblyPieces(ids,focus){
  if(ids.length<=18)return ids.map(id=>[id]);
  const keep=new Set([...ids.slice(0,4),...ids.slice(-4),...ids.filter(id=>focus.has(id)).slice(0,4)]),parts=[];
  for(const id of ids){if(keep.has(id))parts.push([id]);else if(parts.at(-1)?.omitted)parts.at(-1).push(id);else{const group=[id];group.omitted=true;parts.push(group);}}
  return parts;
}

function assemblyScene(frame,data,diff,phase,offset){
  const focus=phase==='mark'||phase==='fracture'?diff.removed:diff.added;
  const layout=assemblyLayout(frame,data,{focus,offset}),focusSet=new Set(focus),removed=new Set(diff.removed),red=phase==='mark'||phase==='fracture';
  let scene=assemblyText(20,28,'这一轮带来的材料','assembly-heading')+assemblyText(280,28,'正在装配的上下文','assembly-heading');
  const sourceY={user:202,skill:246,tool:290,assistant:334,inject:378};
  for(const [key,y]of Object.entries(sourceY))scene+='<circle cx="25" cy="'+(y-4)+'" r="2.6" fill="'+assemblyColors[key]+'"/>'+assemblyText(38,y,assemblyNames[key],'assembly-source-label')+'<path d="M38 '+(y+11)+'H106" stroke="'+assemblyColors[key]+'" opacity=".45" stroke-width="2"/>';
  const piece=(ids,x,y,width)=>{
    const block=data.blocks[ids[0]],mixed=ids.length>1,alert=red&&ids.every(id=>removed.has(id)),color=mixed?'#a3a3a3':assemblyColors[block.category]||'#8b949e';
    const label=mixed?'另 '+ids.length+' 条消息':(assemblyNames[block.category]||block.category)+' · '+block.label;
    return '<g class="assembly-fragment'+(alert?' is-rewritten':'')+'" transform="translate('+x+' '+y+')" data-assembly-ids="'+assemblyEscape(JSON.stringify(ids))+'" data-assembly-x="'+x+'" data-assembly-y="'+y+'" tabindex="0" role="button" aria-label="'+assemblyEscape(label)+'"><title>'+assemblyEscape(label)+'</title><g class="assembly-piece"><rect width="'+width+'" height="7" rx="1" fill="'+color+'"/>'+(alert?'<rect x="-2" y="-3" width="'+(width+4)+'" height="13" rx="2" fill="none" stroke="'+VISUAL_TOKENS.changePulse+'"/>':'')+(mixed?assemblyText(width/2-7,5,'···','assembly-ellipsis'):'')+'</g></g>';
  };
  for(const [region,y,title]of [['system',78,'01  系统提示'],['tools',120,'02  工具定义']]){
    scene+=assemblyText(280,y-12,title,'assembly-region-label');
    if(!frame[region].length)scene+=assemblyText(280,y+8,'此切点未提供','assembly-small');
    else {const width=(352-(frame[region].length-1)*5)/frame[region].length;frame[region].forEach((id,i)=>{scene+=piece([id],280+i*(width+5),y,width);});}
    if(red&&diff.regions[region].rewrite)scene+='<path d="M270 '+(y-4)+'H646" class="assembly-break-rule"/>';
  }
  scene+=assemblyText(280,161,'03  逐轮拼入的历史','assembly-region-label')+assemblyText(677,161,'来源轮次 / 消息数','assembly-small');
  layout.shown.forEach((group,i)=>{
    const y=182+i*21,parts=assemblyPieces(group.ids,focusSet),width=(352-(parts.length-1)*5)/Math.max(1,parts.length);
    scene+='<path d="M276 '+(y+15)+'H640" stroke="#f0f0ed"/>';
    parts.forEach((ids,j)=>{scene+=piece(ids,280+j*(width+5),y,width);});
    scene+=assemblyText(677,y+8,(group.key==='unknown'?'未记轮次':String(group.key).padStart(2,'0'))+' / '+group.ids.length,'assembly-small');
    if(red&&group.ids.some(id=>removed.has(id)))scene+='<path d="M260 '+(y-5)+'H649" class="assembly-break-rule"/>';
  });
  const endY=layout.shown.length?182+(layout.shown.length-1)*21+8:150;
  scene+='<path d="M263 76h-9V'+endY+'h9" fill="none" stroke="'+(red?VISUAL_TOKENS.changePulse:VISUAL_TOKENS.line)+'" stroke-width="1.2"/>';
  const hidden=layout.before+layout.after;
  scene+=assemblyText(280,465,hidden?'当前窗口之外还有 '+hidden+' 条消息 · 可平移历史窗口':'已保留的片段留在原位，新片段从来源侧拼入。','assembly-note');
  scene+=assemblyText(280,488,'片段按逻辑顺序排列；宽度不表示 token 数或缓存位置。','assembly-small');
  return {scene,layout};
}

export function renderAssembly(data,spec={}){
  const frames=assemblyFrames(data,spec),index=spec.initialRow?frames.findIndex(frame=>frame.id===spec.initialRow):spec.autoplay?0:frames.length-1;
  const frame=frames[index],diff=assemblyDiff(frames[index-1],frame),{scene}=assemblyScene(frame,data,diff,'settled',null);
  return '<div class="context-assembly" data-context-assembly><div class="assembly-story"><div><span data-assembly-position>'+assemblyEscape(assemblyFrameLabel(frame))+'</span><h3 data-assembly-sentence>上下文在这里接续。</h3></div><span class="assembly-badge">'+(data.coverage?.synthetic?'概念序列':'记录重放')+' · '+frames.length+' 个切点</span></div><svg class="assembly-scene" viewBox="0 0 800 510" role="group" aria-label="上下文逐轮拼装与历史结构变化">'+scene+'</svg><div class="assembly-transport"><div><button data-assembly-action="play">▶ 播放</button><button data-assembly-action="restart">↻ 重播</button><button data-assembly-action="change">下一处历史变化 ↗</button></div><span data-assembly-progress></span></div><nav class="assembly-timeline" aria-label="选择上下文记录位置">'+frames.map((f,i)=>'<button data-assembly-frame="'+i+'" aria-label="'+assemblyEscape(assemblyFrameLabel(f))+'" title="'+assemblyEscape(assemblyFrameLabel(f))+'"><i></i><span>'+assemblyEscape(f.turn??i)+'</span></button>').join('')+'</nav><div class="assembly-facts" aria-live="polite"><div><span>当前保留历史</span><strong data-assembly-count>'+frame.history.length+' 条消息</strong></div><div><span>历史前缀</span><strong data-assembly-prefix></strong></div><div><span>这次结构变化</span><strong data-assembly-change></strong></div></div><div class="assembly-window"><span data-assembly-window></span><div><button data-assembly-action="earlier">← 较早</button><button data-assembly-action="later">较后 →</button></div></div><div class="assembly-selection" data-assembly-selection hidden></div></div>';
}

// One isolated controller per component. No global IDs, background fetching or
// perpetual animation loop. The host owns dataset collection and full-body reads.
export function mountAssembly(root,data,spec={},options={}){
  const frames=assemblyFrames(data,spec),media=matchMedia('(prefers-reduced-motion: reduce)'),abort=new AbortController(),animations=new Set();
  const changes=frames.map((frame,i)=>assemblyDiff(frames[i-1],frame)),rewriteIndices=changes.flatMap((change,i)=>i>0&&change.rewrite?[i]:[]);
  let index=media.matches&&spec.autoplay?frames.length-1:spec.initialRow?frames.findIndex(frame=>frame.id===spec.initialRow):spec.autoplay?0:frames.length-1;
  let playing=false,phase='settled',timer=null,queued=null,due=0,remaining=0,destroyed=false,offset=null,layout,shownFrame;
  let diff=assemblyDiff(frames[index-1],frames[index]);
  const find=name=>root.querySelector('[data-assembly-'+name+']');
  const scene=root.querySelector('.assembly-scene');
  const animate=(element,keyframes,duration=VISUAL_TOKENS.motion.insert)=>{
    if(media.matches)return;
    const motion=element.animate(keyframes,{duration,easing:'cubic-bezier(.22,.75,.2,1)',fill:'both'});
    animations.add(motion);if(!playing)motion.pause();motion.finished.catch(()=>{}).finally(()=>{animations.delete(motion);if(element.dataset.assemblyTransient)element.remove();motion.cancel();});
  };
  const cancelMotion=()=>{if(timer!==null)clearTimeout(timer);timer=null;queued=null;for(const motion of animations)motion.cancel();animations.clear();};
  const runTimer=()=>{
    if(!playing||!queued||timer!==null)return;
    due=performance.now()+remaining;timer=setTimeout(()=>{timer=null;const next=queued;queued=null;if(!root.isConnected){destroy();return;}next?.();},remaining);
  };
  const schedule=(fn,ms)=>{queued=fn;remaining=ms;runTimer();};
  const update=()=>{
    const frame=frames[index],change=diff.rewrite;
    find('position').textContent=assemblyFrameLabel(frame);
    find('sentence').textContent=phase==='mark'?'较早的结构发生变化，先标出旧片段。':phase==='fracture'?'松开旧片段，其他内容继续保留。':phase==='insert'?'新片段回到它在上下文中的位置。':index===0?'从这个切点已有的内容开始。':change?'沿着变化后的结构，继续接续。':diff.added.length?'这一轮，从末尾接上。':'这一段结构继续保留。';
    root.classList.toggle('is-changing',phase==='mark'||phase==='fracture');
    root.querySelector('[data-assembly-action="play"]').textContent=playing?'Ⅱ 暂停':index===frames.length-1&&phase==='settled'?'↻ 播放':'▶ 播放';
    find('progress').textContent=String(index+1).padStart(2,'0')+' / '+frames.length;
    find('count').textContent=(shownFrame||frame).history.length+' 条消息';
    find('prefix').textContent=index===0?'首个观察切点':diff.prefix+' 条沿用原顺序';
    find('change').textContent=index===0?'已有结构':diff.added.length+' 新增 · '+diff.removed.length+' 移除'+(change&&!diff.removed.length?' · 顺序变化':'');
    for(const button of root.querySelectorAll('[data-assembly-frame]')){const n=Number(button.dataset.assemblyFrame);button.setAttribute('aria-current',String(n===index));button.classList.toggle('is-past',n<index);button.classList.toggle('has-change',changes[n].rewrite);}
    options.onChange?.({frame,index,phase,playing});
  };
  const paint=(frame,stage)=>{
    shownFrame=frame;const rendered=assemblyScene(frame,data,diff,stage,offset);layout=rendered.layout;scene.innerHTML=rendered.scene;
    find('window').textContent=layout.groups.length?'历史第 '+(layout.start+1)+'–'+Math.min(layout.groups.length,layout.start+12)+' 段，共 '+layout.groups.length+' 段':'还没有历史消息';
    root.querySelector('[data-assembly-action="earlier"]').disabled=layout.start===0;
    root.querySelector('[data-assembly-action="later"]').disabled=layout.start+12>=layout.groups.length;
  };
  const animateInserted=()=>{
    const inserted=new Set(diff.added),sources={user:202,skill:246,tool:290,assistant:334,inject:378,system:78,tools:120};
    let count=0;
    for(const part of scene.querySelectorAll('[data-assembly-ids]')){
      const ids=JSON.parse(part.dataset.assemblyIds);if(!ids.some(id=>inserted.has(id))||count++>=24)continue;
      const block=data.blocks[ids[0]],dx=112-Number(part.dataset.assemblyX),dy=(sources[block.category]??300)-Number(part.dataset.assemblyY);
      animate(part.querySelector('.assembly-piece'),[{transform:'translate('+dx+'px,'+dy+'px) scaleX(.6)',opacity:0},{offset:.65,transform:'translate('+(dx*.15)+'px,'+(dy*.1-8)+'px) scaleX(.96)',opacity:.8},{transform:'translate(0,0) scaleX(1)',opacity:1}],VISUAL_TOKENS.motion.insert);
    }
  };
  const fracture=()=>{
    phase='fracture';update();let count=0;
    for(const part of scene.querySelectorAll('.is-rewritten')){
      if(count++>=12)break;const original=part.querySelector('.assembly-piece'),width=Number(original.querySelector('rect').getAttribute('width'));
      original.style.opacity='0';
      for(let i=0;i<4;i++){
        const fragment=document.createElementNS('http://www.w3.org/2000/svg','rect');
        fragment.dataset.assemblyTransient='true';
        for(const [key,value]of Object.entries({x:i*width/4,y:0,width:Math.max(1,width/4-2),height:8,fill:VISUAL_TOKENS.changePulse}))fragment.setAttribute(key,value);
        part.append(fragment);animate(fragment,[{transform:'translate(0,0)',opacity:.8},{transform:'translate('+((i-1.5)*16)+'px,'+(18+i*5)+'px) rotate('+((i-1.5)*6)+'deg)',opacity:0}],600);
      }
    }
    schedule(insert,VISUAL_TOKENS.motion.fracture);
  };
  const settle=()=>{
    phase='settled';paint(frames[index],phase);update();
    if(index===frames.length-1){playing=false;update();return;}
    if(playing)schedule(advance,VISUAL_TOKENS.motion.hold);
  };
  const insert=()=>{phase='insert';paint(frames[index],phase);animateInserted();update();schedule(settle,VISUAL_TOKENS.motion.insert+50);};
  const advance=()=>{
    if(index>=frames.length-1){playing=false;update();return;}
    const previous=frames[index++];diff=assemblyDiff(previous,frames[index]);offset=null;
    if(media.matches){settle();return;}
    if(diff.rewrite){phase='mark';paint(previous,phase);update();schedule(fracture,VISUAL_TOKENS.motion.mark);}else insert();
  };
  function pause(){
    playing=false;if(timer!==null){clearTimeout(timer);timer=null;remaining=Math.max(0,due-performance.now());}
    for(const motion of animations)motion.pause();update();
  }
  function seek(position){
    const target=typeof position==='string'?frames.findIndex(frame=>frame.id===position):position;
    if(!Number.isInteger(target)||target<0||target>=frames.length)throw Error('Unknown assembly position');
    cancelMotion();playing=false;index=target;phase='settled';offset=null;diff=assemblyDiff(frames[index-1],frames[index]);paint(frames[index],phase);update();
  }
  function play(){
    if(index===frames.length-1&&phase==='settled')seek(0);
    playing=true;for(const motion of animations)motion.play();if(!queued)schedule(advance,650);else runTimer();update();
  }
  function destroy(){if(destroyed)return;destroyed=true;cancelMotion();abort.abort();observer?.disconnect();}
  root.addEventListener('click',event=>{
    const action=event.target.closest('[data-assembly-action]')?.dataset.assemblyAction;
    if(action==='play'){playing?pause():play();return;}
    if(action==='restart'){seek(0);play();return;}
    if(action==='change'){
      const next=rewriteIndices.find(i=>i>index)??rewriteIndices[0];if(next!==undefined){seek(next-1);playing=true;advance();}return;
    }
    if(action==='earlier'||action==='later'){pause();offset=Math.max(0,Math.min(Math.max(0,layout.groups.length-12),layout.start+(action==='earlier'?-6:6)));paint(shownFrame,phase);return;}
    const frameButton=event.target.closest('[data-assembly-frame]');if(frameButton){seek(Number(frameButton.dataset.assemblyFrame));return;}
    const part=event.target.closest('[data-assembly-ids]');if(part){
      pause();const ids=JSON.parse(part.dataset.assemblyIds),blocks=ids.map(id=>({id,...data.blocks[id]}));
      find('selection').hidden=false;find('selection').textContent=blocks.length===1?blocks[0].label+' · '+(blocks[0].categoryBasis||'结构显示'):'所选片段包含 '+blocks.length+' 条消息';
      options.onSelect?.({frame:shownFrame,blocks,evidence:blocks.flatMap(block=>block.evidence||[])});
    }
  },{signal:abort.signal});
  root.addEventListener('keydown',event=>{if(event.target.matches('[data-assembly-ids]')&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}},{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)pause();},{signal:abort.signal});
  media.addEventListener('change',()=>{if(media.matches){pause();seek(index);}},{signal:abort.signal});
  let firstVisible=true;
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const entry of entries){if(!entry.isIntersecting&&playing)pause();else if(entry.isIntersecting&&firstVisible){firstVisible=false;if(spec.autoplay&&!media.matches&&!document.hidden)play();}}
  },{threshold:0}):null;
  paint(frames[index],phase);update();observer?.observe(root);
  if(!observer&&spec.autoplay&&!media.matches&&!document.hidden)play();
  return {play,pause,seek,destroy,get state(){return {row:frames[index].id,index,phase,playing};}};
}
