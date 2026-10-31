// Explicitly fictional fixture. The component contains no scripted turn number.
export function assemblyConcept(){
  const source={host:'concept',session:'assembly-concept',snapshot:'twelve-turns-v2',log:'fictional-sequence',cut:12};
  const blocks={system:{category:'system',label:'系统基线',evidence:[]},tools:{category:'tools',label:'工具声明基线',evidence:[]}};
  const rows=[{id:'concept:0',asOfSeq:0,turn:0,step:null,label:'准备装配 · 系统与工具基线',system:['system'],tools:['tools'],history:[],evidence:[]}];
  let history=[];
  for(let turn=1;turn<=12;turn++){
    if(turn===7){const key='turn:3:tool:revised';blocks[key]={category:'tool',turn:3,label:'第 7 轮改写了较早的工具结果',evidence:[]};history=history.map(id=>id==='turn:3:tool'?key:id);}
    const categories=turn===3?['user','skill','assistant','tool','assistant']:turn===9?['inject','user','assistant','tool','assistant']:['user','assistant','tool','assistant'];
    const seen={};for(const category of categories){const n=seen[category]||0;seen[category]=n+1;const id='turn:'+turn+':'+category+(n?':'+n:'');blocks[id]={category,turn,label:'第 '+turn+' 轮 · '+category,categoryBasis:'concept',evidence:[]};history.push(id);}
    rows.push({id:'concept:'+turn,asOfSeq:turn,turn,step:null,label:'第 '+String(turn).padStart(2,'0')+' 轮'+(turn===7?' · 一处历史改写':''),system:['system'],tools:['tools'],history:[...history],evidence:[]});
  }
  return {schema:'trajectory-data/1',id:'assembly-concept',kind:'context-assembly',source,blocks,rows,
    columns:{turn:{label:'演示轮次',unit:'turn',basis:'identifier'},asOfSeq:{label:'演示位置',unit:'identifier',basis:'identifier'}},coverage:{synthetic:true}};
}
