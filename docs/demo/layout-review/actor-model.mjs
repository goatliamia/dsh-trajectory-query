export function actorRecords(data) {
  const session = data.sessions.find(s => s.id === data.mainSession), context = data.context || {};
  const locate = event => {
    const t = session.turns.find(t => t.number === event.turn || t.id === event.turnId);
    const step = t?.steps.find(s => s.number === event.step || s.seq === event.seq);
    return { ...event, turn: event.turn ?? t?.number, step: event.step ?? step?.number, time: event.time ?? event.start ?? step?.start ?? t?.start };
  };
  const skills = (context.skillEvents || []).map((e, i) => ({ ...locate(e), id: e.id || 'skill:' + (e.seq ?? i) + ':' + i,
    name: e.name || e.path?.replace(/\\/g, '/').split('/').at(-2) || 'Skill',
  })).filter(e => Number.isFinite(e.time));
  const branches = context.agentBranches ? context.agentBranches.map(b => ({ ...b, steps: b.steps || [], reports: b.reports || [] })) :
    (context.collaborationEvents || []).filter(e => e.tool === 'spawn_agent').map((e, i) => {
      const events = context.collaborationEvents.filter(x => x.taskName === e.taskName && x.start >= e.start);
      const location = locate(e);
      return { id: e.taskPath || 'agent:' + i, name: e.taskName || '子代理', title: e.taskName || '子任务', start: e.start, end: null, returnTime: null,
        turn: location.turn, step: location.step, seq: e.seq, status: 'unknown', steps: [], reports: [], communications: events, source: e.source };
    });
  return { skills, branches };
}

// Only observations are grouped. A catalog is never converted into a skill load.
export function skillObjects(events) {
  const objects = new Map();
  for (const event of events) {
    const entries = event.kind === 'catalog' ? event.entries || [] : [{ name: event.name, path: event.path }];
    for (const entry of entries) {
      const id = entry.name || entry.path;
      if (!id) continue;
      if (!objects.has(id)) objects.set(id, { id, name: entry.name || entry.path, description: entry.description, events: [] });
      objects.get(id).events.push(event);
    }
  }
  return [...objects.values()];
}

// Intervals use recorded execution/return times only. Unknown work is a point.
export function agentExtent(branch) {
  return { start: branch.start, end: branch.returnTime ?? branch.end ?? branch.start, hasEnd: branch.returnTime != null || branch.end != null };
}

export function visibleAgentBranches(branches, selected, limit = 3) {
  const rows = branches.slice(0, limit), picked = branches.find(b => b.id === selected);
  if (picked && !rows.some(b => b.id === picked.id)) rows[rows.length - 1] = picked;
  return { rows, hidden: branches.length - rows.length };
}

export function skillUseEvents(skill) {
  return skill.events.filter(e => e.kind !== 'catalog' && e.status !== 'error' && e.status !== 'unknown');
}
export function skillEvidenceLabel(event) {
  return event.kind === 'catalog' ? '出现在可用目录' : event.kind === 'skill-tool-load' ? '读入技能正文' : event.kind === 'skill-file-read' ? '读取技能材料' : '显式引用';
}

// The action view keeps the parent's ordered step axis. Child results use their
// own timestamps, never their step numbers as parent-step indexes.
export function actorTimePosition(steps, x, time) {
  if (!steps.length) return 0;
  if (time <= steps[0].start) return x(0);
  for (let i = 1; i < steps.length; i++) {
    if (time < steps[i].start) {
      const fraction = (time - steps[i - 1].start) / Math.max(1, steps[i].start - steps[i - 1].start);
      return x(i - 1) + (x(i) - x(i - 1)) * fraction;
    }
  }
  const last = steps.length - 1, half = last ? (x(last) - x(last - 1)) / 2 : 56;
  return x(last) + half * Math.max(0, Math.min(1, (time - steps[last].start) / Math.max(1, steps[last].end - steps[last].start)));
}

export function agentShowsResults(branch, span, actionView = false) {
  return Boolean(branch.results?.length && (actionView || span >= 128));
}

// Forks and ordinary result twigs occupy one plot. Dense fork groups remain
// selectable; an unobserved child ending never becomes an execution interval.
export function layoutAgentForks(items, { left, right, measure, labelOf, expanded = null, slots = [-60, 60, -96, 96], compact = false }) {
  let groups = [...items].sort((a, b) => a.x - b.x).map(item => [item]);
  const hit = (a, b) => a.left < b.right + 10 && a.right + 10 > b.left && a.top < b.bottom + 8 && a.bottom + 8 > b.top;
  for (;;) {
    const placed = []; let failed = -1;
    for (const [index, members] of groups.entries()) {
      const single = members.length === 1, item = members[0], open = single && (item.showResults ?? item.branch.id === expanded);
      const x = item.x, end = single ? Math.max(x + 18, item.end) : x + 22;
      const label = labelOf(members), width = Math.min(right - left, measure(label) + 20);
      const cx = Math.max(left + width / 2, Math.min(right - width / 2, (x + end) / 2));
      const rect = { left: Math.min(x, cx - width / 2), right: Math.max(end, cx + width / 2) };
      const slot = slots.map(dy => ({ ...rect, x, end, cx, dy, label, members, open,
        top: dy - (compact ? 16 : open && dy < 0 ? 112 : 30), bottom: dy + (compact ? 4 : open ? (dy > 0 ? 108 : 35) : 10) }))
        .find(p => placed.every(q => !hit(p, q)));
      if (!slot) { failed = index; break; }
      placed.push(slot);
    }
    if (failed < 0) return placed;
    const i = Math.max(0, failed - 1);
    groups.splice(i, 2, [...groups[i], ...groups[i + 1]]);
  }
}
