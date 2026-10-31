import { validateDataset } from './contract.mjs';
import { validateAssemblyData } from './assembly-model.mjs';

// Host adapter. Snapshots come from buildInjectionIndex / SurfaceManager, never
// from proportional token totals or a filtered final conversation snapshot.
export function assemblyFromContextSnapshots(snapshots, { source, id = 'context-assembly' }) {
  const blocks = {}, rows = [];
  for (const snapshot of snapshots) {
    if (snapshot.cut?.session !== source.session || !Number.isSafeInteger(snapshot.cut.asOfSeq)) throw Error('Assembly source cut mismatch');
    const structure = snapshot.structure || {}, system = [], history = [], tools = [];
    for (const slot of snapshot.injections.slots) {
      const key = 'surface:' + slot.seq;
      const block = { category: slot.category || slot.role, label: slot.role + ' · seq ' + slot.seq, turn: slot.turn ?? null, step: slot.step ?? null,
        categoryBasis: slot.categoryBasis, evidence: [{session:source.session,log:source.log,seq:slot.seq}] };
      if (blocks[key] && JSON.stringify(blocks[key]) !== JSON.stringify(block)) throw Error('Fragment metadata changed under the same identity');
      blocks[key] = block;
      (slot.seq === structure.headSystemSeq ? system : history).push(key);
    }
    if (structure.toolsKey && structure.headerSeq != null) {
      // Identical declarations keep their identity even when header seq changes.
      const key = 'tools:' + structure.toolsKey;
      blocks[key] ||= { category:'tools',label:structure.toolCount+' 项工具声明',turn:null,categoryBasis:'recorded-header',
        evidence:[{session:source.session,log:source.log,seq:structure.headerSeq}] };
      tools.push(key);
    }
    rows.push({id:'assembly:'+snapshot.cut.asOfSeq,asOfSeq:snapshot.cut.asOfSeq,turn:snapshot.position?.turn??null,step:snapshot.position?.step??null,
      label:snapshot.label||(snapshot.position?.turn!=null?'第 '+snapshot.position.turn+' 轮'+(snapshot.position.step!=null?' · 第 '+snapshot.position.step+' 步':''):'事件 seq '+snapshot.cut.asOfSeq),system,tools,history,
      evidence:[{session:source.session,log:source.log,seq:snapshot.cut.asOfSeq}]});
  }
  const data={schema:'trajectory-data/1',id,kind:'context-assembly',source,blocks,rows,
    columns:{turn:{label:'轮次',unit:'turn',basis:'identifier'},step:{label:'步骤',unit:'step',basis:'identifier'},asOfSeq:{label:'事件切点',unit:'identifier',basis:'identifier'},label:{label:'记录位置',unit:'text',basis:'observed'}},
    coverage:{structure:'Recorded logical message order; fragment size does not encode tokens, time or cache hits.',snapshots:'Selected cuts only; transitions do not reconstruct unobserved intermediate events.'}};
  return validateAssemblyData(validateDataset(data));
}
