import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actorRecords, skillObjects, agentExtent, visibleAgentBranches, skillUseEvents, layoutAgentForks, agentShowsResults, actorTimePosition } from './actor-model.mjs';
import { layoutBranches } from './branch-layout.mjs';
import { toolResultLabel } from './tool-result-model.mjs';
const records = actorRecords({ mainSession: 'x', sessions: [{ id: 'x', turns: [{ number: 2, id: 'turn-2', start: 100, steps: [{ number: 3, seq: 10, start: 120 }] }] }], context: {
  skillEvents: [{ kind: 'catalog', time: 100, entries: [{ name: 'A' }, { name: 'B' }] }, { kind: 'skill-file-read', path: '/skills/A/SKILL.md', seq: 10, turn: 2, step: 3 }],
  collaborationEvents: [{ tool: 'spawn_agent', taskName: 'inspect', taskPath: '/root/inspect', turnId: 'turn-2', start: 125, end: 126 }, { tool: 'send_message', taskName: 'inspect', turnId: 'turn-2', start: 150 }],
} });
assert.equal(records.skills[1].time, 120);
const objects = skillObjects(records.skills);
assert.equal(objects.find(s => s.name === 'A').events.length, 2);
assert.equal(objects.find(s => s.name === 'B').events[0].kind, 'catalog');
assert.equal(records.branches[0].turn, 2);
assert.equal(records.branches[0].end, null, 'spawn call completion is not child completion');
assert.equal(agentExtent(records.branches[0]).hasEnd, false);
const all = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));
const visible = visibleAgentBranches(all, '9');
assert.equal(visible.rows.length, 3); assert.equal(visible.hidden, 9); assert.ok(visible.rows.some(b => b.id === '9'));
const real = JSON.parse(readFileSync('.dsh/layout-review/actor-data.json', 'utf8'));
assert.equal(real.agentBranches[0].steps.length, 49);
assert.ok(real.agentBranches[0].returnTime >= real.agentBranches[0].end);
assert.equal(real.skillEvents.filter(e => e.kind === 'skill-tool-load').length, 3, 'native skill tool responses are actual loads without a separate file read');
assert.deepEqual(real.skillEvents.filter(e => e.kind === 'skill-tool-load').map(e => e.name), ['plugin-compat', 'agent-experience', 'dsh-client-ui-ux']);
assert.equal(skillUseEvents(objects.find(s => s.name === 'B')).length, 0);
assert.equal(skillUseEvents({ events: [{ kind: 'catalog' }, { kind: 'skill-file-read', status: 'error' }, { kind: 'skill-file-read', status: 'unknown' }, { kind: 'explicit-skill-reference' }] }).length, 1);
assert.ok(real.agentBranches[0].results.some(r => r.kind === 'read'));
assert.ok(real.agentBranches[0].results.some(r => r.kind === 'change'));
assert.ok(real.agentBranches[0].results.some(r => r.kind === 'incident'));
for (const count of [1, 5, 30]) {
  const items = Array.from({ length: count }, (_, i) => ({ branch: { id: String(i) }, x: 60 + i * 12, end: 80 + i * 12 }));
  const packed = layoutAgentForks(items, { left: 20, right: 850, measure: s => s.length * 7, labelOf: m => m.length === 1 ? '子任务' : m.length + ' 个子任务' });
  assert.deepEqual(packed.flatMap(p => p.members.map(m => m.branch.id)).sort(), items.map(i => i.branch.id).sort(), 'aggregation must retain every child');
  for (let i = 0; i < packed.length; i++) for (let j = i + 1; j < packed.length; j++) {
    const a = packed[i], b = packed[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  }
}
const branch = real.agentBranches[0], start = branch.start, span = agentExtent(branch).end - start;
assert.equal(agentShowsResults(branch, 50), false);
assert.equal(agentShowsResults(branch, 200), true, 'results open from available space without a manual selection');
assert.equal(agentShowsResults(branch, 50, true), true, 'action view never suppresses existing child outcomes');
assert.equal(agentShowsResults({ results: [] }, 500, true), false);
const timedSteps = [{ number: 1, start: 100, end: 120 }, { number: 2, start: 120, end: 200 }, { number: 3, start: 200, end: 300 }], position = i => 100 + 128 * i;
assert.equal(actorTimePosition(timedSteps, position, 160), 292);
assert.ok(actorTimePosition(timedSteps, position, 125) < actorTimePosition(timedSteps, position, 175), 'two child results within one parent step must retain distinct ordered positions');
assert.equal(actorTimePosition(timedSteps, position, 999), 420, 'results outside the recorded range stay bounded');
const actionFork = layoutAgentForks([{ branch, x: 100, end: 600, showResults: true }], { left: 20, right: 850, measure: s => s.length * 7, labelOf: () => '子任务', slots: [-112] });
const parentBesideChild = layoutBranches([{ id: 'parent', x: 300 }], { left: 20, right: 850, measure: s => s.length * 7, labelOf: () => '读取文件', slots: [-42, -64, -86, -104], obstacles: actionFork });
assert.equal(parentBesideChild.length, 1, 'the action view keeps room for parent result branches');
const childItems = branch.results.map(r => ({ id: r.id, at: r.time, x: 100 + 500 * (r.time - start) / span, result: r }));
const childTwigs = layoutBranches(childItems, { left: 20, right: 850, slots: [-40, -78], measure: s => s.length * 7, labelOf: m => m.length === 1 ? toolResultLabel(m[0].result) || '操作受阻' : m.length + ' 项结果' });
assert.equal(childTwigs.flatMap(p => p.members).length, branch.results.length, 'same twig packing preserves child outcomes');
console.log('PASS automatic child detail, action-view continuity, child timestamp alignment, parent/child shared packing and Skill evidence distinctions');
