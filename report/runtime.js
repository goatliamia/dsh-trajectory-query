(() => {
  const value=JSON.parse(document.getElementById('report-bindings').textContent),datasets=value.datasets;
  const specs=new Map(value.figures.map(spec=>[spec.id,structuredClone(spec)]));
  const bind=figure=>{
    const spec=specs.get(figure.dataset.figure),data=datasets[spec.data],readout=figure.querySelector('.figure-readout'),byId=new Map(data.rows.map(row=>[row.id,row]));
    const select=mark=>{
      for(const el of figure.querySelectorAll('.is-active'))el.classList.remove('is-active');mark.classList.add('is-active');
      const row=byId.get(mark.dataset.row);
      readout.textContent=mark.dataset.readout||(row&&(row.text||describe(data,row)))||'';
      if(row){const related=byId.get(mark.dataset.relatedRow),rows=related?[related,row]:[row],panel=figure.querySelector('.report-record');panel.hidden=false;panel.querySelector('pre').textContent=JSON.stringify({source:data.source,values:related?rows:row,evidence:rows.flatMap(item=>(item.evidence||[]).map(ref=>ref.read||{tool:'trajectory_read',args:{session:ref.session,snapshot:data.source.snapshot,seq:ref.seq,format:'linked'}}))},null,2);}
    };
    const find=event=>{const mark=event.target.closest('[data-row],[data-readout]');return mark&&figure.contains(mark)?mark:null;};
    const preview=mark=>{const row=byId.get(mark.dataset.row);return mark.dataset.readout||(row&&(row.text||describe(data,row)))||'';};
    figure.onpointerover=event=>{const mark=find(event);if(mark)readout.textContent=preview(mark);};
    figure.onfocusin=event=>{const mark=find(event);if(mark)readout.textContent=preview(mark);};
    figure.onclick=event=>{const mark=find(event);if(mark)select(mark);};
    figure.onkeydown=event=>{if(!['Enter',' '].includes(event.key)||event.target.tagName==='BUTTON')return;const mark=find(event);if(mark){event.preventDefault();select(mark);}};
    const panel=document.createElement('details');panel.className='report-record';panel.hidden=true;panel.innerHTML='<summary>所选记录 · 数据与来源</summary><p>这里保存导出时的记录与取证参数；重新读取原文时需核对日志版本。</p><pre></pre>';figure.append(panel);
    if(spec.type==='assembly')mountAssembly(figure.querySelector('[data-context-assembly]'),data,spec,{onSelect(selection){
      readout.textContent=assemblyFrameLabel(selection.frame)+' · 选中 '+selection.blocks.length+' 个片段';panel.hidden=false;
      panel.querySelector('pre').textContent=JSON.stringify({source:data.source,position:selection.frame.id,blocks:selection.blocks,evidence:selection.evidence.map(ref=>ref.read||{tool:'trajectory_read',args:{session:ref.session,snapshot:data.source.snapshot,seq:ref.seq,format:'linked'}})},null,2);
    }});
    const rerender=()=>{const template=document.createElement('template');template.innerHTML=renderFigure(spec,datasets);const replacement=template.content.firstElementChild;figure.replaceWith(replacement);bind(replacement);};
    for(const button of figure.querySelectorAll('[data-report-source]'))button.onclick=()=>{const keys=new Set(spec.series||CONTEXT_SERIES.map(row=>row[0]).filter(k=>data.columns[k]));const key=button.dataset.reportSource;keys.has(key)?keys.delete(key):keys.add(key);spec.series=[...keys];rerender();};
    for(const button of figure.querySelectorAll('[data-report-layer]'))button.onclick=()=>{const keys=new Set(spec.layers||['total']);const key=button.dataset.reportLayer;keys.has(key)?keys.delete(key):keys.add(key);spec.layers=[...keys];rerender();};
    for(const button of figure.querySelectorAll('[data-report-mode]'))button.onclick=()=>{spec.mode=button.dataset.reportMode;rerender();};
  };
  document.querySelectorAll('[data-figure]').forEach(bind);
})();
