  const geistActors = actorRecords(data), geistSkills = skillObjects(geistActors.skills);
  let geistSkillSelected = null;
  const geistActorLayers = { skills: true, agents: true };
  let geistActorResultGroups = [];
  function geistActorReserve() { return 0; }
  function geistActorLabel(text, limit) {
    let label = String(text || '');
    if (reviewMeasure(label) <= limit) return label;
    while (label.length && reviewMeasure(label + '…') > limit) label = label.slice(0, -1);
    return label + '…';
  }
  function geistActorsRedraw() { if (view === 'path') renderActionPath(); else renderOverview({ plotOnly: true }); geistActorControls(); }
  function geistSkillChoose(id) {
    const skill = geistSkills.find(s => s.id === id);
    if (skill && !skillUseEvents(skill).length) { geistOpenSkillEvidence(id); return; }
    geistSkillSelected = id; if (id) geistActorLayers.skills = true;
    closeDrawer(); geistActorsRedraw();
  }
  function geistOpenSkillLibrary(events = geistActors.skills) {
    const objects = skillObjects(events);
    openDrawer('Skill', objects.some(s => skillUseEvents(s).length) ? '读取或引用过的技能显示在上方材料中' : '仅记录了可用目录，未见实际读取或调用', '<div class="actor-skill-list">' + objects.map(s => {
      const reads = skillUseEvents(s);
      return '<button data-actor-skill="' + esc(s.id) + '"><strong>' + esc(s.name) + '</strong><span>' + (reads.length ? reads.length + ' 次引用或读取' : s.events.length + ' 次目录记录 · 未见实际读取') + '</span></button>';
    }).join('') + '</div>');
    $('drawer-body').querySelectorAll('[data-actor-skill]').forEach(el => el.onclick = () => geistSkillChoose(el.dataset.actorSkill));
  }
  function geistOpenSkillEvidence(id = geistSkillSelected) {
    const skill = geistSkills.find(s => s.id === id); if (!skill) return;
    openDrawer(skill.name, skillUseEvents(skill).length ? '上方材料对象对应这些读取与引用记录' : '可用目录中的技能 · 未见实际读取或调用', (skill.description ? '<p class="review-explain">' + esc(skill.description) + '</p>' : '') +
      '<div class="actor-skill-list">' + skill.events.map((e, i) => '<button data-actor-skill-event="' + i + '"><strong>第 ' + e.turn + ' 轮' + (e.step ? ' · 第 ' + e.step + ' 步' : '') + '</strong><span>' + skillEvidenceLabel(e) + '</span></button>').join('') + '</div><p class="review-quiet">目录出现表示当时可用；读取表示取得了材料。后续是否仍保留、是否遵循，不由这些记录自动推断。</p>');
    $('drawer-body').querySelectorAll('[data-actor-skill-event]').forEach(el => el.onclick = () => {
      const event = skill.events[Number(el.dataset.actorSkillEvent)]; closeDrawer(); reviewEnterPath(event.turn, event.step);
    });
  }
  function geistOpenAgent(branch) {
    const extent = agentExtent(branch);
    openDrawer(branch.name, branch.title, '<div class="actor-agent-summary"><span>' + (branch.steps.length ? branch.steps.length + ' 个内部步骤' : '内部步骤尚未关联') + '</span><span>' + (extent.hasEnd ? reviewDuration(extent.end - extent.start) : '结束时间未记录') + '</span></div>' +
      '<div class="drawer-actions"><button class="action-button" id="actor-agent-toggle">' + '定位子任务' + '</button><button class="action-button" id="actor-agent-parent">定位主干 ↗</button></div>' +
      (branch.reports.length ? '<h3>回到主干的消息</h3>' + branch.reports.map(r => '<details class="actor-report"><summary>' + (r.kind === 'completed' ? '任务结束回报' : '过程回报') + '</summary><p>' + esc(r.text) + '</p></details>').join('') : '<p class="review-quiet">已记录委派关系；尚未关联子任务回报，不把调用返回当作任务完成。</p>'));
    $('actor-agent-toggle').onclick = () => { closeDrawer(); if (view === 'path') { view = 'overview'; zoom = null; render(); } geistToggleAgent(branch.id); };
    $('actor-agent-parent').onclick = () => { closeDrawer(); reviewEnterPath(branch.turn, branch.step); };
  }
  function geistOpenAgents() {
    openDrawer('子代理支线', geistActors.branches.length + ' 个任务', '<div class="actor-skill-list">' + geistActors.branches.map((b, i) => '<button data-actor-pick-agent="' + i + '"><strong>' + esc(b.name) + '</strong><span>第 ' + b.turn + ' 轮委派 · ' + (b.steps.length ? b.steps.length + ' 个内部步骤' : '内部路径未关联') + '</span></button>').join('') + '</div>');
    $('drawer-body').querySelectorAll('[data-actor-pick-agent]').forEach(el => el.onclick = () => { closeDrawer(); geistToggleAgent(geistActors.branches[Number(el.dataset.actorPickAgent)].id); });
  }
  function geistToggleAgent(id) {
    const branch = geistActors.branches.find(b => b.id === id); if (!branch) return;
    if (view === 'path' || !agentExtent(branch).hasEnd) { geistOpenAgent(branch); return; }
    const vp = $('graph-scroll'), p = overviewProjection, extent = agentExtent(branch);
    const span = Math.max(1, p.mapTime(extent.end) - p.mapTime(extent.start));
    reviewSetOverviewScaleBase(Math.min(1024, Math.max(overviewScale, overviewScale * vp.clientWidth * .65 / span)));
    const next = overviewProjection;
    vp.scrollLeft = Math.max(0, (next.mapTime(extent.start) + next.mapTime(extent.end)) / 2 - vp.clientWidth / 2);
    renderOverview({ plotOnly: true }); reviewSyncNavigation();
  }
  function geistActionGeometry(t) {
    const branches = geistActorLayers.agents && geistActors.branches.some(b => b.turn === t.number && b.results?.length);
    // 行动路径的高度跟着对话区走:短面板里先保住步标签、主图和步骤详情。
    const available = $('canvas')?.clientHeight || window.innerHeight;
    const tight = available < 620, compact = available < 760;
    if (branches) return tight ? { height: 296, base: 198 } : compact ? { height: 340, base: 220 } : { height: 420, base: 268 };
    return tight ? { height: 256, base: 166 } : compact ? { height: 300, base: 182 } : { height: 360, base: 208 };
  }
  function geistActorControls() {
    const caption = $('graph-caption'), layers = caption.querySelector('.br-layers'); if (!layers) return;
    for (const [key, label] of [['skills', 'Skill'], ['agents', '子代理']]) if (!layers.querySelector('[data-actor-layer="' + key + '"]')) {
      if (key === 'agents' && !geistActors.branches.length || key === 'skills' && !geistActors.skills.length) continue;
      const element = document.createElement('label'); element.className = 'br-layer';
      element.innerHTML = '<input type="checkbox" data-actor-layer="' + key + '"' + (geistActorLayers[key] ? ' checked' : '') + '>' + label;
      element.querySelector('input').onchange = e => { geistActorLayers[key] = e.target.checked; geistActorsRedraw(); };
      layers.append(element);
    }
    let selection = $('actor-selection');
    if (!selection) { selection = document.createElement('div'); selection.id = 'actor-selection'; }
    const top = $('geist-context-overview'); if (top && selection.parentElement !== top) top.append(selection);
    const skill = geistSkills.find(s => s.id === geistSkillSelected);
    selection.hidden = !skill || !geistActorLayers.skills;
    if (skill && !(typeof geistSkillScope === 'function' && geistSkillScope(skill.id))) {
      selection.innerHTML = '<span>Skill · <strong>' + esc(skill.name) + '</strong></span><button id="actor-skill-evidence">' + skillUseEvents(skill).length + ' 次读取／引用 ↗</button><button id="actor-skill-clear" aria-label="取消 Skill 选择">× 取消</button>';
      $('actor-skill-clear').onclick = () => geistSkillChoose(null); $('actor-skill-evidence').onclick = () => geistOpenSkillEvidence();
    }
    layers.querySelectorAll('[data-actor-layer]').forEach(input => { input.checked = geistActorLayers[input.dataset.actorLayer]; });
    const source = top?.querySelector('[data-current-source="skill"]');
    if (source) {
      const used = geistSkills.some(s => skillUseEvents(s).length);
      source.querySelector('span').textContent = used ? '技能内容' : '技能目录';
      source.title = used ? '查看技能材料与引用记录' : '只有可用目录记录，未见实际读取或调用';
      source.onclick = () => geistOpenSkillLibrary();
    }
  }
  function geistActorContext() {
    const graph = $('graph'), vp = $('graph-scroll');
    const width = view === 'overview' ? Math.max(vp.clientWidth, (overviewProjection.layout.at(-1)?.end || 0) + 54) : Number(graph.getAttribute('viewBox').split(' ')[2]);
    if (view === 'overview') return { width, base: overviewProjection.mainY, left: vp.scrollLeft + 54, right: vp.scrollLeft + vp.clientWidth - 54, map: e => overviewProjection.mapTime(e.time ?? e.start), filter: () => true };
    const frame = reviewActionFileFrame, indices = new Map(frame.t.steps.map((s, i) => [s.number, i]));
    const at = e => e.step != null && indices.has(e.step) ? frame.x(indices.get(e.step)) : actorTimePosition(frame.t.steps, frame.x, e.time ?? e.start);
    return { width, base: frame.base, left: vp.scrollLeft + 54, right: vp.scrollLeft + vp.clientWidth - 54, map: at, filter: e => e.turn === frame.t.number };
  }
  function geistPlanAgentForks() {
    if (!geistActorLayers.agents || !geistActors.branches.length) return [];
    const frame = geistActorContext();
    const items = geistActors.branches.filter(frame.filter).map(branch => {
      const extent = agentExtent(branch), x = frame.map({ ...branch, time: extent.start });
      const end = extent.hasEnd ? frame.map({ ...branch, step: undefined, time: extent.end }) : x;
      return { branch, x, end, showResults: agentShowsResults(branch, end - x, view === 'path') };
    });
    return layoutAgentForks(items, { left: 20, right: frame.width - 20, measure: reviewMeasure,
      ...(view === 'path' ? { slots: [-112] } : {}),
      labelOf: members => members.length > 1 ? members.length + ' 个子代理' : geistActorLabel(members[0].branch.name, Math.min(160, frame.width - 120)),
    });
  }
  const geistForkResultsBase = geistDrawResultBranches;
  geistDrawResultBranches = function(items, base, left, right, visible, options = {}) {
    const forks = geistPlanAgentForks();
    const reserved = forks.map(p => ({ left: p.left - 3, right: p.right + 3, top: p.top, bottom: p.bottom }));
    return geistForkResultsBase(items, base, left, right, visible, { ...options, reserved,
      reservedKey: forks.map(p => [p.x, p.end, p.dy, p.open, p.label].join('/')).join('|'),
    });
  };
  function geistRenderActors() {
    const graph = $('graph'); if (!graph || !graph.getAttribute('viewBox')) return;
    const active = document.activeElement;
    const focusAttribute = active?.closest('.actor-layer') && ['data-actor-fork', 'data-actor-agent-details', 'data-actor-child-result', 'data-actor-skill-event-id'].find(key => active.hasAttribute(key));
    const focusValue = focusAttribute ? active.getAttribute(focusAttribute) : null;
    graph.querySelector('.actor-layer')?.remove();
    $('graph-wrap').style.height = '';
    const frame = geistActorContext(), plans = geistPlanAgentForks();
    let html = geistRenderSkillTouches(frame); geistActorResultGroups = [];
    plans.forEach((plan, planIndex) => {
      if (plan.right < frame.left - 80 || plan.left > frame.right + 80) return;
      const single = plan.members.length === 1, branch = plan.members[0].branch, extent = agentExtent(branch);
      const a = plan.x, end = plan.end, y = frame.base + plan.dy, sign = Math.sign(plan.dy);
      const ramp = Math.min(10, Math.max(3, (end - a) / 2));
      let path = 'M' + a + ' ' + frame.base + 'V' + (y - sign * ramp) + 'q0 ' + (sign * ramp) + ' ' + ramp + ' ' + (sign * ramp) + 'H' + (end - (single && branch.returnTime != null ? ramp : 0));
      if (single && branch.returnTime != null) path += 'q' + ramp + ' 0 ' + ramp + ' ' + (-sign * ramp) + 'V' + frame.base;
      const label = plan.label;
      const route = '<path d="' + path + '" class="actor-agent-stem"/><path d="' + path + '" class="actor-agent-hit"/>';
      const labelY = plan.open && sign < 0 ? y + 18 : y - 13;
      const labelHalf = reviewMeasure(label) / 2 + 6;
      const labelX = Math.max(frame.left + labelHalf, Math.min(frame.right - labelHalf, plan.cx));
      const body = route + '<rect x="' + (labelX - labelHalf) + '" y="' + (labelY - 15) + '" width="' + (labelHalf * 2) + '" height="22" class="br-hit"/>' + brText(labelX, labelY, label, 'actor-agent-label');
      html += brGroup('class="actor-agent" data-actor-fork="' + planIndex + '" aria-expanded="' + plan.open + '"', body,
        single ? branch.name + ' · ' + (extent.hasEnd ? reviewDuration(extent.end - extent.start) : '结束时间未记录') + '；' + (plan.open ? '结果随缩放展开；点击查看任务' : '点击放大查看结果') : plan.members.length + ' 个子代理；点击选择');
      if (!single) return;
      if (!plan.open) return;
      if (branch.results?.length && overviewLayers.has('failures')) {
        const items = branch.results.map(result => ({ id: branch.id + ':' + result.id, at: result.time, x: frame.map({ time: result.time }), result }));
        const slots = sign < 0 ? (y > 210 ? [-40, -78] : [-40]) : [32, 70];
        const packed = layoutBranches(items, { left: 20, right: frame.width - 20, measure: reviewMeasure, labelOf: geistOutcomeText, slots });
        for (const p of packed) {
          if (p.right < frame.left - 80 || p.left > frame.right + 80) continue;
          const index = geistActorResultGroups.length; geistActorResultGroups.push({ branch, members: p.members });
          html += brGroup('class="br-incident geist-result-branch actor-child-result" data-actor-child-result="' + index + '"',
            geistResultBranchBody(p, y), branch.name + ' · ' + p.label + '；查看子任务执行结果');
        }
      }
      const details = branch.steps.length ? branch.steps.length + ' 步 · ' + branch.reports.length + ' 条回报 ↗' : '查看委派记录 ↗';
      const dx = Math.max(54, Math.min(frame.width - 54 - reviewMeasure(details), labelX - reviewMeasure(details) / 2));
      html += brGroup('class="actor-agent-details" data-actor-agent-details="' + esc(branch.id) + '"', '<rect x="' + dx + '" y="' + (y + 20) + '" width="' + (reviewMeasure(details) + 8) + '" height="20" class="br-hit"/>' + brText(dx, y + 33, details, 'actor-agent-meta', 'start'), '查看子代理任务与回报');
    });
    if (html) graph.insertAdjacentHTML('beforeend', '<g class="actor-layer">' + html + '</g>');
    geistBindSkillMaterials();
    graph.querySelectorAll('[data-actor-fork]').forEach(el => el.onclick = e => {
      e.stopPropagation(); const plan = plans[Number(el.dataset.actorFork)];
      if (plan.members.length === 1) {
        const branch = plan.members[0].branch;
        if (plan.open || !branch.results?.length) geistOpenAgent(branch); else geistToggleAgent(branch.id);
      } else geistOpenAgents();
    });
    graph.querySelectorAll('[data-actor-agent-details]').forEach(el => el.onclick = e => { e.stopPropagation(); geistOpenAgent(geistActors.branches.find(b => b.id === el.dataset.actorAgentDetails)); });
    graph.querySelectorAll('[data-actor-skill-event-id]').forEach(el => el.onclick = e => { e.stopPropagation(); geistOpenSkillEvidence(); });
    graph.querySelectorAll('[data-actor-child-result]').forEach(el => el.onclick = e => {
      e.stopPropagation(); const group = geistActorResultGroups[Number(el.dataset.actorChildResult)];
      openDrawer(group.branch.name, geistOutcomeText(group.members), group.members.map(m => {
        const result = m.result;
        const calls = result.kind === 'incident' ? group.branch.steps.flatMap(s => s.detail).filter(c => result.seqs.includes(c.seq)) : result.calls;
        return '<section class="actor-child-detail"><h3>第 ' + result.step + ' 步 · ' + esc(result.kind === 'incident' ? reviewBranchLabel([{ e: result.incident }]) : toolResultLabel(result)) + '</h3>' + calls.map(c => '<p>' + esc(c.fact?.outcome || c.outcome || '执行结果已记录') + '</p>' + (c.file || c.target ? '<p class="review-quiet">' + esc(c.file || c.target) + '</p>' : '')).join('') + '</section>';
      }).join(''));
    });
    graph.querySelectorAll('[data-actor-fork],[data-actor-agent-details],[data-actor-child-result],[data-actor-skill-event-id]').forEach(el => el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(e); } });
    if (focusAttribute) [...graph.querySelectorAll('[' + focusAttribute + ']')].find(el => el.getAttribute(focusAttribute) === focusValue)?.focus({ preventScroll: true });
  }
  const geistActorCaptionBase = geistArrangeCaption;
  geistArrangeCaption = function() { geistActorCaptionBase(); geistActorControls(); };
  const geistActorOverviewBase = renderOverview;
  renderOverview = function(...args) { const value = geistActorOverviewBase(...args); geistRenderActors(); return value; };
  const geistActorActionBase = renderActionPath;
  renderActionPath = function(...args) {
    $('graph-wrap').style.height = ''; const value = geistActorActionBase(...args); geistRenderActors(); return value;
  };


  let geistActorScrollFrame = 0;
  $('graph-scroll').addEventListener('scroll', () => {
    if (view !== 'path' || geistActorScrollFrame) return;
    geistActorScrollFrame = requestAnimationFrame(() => { geistActorScrollFrame = 0; if (view === 'path') geistRenderActors(); });
  });
