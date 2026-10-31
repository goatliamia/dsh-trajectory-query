import { bindFigure, groupSum } from './contract.mjs';
import { compactTrendPolyline } from '../lib/context-trend-geometry.mjs';
import { CONTEXT_SERIES, VISUAL_TOKENS } from './palette.mjs';
import { renderAssembly } from './assembly.mjs';
export { CONTEXT_SERIES } from './palette.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'未记录':Math.abs(n)>=1e6?(n/1e6).toFixed(2)+'M':Math.abs(n)>=1000?(n/1000).toFixed(1)+'k':Number(n.toFixed(2)).toString();
const tx=(x,y,v,cl='plot-axis',anchor='start')=>'<text class="'+cl+'" x="'+x+'" y="'+y+'" text-anchor="'+anchor+'">'+esc(v)+'</text>';
const svg=(h,title,body)=>'<svg viewBox="0 0 940 '+h+'" role="img" aria-label="'+esc(title)+'">'+body+'</svg>';
const rule=(y,left=66,right=868)=>'<path class="plot-grid" d="M'+left+' '+y+'H'+right+'"/>';
const known=n=>typeof n==='number'&&Number.isFinite(n);
const extent=values=>{const valid=values.filter(known);return valid.length?[Math.min(0,...valid),Math.max(1,...valid)]:[0,1];};
const color=key=>CONTEXT_SERIES.find(c=>c[0]===key)?.[2]||VISUAL_TOKENS.metric;
const partColor=(key,i)=>CONTEXT_SERIES.find(c=>c[0]===key)?.[2]||VISUAL_TOKENS.request[key]||CONTEXT_SERIES[i%CONTEXT_SERIES.length][2];
const percentage=(n,total)=>total>0?(n>0&&n/total<.001?'不足 0.1%':(n/total*100).toFixed(1)+'%'):'—';
const rowLabel=row=>row.turn!=null?'第 '+row.turn+' 轮'+(row.step!=null?' · 第 '+row.step+' 步':''):row.id;
const selectedRows=(data,spec)=>spec.rows.map(id=>data.rows.find(row=>row.id===id));
const compositionParts=(data,spec,row)=>spec.series.map((key,i)=>({key,label:data.columns[key].label,value:row[key],color:partColor(key,i)}));
const partsTotal=parts=>parts.every(part=>known(part.value))?parts.reduce((n,part)=>n+part.value,0):null;
const compositionLegend=(data,spec)=>'<div class="legend">'+spec.series.map((key,i)=>'<span><i style="background:'+partColor(key,i)+'"></i>'+esc(data.columns[key].label)+'</span>').join('')+'</div>';
const describe=(data,row)=>Object.keys(data.columns).filter(key=>row[key]!=null&&data.columns[key].unit!=='timestamp-ms').map(key=>data.columns[key].label+' '+(typeof row[key]==='number'?measured(row[key],data.columns[key]).join(' ').trim():row[key])).join(' · ');
function mark(data,row,body){const title=Object.keys(data.columns).filter(key=>row[key]!=null&&data.columns[key].unit!=='timestamp-ms').slice(0,4).map(key=>data.columns[key].label+' '+(typeof row[key]==='number'?fmt(row[key]):row[key])).join(' · ');return '<g class="plot-mark" tabindex="0" data-row="'+esc(row.id)+'"><title>'+esc(title)+'</title>'+body+'</g>';}
function unit(data,key){const u=data.columns[key].unit;return u==='timestamp-ms'?'秒':u;}
function empty(message){return '<p class="report-data-unavailable">'+esc(message)+'</p>';}
function measured(value,column){
 if(!known(value))return ['未记录',''];
 if(column.unit==='ms')return value>=3600000?[fmt(value/3600000),'小时']:value>=60000?[fmt(value/60000),'分钟']:value>=1000?[fmt(value/1000),'秒']:[fmt(value),'ms'];
 if(column.unit==='ratio')return [fmt(value*100),'%'];
 return [column.unit==='count'?value.toLocaleString('en-US'):fmt(value),({tokens:'tokens',characters:'字符',count:''})[column.unit]??column.unit];
}
function metrics(data,spec){
 return '<div class="report-metrics">'+spec.items.map(item=>{
  const row=data.rows.find(r=>r.id===item.row),column=data.columns[item.field],[value,suffix]=measured(row[item.field],column);
  return '<button class="report-metric" data-row="'+esc(row.id)+'" data-readout="'+esc((item.label||column.label)+' · '+value+' '+suffix+' · '+({official:'官方统计',reported:'实报用量',observed:'记录观测',estimated:'估算'}[column.basis]||'已记录读数'))+'"><span>'+esc(item.label||column.label)+'</span><strong>'+esc(value)+'<small>'+esc(suffix)+'</small></strong></button>';
 }).join('')+'</div>';
}

function bar(data,spec){
 const {label,value,detail}=spec.fields;
 if(spec.groupBy)data=groupSum(data,spec.groupBy,value);
 let rows=data.rows.filter(r=>known(r[value]));
 if(spec.sort==='descending')rows=[...rows].sort((a,b)=>b[value]-a[value]);
 const total=rows.length;rows=rows.slice(0,spec.limit||200);
 if(!rows.length)return empty('这个范围没有已记录的'+data.columns[value].label);
 const [min,max]=extent(rows.map(r=>r[value]));
 const rawUnit=unit(data,value),divisor=rawUnit==='ms'?(max>=3600000?3600000:max>=60000?60000:max>=1000?1000:1):1;
 const displayUnit=rawUnit==='ms'?({3600000:'小时',60000:'分钟',1000:'秒',1:'ms'})[divisor]:rawUnit;
 const number=n=>fmt(n/divisor);
 if(spec.orientation==='vertical'){
  const base=224,scale=n=>base-(n-min)/(max-min)*166,w=790/rows.length;
  let b='';for(let i=0;i<=3;i++){const v=min+(max-min)*i/3;b+=rule(scale(v))+tx(48,scale(v)+4,number(v),'plot-axis','end');}
  rows.forEach((r,i)=>{const x=70+i*w;b+=mark(data,r,'<rect x="'+x+'" y="'+Math.min(scale(r[value]),scale(0))+'" width="'+Math.max(1,w*.72)+'" height="'+Math.max(.6,Math.abs(scale(r[value])-scale(0)))+'" fill="'+(spec.highlight?.includes(r[label])?VISUAL_TOKENS.warning:VISUAL_TOKENS.metric)+'"/>');if(rows.length<15||i%Math.max(1,Math.floor(rows.length/6))===0)b+=tx(x+w/3,249,r[label],'plot-axis','middle');});
  return svg(270,spec.title,b)+ '<p class="chart-caption">'+esc(data.columns[value].label+'（'+displayUnit+'） · '+total+' 项'+(total>rows.length?'，当前显示 '+rows.length+' 项':''))+'</p>';
 }
 const scale=n=>(n-min)/(max-min)*100;
 const bars=rows.map(r=>{const readout=r[label]+' · '+data.columns[value].label+' '+number(r[value])+' '+displayUnit+(detail?' · '+data.columns[detail].label+' '+measured(r[detail],data.columns[detail]).join(' '):'');return '<button class="report-bar-row" data-row="'+esc(r.id)+'" data-readout="'+esc(readout)+'" title="'+esc(readout)+'"><span class="report-bar-label">'+esc(r[label])+'</span><span class="report-bar-track"><i style="left:'+Math.min(scale(0),scale(r[value]))+'%;width:'+Math.max(.1,Math.abs(scale(r[value])-scale(0)))+'%;background:'+(spec.highlight?.includes(r[label])?VISUAL_TOKENS.warning:VISUAL_TOKENS.metric)+'"></i></span><b>'+esc(number(r[value]))+'</b>'+(detail?'<small>'+esc(fmt(r[detail]))+'</small>':'')+'</button>';}).join('');
 return '<div class="report-bars'+(detail?' has-detail':'')+'"><div class="report-bar-unit">'+esc(data.columns[value].label+'（'+displayUnit+'）')+(detail?' · '+esc(data.columns[detail].label):'')+'</div>'+bars+'</div><p class="chart-caption">'+esc('显示 '+rows.length+' / '+total+' 项'+(spec.sort==='descending'?'，按所选指标从大到小排列':''))+'</p>';
}
function histogram(data,spec){
 const key=spec.fields.value,values=data.rows.map(r=>r[key]).filter(known),bounds=spec.bins||[0,2000,5000,10000,20000,40000,80000,160000];
 if(!bounds.length||bounds.some((n,i)=>!known(n)||i&&n<=bounds[i-1]))throw Error('Histogram bins must increase');
 if(values.some(v=>v<bounds[0]))throw Error('Histogram bins must include all values');
 if(!values.length)return empty('未记录'+data.columns[key].label+'，保留其他可用证据');
 const bins=bounds.map((n,i)=>({id:'bin:'+i,from:n,to:bounds[i+1]??Infinity,count:values.filter(v=>v>=n&&v<(bounds[i+1]??Infinity)).length}));
 const max=Math.max(1,...bins.map(r=>r.count)),width=790/bins.length,bottom=218;
 let b='';for(let i=0;i<=3;i++){const n=Math.round(max*i/3),y=bottom-n/max*158;b+=rule(y)+tx(48,y+4,n,'plot-axis','end');}
 for(const [i,r]of bins.entries()){const x=73+i*width,h=r.count/max*158,label=(known(r.to)?fmt(r.from)+'–'+fmt(r.to):'≥'+fmt(r.from));b+='<g tabindex="0" class="plot-mark" data-readout="'+esc(label+' '+unit(data,key)+'：'+r.count+' 条记录')+'"><rect x="'+x+'" y="'+(bottom-h)+'" width="'+width*.66+'" height="'+Math.max(.7,h)+'" rx="2" fill="'+VISUAL_TOKENS.metric+'"/>'+tx(x+width*.33,bottom-h-8,r.count,'plot-label','middle')+tx(x+width*.33,246,label,'plot-axis','middle')+'</g>';}
 return svg(270,spec.title,b)+'<p class="chart-caption">'+esc(data.columns[key].label+'（'+unit(data,key)+'） · '+values.length+' 条记录，另有 '+(data.rows.length-values.length)+' 条未记录；保留全部尾部。')+'</p>';
}
function scatter(data,spec){
 const {x,y}=spec.fields,rows=data.rows.filter(r=>known(r[x])&&known(r[y]));
 if(!rows.length)return empty('当前来源没有可配对的这两项测量；保留原始记录，不补造坐标');
 const [xmin,xmax]=extent(rows.map(r=>r[x])),[ymin,ymax]=extent(rows.map(r=>r[y]));
 const px=n=>66+(n-xmin)/(xmax-xmin)*800,py=n=>224-(n-ymin)/(ymax-ymin)*170;
 let b='';for(let i=0;i<=4;i++){const yy=ymin+(ymax-ymin)*i/4,xx=xmin+(xmax-xmin)*i/4;b+=rule(py(yy))+tx(48,py(yy)+4,fmt(yy),'plot-axis','end')+tx(px(xx),250,fmt(xx),'plot-axis','middle');}
 for(const row of rows)b+=mark(data,row,'<circle class="mark-dot scatter-dot" cx="'+px(row[x]).toFixed(2)+'" cy="'+py(row[y]).toFixed(2)+'" r="2.5" fill="'+(spec.color&&known(row[spec.color.field])&&row[spec.color.field]<spec.color.threshold?VISUAL_TOKENS.warning:VISUAL_TOKENS.metric)+'" fill-opacity=".5"/>');
 return svg(280,spec.title,b+tx(66,25,data.columns[y].label+'（'+unit(data,y)+'）')+tx(866,278,data.columns[x].label+'（'+unit(data,x)+'）','plot-axis','end'));
}
function timeline(data,spec){
 const {start,end,label}=spec.fields,rows=data.rows.filter(r=>known(r[start])&&known(r[end])&&r[end]>=r[start]);
 if(!rows.length)return empty('该来源没有记录完整起止区间，不能画出实际等待位置');
 if(rows.length>50)throw Error('Narrow the timeline to at most 50 intervals');
 const origin=Math.min(...rows.map(r=>r[start])),last=Math.max(origin+1,...rows.map(r=>r[end])),px=n=>186+(n-origin)/(last-origin)*625;
 const events=rows.flatMap(r=>[[r[start],1],[r[end],-1]]).sort((a,b)=>a[0]-b[0]);
 let active=0,previous=origin,overlap=0;for(const [time,change] of events){if(active>=2)overlap+=time-previous;active+=change;previous=time;}
 let b=tx(186,20,'发起 ○ ───── ● 返回 · 同一时间刻度');for(let i=0;i<=4;i++){const x=186+i/4*625;b+='<path class="plot-grid" d="M'+x+' 32V'+(40+rows.length*48)+'"/>'+tx(x,70+rows.length*48,((last-origin)*i/4000).toFixed(1)+'s','plot-axis','middle');}
 rows.forEach((r,i)=>{const y=60+i*48;b+=mark(data,r,tx(0,y+4,r[label]+' · '+(i+1),'plot-label')+'<path d="M'+px(r[start])+' '+y+'H'+px(r[end])+'" stroke="'+VISUAL_TOKENS.metric+'" stroke-width="5"/><circle cx="'+px(r[start])+'" cy="'+y+'" r="4" fill="white" stroke="'+VISUAL_TOKENS.metric+'" stroke-width="2"/><circle cx="'+px(r[end])+'" cy="'+y+'" r="4" fill="'+VISUAL_TOKENS.metric+'"/>'+tx(px(r[end])+10,y+4,((r[end]-r[start])/1000).toFixed(2)+'s','plot-label'));});
 return '<div class="interval-summary"><span>首发至全部返回 <b>'+((last-origin)/1000).toFixed(2)+'s</b></span><span>至少两次调用同时进行 <b>'+(overlap/1000).toFixed(2)+'s</b></span></div>'+svg(100+rows.length*48,spec.title,b)+'<p class="chart-caption">横轴为相对首个开始记录的秒数。'+(data.rows.length-rows.length)+' 条缺起止位置的记录未放到时间轴上；这里仅展示工具区间。</p>';
}
function sequence(data,spec){
 if(!spec.nodes?.length)return empty('先选择有原文位置的行动与反馈');
 return '<div class="attempt-flow'+(spec.nodes.length>4?' is-vertical':'')+'" style="--attempt-columns:'+Math.min(4,spec.nodes.length)+'">'+spec.nodes.map(node=>{const row=data.rows.find(r=>r.id===node.row);return '<button class="attempt-node" data-row="'+esc(row.id)+'" data-readout="'+esc(row.text||describe(data,row))+'"><span class="attempt-turn">'+esc(row.turn==null?'原文位置':'第 '+row.turn+' 轮')+'</span><span class="attempt-dot" style="background:'+VISUAL_TOKENS.metric+'"></span><strong>'+esc(node.label)+'</strong><span class="attempt-detail">'+esc(node.detail||'')+'</span><small>'+esc(row.id)+'</small></button>';}).join('')+'</div>';
}
function context(data,spec){
 const xkey=spec.fields.x,series=spec.series||CONTEXT_SERIES.map(r=>r[0]).filter(k=>data.columns[k]);
 let rows=[...data.rows].filter(r=>known(r[xkey]));
 if(spec.sample==='last-per-turn')rows=[...new Map(rows.map(r=>[r.turn,r])).values()];
 rows.sort((a,b)=>a[xkey]-b[xkey]);
 if(!rows.length)return empty('该范围没有记录上下文构成');
 const totals=rows.map(r=>series.every(k=>known(r[k]))?series.reduce((n,k)=>n+r[k],0):null);
 const max=Math.max(1,...totals.filter(known)),first=rows[0][xkey],last=rows.at(-1)[xkey],px=n=>62+(n-first)/Math.max(1,last-first)*810,py=n=>228-n/max*168;
 const layers=spec.layers||['total'];
 let b='';for(let i=0;i<=3;i++){const n=max*i/3;b+=rule(py(n),62,872)+tx(48,py(n)+4,fmt(n),'plot-axis','end');}
 // Every missing selected category breaks the area. Never bridge a missing row
 // or turn a missing source value into zero.
 const segments=[];let segment=[];
 rows.forEach((row,i)=>{if(totals[i]===null){if(segment.length)segments.push(segment);segment=[];}else segment.push({row,i});});if(segment.length)segments.push(segment);
 for(const segment of segments){let lower=segment.map(()=>0);for(const key of series){const upper=segment.map(({row},i)=>lower[i]+row[key]);const line=values=>compactTrendPolyline(segment.map(({row},i)=>[px(row[xkey]),py(values[i])])).join('L');b+='<path d="M'+line(upper)+'L'+compactTrendPolyline(segment.map(({row},i)=>[px(row[xkey]),py(lower[i])]).reverse()).join('L')+'Z" fill="'+color(key)+'" opacity="'+VISUAL_TOKENS.opacity.area+'"/><path d="M'+line(upper)+'" fill="none" stroke="'+color(key)+'" stroke-width="1"/>';lower=upper;}}
 for(let i=0;i<=6;i++){const n=first+(last-first)*i/6;b+=tx(px(n),253,Math.round(n),'plot-axis','middle');}
 for(const a of spec.annotations||[]){const index=rows.findIndex(r=>r.id===a.row);if(index<0||totals[index]===null)continue;const row=rows[index],xx=px(row[xkey]),yy=py(totals[index]);b+='<circle class="context-pin" cx="'+xx+'" cy="'+yy+'" r="3"/>'+tx(xx+8,Math.max(22,yy-12),a.label+' '+fmt(totals[index]),'context-annotation');}
 rows.forEach((r,i)=>{b+=mark(data,r,'<rect class="context-hit" x="'+(px(r[xkey])-6)+'" y="42" width="12" height="190"/>');});
 const missing=totals.filter(n=>n===null).length;
 let delta='';
 if(layers.includes('delta')){
  const values=rows.map((row,i)=>i&&totals[i]!==null&&totals[i-1]!==null?series.map(k=>row[k]-rows[i-1][k]):null);
  const limit=Math.max(1,...values.filter(Boolean).map(parts=>Math.max(parts.reduce((n,v)=>n+Math.max(0,v),0),parts.reduce((n,v)=>n+Math.max(0,-v),0))));
  let d=rule(72,62,872)+tx(48,27,'+'+fmt(limit),'plot-axis','end')+tx(48,75,'0','plot-axis','end')+tx(48,124,'−'+fmt(limit),'plot-axis','end');
  values.forEach((parts,i)=>{if(!parts)return;let positive=0,negative=0;let body='';parts.forEach((v,j)=>{const size=Math.abs(v)/limit*45;if(!size)return;const yy=v>=0?72-positive-size:72+negative;if(v>=0)positive+=size;else negative+=size;body+='<rect x="'+(px(rows[i][xkey])-3)+'" y="'+yy+'" width="6" height="'+size+'" fill="'+color(series[j])+'" opacity="'+(v>=0?.72:.45)+'"/>';});d+=mark(data,rows[i],body);});
  delta='<div class="context-delta-label">与前一记录的来源增减 · 首条没有范围内前值</div>'+svg(144,'上下文增减',d);
 }
 const controls='<div class="report-context-controls"><div class="report-source-toggles">'+CONTEXT_SERIES.filter(([key])=>data.columns[key]).map(([key,label,c])=>'<button data-report-source="'+key+'" aria-pressed="'+series.includes(key)+'" style="--source-color:'+c+'"><i></i>'+label+'</button>').join('')+'</div><div class="report-layer-toggles">'+[['total','保留量'],['delta','增减']].map(([key,label])=>'<button data-report-layer="'+key+'" aria-pressed="'+layers.includes(key)+'">'+label+'</button>').join('')+'</div></div>';
 return controls+(layers.includes('total')?svg(275,spec.title,b):'')+delta+'<div class="legend">'+series.map(k=>'<span><i style="background:'+color(k)+'"></i>'+esc(data.columns[k].label)+'</span>').join('')+'</div>'+
  '<p class="chart-caption">'+esc('来源构成估算 · '+rows.length+' 个记录位置'+(missing?'，其中 '+missing+' 处缺值留空':'')+(data.coverage.context?.status==='partial'?'；来源记录从第 '+data.coverage.context.firstRecordedTurn+' 轮开始':'')+'。')+'</p>';
}
function donut(data,spec){
 const row=selectedRows(data,spec)[0],parts=compositionParts(data,spec,row),total=partsTotal(parts),estimated=data.columns[spec.series[0]].basis==='estimated',prefix=estimated?'≈':'';
 let angle=-Math.PI/2,body='<circle cx="165" cy="150" r="98" fill="none" stroke="#f1f1f1" stroke-width="36"/>';
 const point=a=>[165+98*Math.cos(a),150+98*Math.sin(a)];
 if(total>0)for(const part of parts){if(!part.value)continue;const from=angle;angle+=part.value/total*Math.PI*2;const a=point(from),b=point(angle),shape=part.value===total?'<circle cx="165" cy="150" r="98" fill="none" stroke="'+part.color+'" stroke-width="36"/>':'<path d="M'+a.join(' ')+'A98 98 0 '+(angle-from>Math.PI?1:0)+' 1 '+b.join(' ')+'" fill="none" stroke="'+part.color+'" stroke-width="36"/>';
  body+='<g class="plot-mark" tabindex="0" data-row="'+esc(row.id)+'" data-readout="'+esc(part.label+' · '+prefix+fmt(part.value)+' '+unit(data,part.key)+' · 占所选构成 '+percentage(part.value,total))+'"><title>'+esc(part.label+' '+percentage(part.value,total))+'</title>'+shape+'</g>';
 }
 body+=tx(165,145,total===null?'记录不完整':prefix+fmt(total),'composition-total','middle')+tx(165,169,unit(data,spec.series[0])+' · 所选构成合计','plot-axis','middle');
 const list=parts.map(part=>'<button class="composition-item" data-row="'+esc(row.id)+'" data-readout="'+esc((spec.rowLabels?.[0]||rowLabel(row))+' · '+part.label+' · '+prefix+fmt(part.value)+' '+unit(data,part.key)+(total!==null?' · '+percentage(part.value,total):' · 完整比例未知'))+'"><i style="background:'+part.color+'"></i><span>'+esc(part.label)+'</span><b>'+prefix+fmt(part.value)+'</b><small>'+esc(total!==null?percentage(part.value,total):'—')+'</small></button>').join('');
 return '<div class="report-donut"><svg viewBox="0 0 330 300" role="img" aria-label="'+esc(spec.title)+'">'+body+'</svg><div class="composition-list"><div class="composition-position">'+esc(spec.rowLabels?.[0]||rowLabel(row))+'</div>'+list+'</div></div>'+(total===null?'<p class="chart-caption">部分分项未记录，比例暂不显示。</p>':'');
}
function stacked(data,spec){
 const rows=selectedRows(data,spec),parts=rows.map(row=>compositionParts(data,spec,row)),totals=parts.map(partsTotal),max=Math.max(1,...totals.filter(known)),mode=spec.mode||'absolute',estimated=data.columns[spec.series[0]].basis==='estimated',prefix=estimated?'≈':'';
 const controls='<div class="report-composition-controls">'+[['absolute','数量'],['percent','比例']].map(([key,label])=>'<button data-report-mode="'+key+'" aria-pressed="'+(key===mode)+'">'+label+'</button>').join('')+'</div>';
 const body=rows.map((row,i)=>{const label=spec.rowLabels?.[i]||rowLabel(row),total=totals[i],scale=mode==='percent'?total:max;
  const segments=total===null?'':parts[i].filter(p=>p.value>0).map(part=>'<span class="stacked-segment" data-row="'+esc(row.id)+'" data-readout="'+esc(label+' · '+part.label+' · '+prefix+fmt(part.value)+' '+unit(data,part.key)+' · '+percentage(part.value,total))+'" tabindex="0" style="width:'+(part.value/scale*100)+'%;background:'+part.color+'"><span>'+(part.value/scale>.12?esc(mode==='percent'?percentage(part.value,total):fmt(part.value)):'')+'</span></span>').join('');
  return '<div class="stacked-position"><div class="stacked-row-head"><button data-row="'+esc(row.id)+'">'+esc(label)+'</button><span>'+prefix+fmt(total)+' '+esc(unit(data,spec.series[0]))+'</span></div><div class="stacked-track'+(total===null?' is-missing':'')+'">'+segments+(total===null?'<span>构成未完整记录</span>':'')+'</div></div>';
 }).join('');
 return controls+'<div class="report-stacked">'+body+'</div>'+compositionLegend(data,spec);
}
function comparison(data,spec){
 const [a,b]=selectedRows(data,spec),keys=spec.series,labels=spec.rowLabels||[rowLabel(a),rowLabel(b)],parts=[a,b].map(row=>compositionParts(data,spec,row)),totals=parts.map(partsTotal),delta=totals.every(known)?totals[1]-totals[0]:null;
 const estimated=data.columns[keys[0]].basis==='estimated',prefix=estimated?'≈':'',measure=unit(data,keys[0]),max=Math.max(1,...keys.flatMap(k=>[a[k],b[k]]).filter(known));
 const change=(before,after)=>{if(!known(before)||!known(after))return ['未记录',''];const d=after-before;return [(d>0?'+':d<0?'−':'')+fmt(Math.abs(d)),before===0?(d>0?'从零新增':'未变化'):(d===0?'未变化':(d>0?'增加 ':'减少 ')+percentage(Math.abs(d),before))];};
 const summary='<div class="comparison-summary">'+[a,b].map((row,i)=>'<button data-row="'+esc(row.id)+'"><span>'+esc(labels[i])+'</span><strong>'+prefix+fmt(totals[i])+'</strong><small>'+esc(measure)+'</small></button>').join('<span class="comparison-arrow">→</span>')+'<div><span>合计净变化</span><strong>'+(delta===null?'未记录':(delta>0?'+':delta<0?'−':'')+fmt(Math.abs(delta)))+'</strong><small>'+esc(measure)+' · '+esc(change(...totals)[1])+'</small></div></div>';
 const cell=(row,key)=>'<button class="comparison-measure" data-row="'+esc(row.id)+'" style="--measure-width:'+(known(row[key])?row[key]/max*100:0)+'%"><span>'+prefix+fmt(row[key])+'</span><i></i></button>';
 const body=keys.map((key,i)=>{const [amount,relative]=change(a[key],b[key]),readout=data.columns[key].label+' · '+labels[0]+' '+prefix+fmt(a[key])+' → '+labels[1]+' '+prefix+fmt(b[key])+' '+measure+' · 净变化 '+amount;
  return '<tr><th scope="row"><i class="composition-swatch" style="background:'+partColor(key,i)+'"></i>'+esc(data.columns[key].label)+'</th><td>'+cell(a,key)+'</td><td>'+cell(b,key)+'</td><td><button class="comparison-change" data-row="'+esc(b.id)+'" data-related-row="'+esc(a.id)+'" data-readout="'+esc(readout)+'"><b>'+esc(amount)+'</b><small>'+esc(relative)+'</small></button></td></tr>';
 }).join('');
 return summary+'<div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>来源 · '+esc(measure)+'</th><th>'+esc(labels[0])+'</th><th>'+esc(labels[1])+'</th><th>净变化 · '+esc(measure)+'</th></tr></thead><tbody>'+body+'</tbody></table></div>';
}
const renderers={metrics,bar,histogram,scatter,timeline,sequence,context,comparison,donut,stacked,assembly:renderAssembly};
export function renderFigure(spec,datasets){
 const {data}=bindFigure(spec,datasets),body=renderers[spec.type](data,spec);
 const readout=spec.readout||'点选图中记录，查看对应读数与证据位置。';
 const turns=data.source.query?.turns,scope=turns?'第 '+turns.from+'–'+turns.to+' 轮':'所选会话范围';
 const header=spec.type==='metrics'&&!spec.title?'':'<div class="figure-head"><strong>'+esc(spec.title||'')+'</strong><span>'+esc(spec.subtitle||scope)+'</span></div>';
 return '<figure class="report-figure" data-figure="'+esc(spec.id||spec.data)+'" data-dataset="'+esc(spec.data)+'">'+header+body+'<div class="figure-readout">'+esc(readout)+'</div>'+(spec.note?'<figcaption class="chart-caption">'+esc(spec.note)+'</figcaption>':'')+'</figure>';
}
