// Trajectory Tree visual source of truth. Source colors match the final Geist
// render layer of the existing path view, not its pre-theme model defaults.
export const CONTEXT_SERIES = [
  ['system','系统提示','#8053e3'],['tools','工具定义','#d49b00'],['user','用户消息','#44a56b'],
  ['inject','补充内容','#c442a7'],['skill','技能内容','#e66d26'],['assistant','助手消息','#5b9fe8'],['tool','工具结果','#3ab4a4'],
];
export const VISUAL_TOKENS = {
  surface:'#ffffff',canvas:'#fafafa',ink:'#171717',muted:'#666666',line:'#e6e6e6',grid:'#ededed',soft:'#f5f5f5',
  action:'#0068d6',metric:'#3485ed',success:'#087b58',error:'#c72b31',warning:'#b87800',retry:'#8745d9',changePulse:'#c72b31',
  request:{uncachedInputTokens:'#f59a36',cacheReadTokens:'#3485ed',cacheWriteTokens:'#9561dd',outputTokens:'#1aaa91'},
  font:{sans:"Geist,'Segoe UI','Microsoft YaHei',sans-serif",mono:"GeistMono,'Geist Mono',Consolas,'Microsoft YaHei',monospace"},
  type:{body:14,label:12,meta:11,section:18,title:28,metric:28},
  space:[4,8,12,16,24,32,40],radius:{control:6,popover:12},
  opacity:{source:1,area:.22,inactive:.18},motion:{feedback:140,mark:550,fracture:650,insert:850,hold:1000},
};

export function visualTokenCss({legacyAliases=false}={}){
  const t=VISUAL_TOKENS,vars=[];
  for(const key of ['surface','canvas','ink','muted','line','grid','soft','action','metric','success','error','warning','retry','changePulse'])vars.push('--tt-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+t[key]);
  for(const [key,,color]of CONTEXT_SERIES)vars.push('--tt-context-'+key+':'+color);
  for(const [key,color]of Object.entries(t.request))vars.push('--tt-request-'+key+':'+color);
  vars.push('--tt-font-sans:'+t.font.sans,'--tt-font-mono:'+t.font.mono);
  for(const [key,value]of Object.entries(t.type))vars.push('--tt-type-'+key+':'+value+'px');
  for(const value of t.space)vars.push('--tt-space-'+value+':'+value+'px');
  for(const [key,value]of Object.entries(t.radius))vars.push('--tt-radius-'+key+':'+value+'px');
  for(const [key,value]of Object.entries(t.opacity))vars.push('--tt-opacity-'+key+':'+value);
  for(const [key,value]of Object.entries(t.motion))vars.push('--tt-motion-'+key+':'+value+'ms');
  if(legacyAliases){
    for(const [key,,color]of CONTEXT_SERIES)vars.push('--chart-'+key+':'+color);
    for(const [alias,key]of Object.entries({surface:'surface',ink:'ink',muted:'muted',line:'line',grid:'grid',soft:'soft',accent:'action',sans:'font-sans',mono:'font-mono'}))vars.push('--'+alias+':var(--tt-'+key+')');
  }
  return ':root{'+vars.join(';')+'}\n';
}
