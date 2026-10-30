import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element() {
  const attrs = new Map(), classes = new Set(), segments = [new Map()];
  const e = { attrs, classes, segments, halo: null, classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    querySelector: selector => selector === '.review-action-halo' ? e.halo : {},
    querySelectorAll: () => segments.map(map => ({ setAttribute: (k, v) => map.set(k, v) })),
    insertBefore: node => { e.halo = node; node.remove = () => { e.halo = null; }; },
  };
  return e;
}
const nodes = [element(), element()], turn = { number: 7, steps: [{number:1}, {number:2}] };
nodes[0].classes.add('is-selected'); nodes[0].halo = { remove() { nodes[0].halo = null; } };
let renders = 0, summaries = [], timing = [], focus = 0;
const state = vm.createContext({
  view:'path', zoom:null, selectedStep:0, selectStep:null, reviewActionFileFrame: {t:turn,x:i=>100+i*128,base:208},
  turn: () => turn, $: () => ({querySelector: s => nodes[Number(/data-step="(\d+)"/.exec(s)?.[1])]}),
  document:{createElementNS:()=>element()},
  reviewRenderStepSummary: (t,s) => summaries.push(s.number), geistUpdateStepTiming:t=>timing.push(t.number),
  reviewApplyFileFocus:()=>focus++, geistBindSkillMaterials:()=>{},
});
vm.runInContext(readFileSync(new URL('action-view.js',import.meta.url),'utf8'), state);
state.renderActionPath = () => renders++;
state.reviewRenderStepSummary = (t,s) => summaries.push(s.number);
state.selectStep(1);
assert.equal(renders,0,'ordinary selection retains the graph');
assert.equal(state.selectedStep,1); assert.equal(nodes[0].halo,null);
assert.ok(!nodes[0].classes.has('is-selected')); assert.ok(nodes[1].classes.has('is-selected'));
assert.equal(nodes[1].attrs.get('aria-pressed'),'true');
assert.equal(nodes[1].halo.attrs.get('cx'),'228');
assert.equal(nodes[0].segments[0].get('opacity'),'.46'); assert.equal(nodes[1].segments[0].get('opacity'),'.65');
assert.deepEqual(summaries,[2]); assert.deepEqual(timing,[7]); assert.equal(focus,1);
const keptHalo = nodes[1].halo; state.selectStep(1); assert.equal(nodes[1].halo,keptHalo,'same selection does not add a halo');
state.selectStep(0); assert.ok(nodes[0].halo); assert.equal(nodes[1].halo,null); assert.equal(renders,0);
state.reviewActionFileFrame = {t:{},x:i=>i,base:208}; state.selectStep(1); assert.equal(renders,1,'different turn geometry falls back');
state.reviewActionFileFrame.t = turn; state.zoom = {}; state.selectStep(0); assert.equal(renders,2,'technical zoom keeps its full render path');
console.log('Selection: retained graph, halo/opacity/ARIA, details, timing and file focus match; stale geometry falls back.');

// Actor overlays use the viewport already measured by the base renderer; reads
// after SVG writes would synchronously lay out the whole long conversation.
const actors = readFileSync(new URL('geist-actors.js',import.meta.url),'utf8');
const actorContext = actors.slice(actors.indexOf('  function geistActorContext()'), actors.indexOf('  function geistPlanAgentForks()'));
const coordinates = vm.createContext({ view:'overview', overviewProjection: {gutter:54,visibleLeft:154,visibleRight:646,mainY:200,layout:[{end:900}],mapTime:t=>t*2},
  $:id=> { assert.equal(id,'graph','do not query viewport geometry after SVG writes'); return {getAttribute:()=> '0 0 1200 360'}; },
  reviewActionFileFrame:{t:{number:7,steps:[{number:1},{number:2}]},x:i=>i*128,base:208,viewportLeft:50,viewportWidth:600},
});
vm.runInContext(actorContext+'\nvar actual = geistActorContext();', coordinates);
assert.equal(coordinates.actual.width,954); assert.equal(coordinates.actual.left,154); assert.equal(coordinates.actual.right,646);
coordinates.view='path'; vm.runInContext('actual = geistActorContext();',coordinates);
assert.equal(coordinates.actual.left,104); assert.equal(coordinates.actual.right,596); assert.equal(coordinates.actual.map({step:2}),128);
let cleared = 0;
const idleScope = vm.createContext({ data:{context:{skillAnalysis:{records:[]}}}, geistSkillSelected:null, geistActorLayers:{skills:true},
  geistActorControls(){}, geistOpenSkillEvidence(){}, geistRenderSkillTouches(){}, geistRenderActors(){}, reviewFilesBind(){},
  geistActorContext(){throw Error('unselected Skill must not request a frame');},
  $:()=>({querySelector:()=>null,querySelectorAll:selector=>{assert.equal(selector,'.skill-scope-outside');return [{classList:{remove:()=>cleared++}}];}}),
});
vm.runInContext(readFileSync(new URL('geist-skill-evidence.js',import.meta.url),'utf8')+'\ngeistPaintSkillScope();', idleScope);
assert.equal(cleared,1,'clear previous scope marks without re-measuring or walking all turns');
console.log('Overlays: cached viewport coordinates and idle Skill cleanup avoid layout reads.');
