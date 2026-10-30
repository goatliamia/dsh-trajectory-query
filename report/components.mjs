import { bindFigure, groupSum } from './contract.mjs';
import { compactTrendPolyline } from '../lib/context-trend-geometry.mjs';

export const CONTEXT_SERIES = [
  ['system','系统提示','#8053e3'],['tools','工具定义','#d49b00'],['user','用户消息','#44a56b'],
  ['inject','补充内容','#c442a7'],['skill','技能内容','#e66d26'],['assistant','助手消息','#5b9fe8'],['tool','工具结果','#3ab4a4'],
];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'未记录':Math.abs(n)>=1e6?(n/1e6).toFixed(2)+'M':Math.abs(n)>=1000?(n/1000).toFixed(1)+'k':Number(n.toFixed(2)).toString();
const tx=(x,y,v,cl='plot-axis',anchor='start')=>'<text class="'+cl+'" x="'+x+'" y="'+y+'" text-anchor="'+anchor+'">'+esc(v)+'</text>';
const svg=(h,title,body)=>'<svg viewBox="0 0 940 '+h+'" role="img" aria-label="'+esc(title)+'">'+body+'</svg>';
const rule=(y,left=66,right=868)=>'<path class="plot-grid" d="M'+left+' '+y+'H'+right+'"/>';
const known=n=>typeof n==='number'&&Number.isFinite(n);
const extent=values=>{const valid=values.filter(known);return valid.length?[Math.min(0,...valid),Math.max(1,...valid)]:[0,1];};
const color=key=>CONTEXT_SERIES.find(c=>c[0]===key)?.[2]||'#5b9fe8';
const describe=(data,row)=>Object.keys(data.columns).filter(key=>row[key]!=null&&data.columns[key].unit!=='timestamp-ms').map(key=>data.columns[key].label+' '+(typeof row[key]==='number'?fmt(row[key]):row[key])).join(' · ');
function mark(data,row,body){const title=Object.keys(data.columns).filter(key=>row[key]!=null&&data.columns[key].unit!=='timestamp-ms').slice(0,4).map(key=>data.columns[key].label+' '+(typeof row[key]==='number'?fmt(row[key]):row[key])).join(' · ');return '<g class="plot-mark" tabindex="0" data-row="'+esc(row.id)+'"><title>'+esc(title)+'</title>'+body+'</g>';}
function unit(data,key){const u=data.columns[key].unit;return u==='timestamp-ms'?'秒':u;}
function empty(message){return '<p class="report-data-unavailable">'+esc(message)+'</p>';}

function bar(data,spec){
 const {label,value,detail}=spec.fields;
 if(spec.groupBy)data=groupSum(data,spec.groupBy,value);
 let rows=data.rows.filter(r=>known(r[value]));
 if(spec.sort==='descending')rows=[...rows].sort((a,b)=>b[value]-a[value]);
 const total=rows.length;rows=rows.slice(0,spec.limit||200);
 if(!rows.length)return empty('这个范围没有已记录的'+data.columns[value].label);
 const [min,max]=extent(rows.map(r=>r[value]));
 if(spec.orientation==='vertical'){
  const base=224,scale=n=>base-(n-min)/(max-min)*166,w=790/rows.length;
  let b='';for(let i=0;i<=3;i++){const v=min+(max-min)*i/3;b+=rule(scale(v))+tx(48,scale(v)+4,fmt(v),'plot-axis','end');}
  rows.forEach((r,i)=>{const x=70+i*w;b+=mark(data,r,'<rect x="'+x+'" y="'+Math.min(scale(r[value]),scale(0))+'" width="'+Math.max(1,w*.72)+'" height="'+Math.max(.6,Math.abs(scale(r[value])-scale(0)))+'" fill="'+(spec.highlight?.includes(r[label])?'#a66b00':'#5b9fe8')+'" opacity=".75"/>');if(rows.length<15||i%Math.max(1,Math.floor(rows.length/6))===0)b+=tx(x+w/3,249,r[label],'plot-axis','middle');});
  return svg(270,spec.title,b)+ '<p class="chart-caption">'+esc(data.columns[value].label+'（'+unit(data,value)+'） · '+total+' 项'+(total>rows.length?'，当前显示 '+rows.length+' 项':''))+'</p>';
 }
 let b=tx(166,23,data.columns[value].label+'（'+unit(data,value)+'）');
 if(detail)b+=tx(900,23,data.columns[detail].label,'plot-axis','end');
 const width=540,scale=n=>166+(n-min)/(max-min)*width;
 rows.forEach((r,i)=>{const y=55+i*39;b+=mark(data,r,tx(0,y+4,r[label],'plot-label')+'<rect x="'+Math.min(scale(0),scale(r[value]))+'" y="'+(y-8)+'" width="'+Math.max(.5,Math.abs(scale(r[value])-scale(0)))+'" height="16" rx="2" fill="#3ab4a4" opacity=".72"/>'+tx(scale(r[value])+10,y+4,fmt(r[value]),'plot-label')+(detail?tx(900,y+4,fmt(r[detail]),'plot-label','end'):''));});
 return svg(85+rows.length*39,spec.title,b)+'<p class="chart-caption">'+esc('显示 '+rows.length+' / '+total+' 项'+(spec.sort==='descending'?'，按所选指标从大到小排列':''))+'</p>';
}
function histogram(data,spec){
 const key=spec.fields.value,values=data.rows.map(r=>r[key]).filter(known),bounds=spec.bins||[0,2000,5000,10000,20000,40000,80000,160000];
 if(!bounds.length||bounds.some((n,i)=>!known(n)||i&&n<=bounds[i-1]))throw Error('Histogram bins must increase');
 if(values.some(v=>v<bounds[0]))throw Error('Histogram bins must include all values');
 if(!values.length)return empty('未记录'+data.columns[key].label+'，保留其他可用证据');
 const bins=bounds.map((n,i)=>({id:'bin:'+i,from:n,to:bounds[i+1]??Infinity,count:values.filter(v=>v>=n&&v<(bounds[i+1]??Infinity)).length}));
 const max=Math.max(1,...bins.map(r=>r.count)),width=790/bins.length,bottom=218;
 let b='';for(let i=0;i<=3;i++){const n=Math.round(max*i/3),y=bottom-n/max*158;b+=rule(y)+tx(48,y+4,n,'plot-axis','end');}
 for(const [i,r]of bins.entries()){const x=73+i*width,h=r.count/max*158,label=(known(r.to)?fmt(r.from)+'–'+fmt(r.to):'≥'+fmt(r.from));b+='<g tabindex="0" class="plot-mark" data-readout="'+esc(label+' '+unit(data,key)+'：'+r.count+' 条记录')+'"><rect x="'+x+'" y="'+(bottom-h)+'" width="'+width*.66+'" height="'+Math.max(.7,h)+'" rx="2" fill="#5b9fe8"/>'+tx(x+width*.33,bottom-h-8,r.count,'plot-label','middle')+tx(x+width*.33,246,label,'plot-axis','middle')+'</g>';}
 return svg(270,spec.title,b)+'<p class="chart-caption">'+esc(data.columns[key].label+'（'+unit(data,key)+'） · '+values.length+' 条记录，另有 '+(data.rows.length-values.length)+' 条未记录；保留全部尾部。')+'</p>';
}
function scatter(data,spec){
 const {x,y}=spec.fields,rows=data.rows.filter(r=>known(r[x])&&known(r[y]));
 if(!rows.length)return empty('当前来源没有可配对的这两项测量；保留原始记录，不补造坐标');
 const [xmin,xmax]=extent(rows.map(r=>r[x])),[ymin,ymax]=extent(rows.map(r=>r[y]));
 const px=n=>66+(n-xmin)/(xmax-xmin)*800,py=n=>224-(n-ymin)/(ymax-ymin)*170;
 let b='';for(let i=0;i<=4;i++){const yy=ymin+(ymax-ymin)*i/4,xx=xmin+(xmax-xmin)*i/4;b+=rule(py(yy))+tx(48,py(yy)+4,fmt(yy),'plot-axis','end')+tx(px(xx),250,fmt(xx),'plot-axis','middle');}
 for(const row of rows)b+=mark(data,row,'<circle class="mark-dot scatter-dot" cx="'+px(row[x]).toFixed(2)+'" cy="'+py(row[y]).toFixed(2)+'" r="2.5" fill="'+(spec.color&&known(row[spec.color.field])&&row[spec.color.field]<spec.color.threshold?'#a66b00':'#5b9fe8')+'" fill-opacity=".5"/>');
 return svg(280,spec.title,b+tx(66,25,data.columns[y].label+'（'+unit(data,y)+'）')+tx(866,278,data.columns[x].label+'（'+unit(data,x)+'）','plot-axis','end'));
}
function timeline(data,spec){
 const {start,end,label}=spec.fields,rows=data.rows.filter(r=>known(r[start])&&known(r[end])&&r[end]>=r[start]);
 if(!rows.length)return empty('该来源没有记录完整起止区间，不能画出实际等待位置');
 if(rows.length>50)throw Error('Narrow the timeline to at most 50 intervals');
 const origin=Math.min(...rows.map(r=>r[start])),last=Math.max(origin+1,...rows.map(r=>r[end])),px=n=>186+(n-origin)/(last-origin)*625;
 let b='';for(let i=0;i<=4;i++){const x=186+i/4*625;b+='<path class="plot-grid" d="M'+x+' 32V'+(40+rows.length*48)+'"/>'+tx(x,70+rows.length*48,((last-origin)*i/4000).toFixed(1),'plot-axis','middle');}
 rows.forEach((r,i)=>{const y=60+i*48;b+=mark(data,r,tx(0,y+4,r[label],'plot-label')+'<rect x="'+px(r[start])+'" y="'+(y-9)+'" height="18" width="'+Math.max(1,px(r[end])-px(r[start]))+'" rx="3" fill="#3ab4a4"/>'+tx(px(r[end])+10,y+4,((r[end]-r[start])/1000).toFixed(2)+'s','plot-label'));});
 return svg(100+rows.length*48,spec.title,b)+'<p class="chart-caption">横轴为相对首个开始记录的秒数；'+(data.rows.length-rows.length)+' 条缺起止位置的记录未放到时间轴上。</p>';
}
function sequence(data,spec){
 if(!spec.nodes?.length)return empty('先选择有原文位置的行动与反馈');
 return '<div class="attempt-flow">'+spec.nodes.map((node,i)=>{const row=data.rows.find(r=>r.id===node.row);return '<button class="attempt-node" data-row="'+esc(row.id)+'" data-readout="'+esc(row.text||describe(data,row))+'"><span class="attempt-turn">'+esc(row.turn==null?'原文位置':'第 '+row.turn+' 轮')+'</span><span class="attempt-dot" style="background:'+(i===spec.nodes.length-1?'#087f5b':'#737373')+'"></span><strong>'+esc(node.label)+'</strong><span class="attempt-detail">'+esc(node.detail||'')+'</span><small>'+esc(row.id)+'</small></button>';}).join('')+'</div>';
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
 for(const segment of segments){let lower=segment.map(()=>0);for(const key of series){const upper=segment.map(({row},i)=>lower[i]+row[key]);const line=values=>compactTrendPolyline(segment.map(({row},i)=>[px(row[xkey]),py(values[i])])).join('L');b+='<path d="M'+line(upper)+'L'+compactTrendPolyline(segment.map(({row},i)=>[px(row[xkey]),py(lower[i])]).reverse()).join('L')+'Z" fill="'+color(key)+'" opacity=".27"/><path d="M'+line(upper)+'" fill="none" stroke="'+color(key)+'" stroke-width="1"/>';lower=upper;}}
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
function comparison(data,spec){
 const [a,b]=spec.rows.map(id=>data.rows.find(row=>row.id===id)),keys=spec.series,max=Math.max(1,...keys.flatMap(k=>[a[k],b[k]]).filter(known)),px=n=>164+n/max*550;
 let body='';for(let i=0;i<=4;i++){const xx=164+i/4*550;body+='<path class="plot-grid" d="M'+xx+' 32V'+(keys.length*39+30)+'"/>'+tx(xx,keys.length*39+56,fmt(max*i/4),'plot-axis','middle');}
 keys.forEach((key,i)=>{const y=54+i*39;if(!known(a[key])||!known(b[key])){body+=tx(0,y+4,data.columns[key].label,'plot-label')+tx(890,y+4,'未记录','plot-axis','end');return;}const delta=b[key]-a[key];body+=mark(data,b,tx(0,y+4,data.columns[key].label,'plot-label')+'<path d="M'+px(a[key])+' '+y+'H'+px(b[key])+'" stroke="#d4d4d4" stroke-width="4"/><circle cx="'+px(a[key])+'" cy="'+y+'" r="5" fill="#fff" stroke="#737373"/><circle cx="'+px(b[key])+'" cy="'+y+'" r="4" fill="'+color(key)+'"/>'+tx(890,y+4,(delta>0?'+':'')+fmt(delta),'plot-label','end'));});
 return svg(keys.length*39+80,spec.title,body);
}
const renderers={bar,histogram,scatter,timeline,sequence,context,comparison};
export function renderFigure(spec,datasets){
 const {data}=bindFigure(spec,datasets),body=renderers[spec.type](data,spec);
 const readout=spec.readout||'点选图中记录，查看对应读数与证据位置。';
 const turns=data.source.query?.turns,scope=turns?'第 '+turns.from+'–'+turns.to+' 轮':'所选会话范围';
 return '<figure class="report-figure" data-figure="'+esc(spec.id||spec.data)+'" data-dataset="'+esc(spec.data)+'"><div class="figure-head"><strong>'+esc(spec.title||'')+'</strong><span>'+esc(spec.subtitle||scope)+'</span></div>'+body+'<div class="figure-readout">'+esc(readout)+'</div>'+(spec.note?'<figcaption class="chart-caption">'+esc(spec.note)+'</figcaption>':'')+'</figure>';
}
