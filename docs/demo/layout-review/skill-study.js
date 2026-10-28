  const study = data.skillStudy;
  geistSkillSelected = study.selected;
  const studySelected = () => geistActorLayers.skills ? study.skills.find(s => s.name === geistSkillSelected) : null;
  const studyContextBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    studyContextBase(); const region = $('geist-context-overview');
    if (region.dataset.study) return; region.dataset.study = 'true';
    region.querySelector('h2').innerHTML = '上下文构成 <small>模拟会话末尾</small>';
    region.querySelector('.geist-context-total>span').textContent = '来源构成';
    region.querySelector('.geist-context-total>div>span').textContent = ' tokens · 模拟值';
    region.querySelector('.geist-context-occupied').style.width = '100%';
    region.querySelector('.geist-context-meter').setAttribute('aria-label', '模拟可见来源构成，不表示模型容量占用');
  };
  // The upper skill materials are the selector itself, so no duplicate SKILL.md
  // file object is emitted into the same graph.
  const studyMaterialsBase = geistSkillMaterials;
  geistSkillMaterials = function(files, scope) { return studyMaterialsBase(files, scope).filter(f => !study.skills.some(s => s.path && fileIdentity(s.path) === f.id) && !f.skillId); };
  geistRenderSkillTouches = () => '';
  const studyGeometryBase = geistOverviewGeometry;
  geistOverviewGeometry = function() {
    const original = studyGeometryBase();
    const extra = ($('study-materials')?.getBoundingClientRect().height || 50) + ($('study-summary')?.getBoundingClientRect().height || 30);
    const height = Math.max(380, original.height - extra), pixels = Math.max(88, (height - 204) / 2);
    reviewContextScale.pixels = pixels;
    return { height, base: 124 + pixels };
  };
  function studyEvidence(skill) {
    openDrawer(skill.label + ' · ' + skill.name, '模拟记录中的关系依据',
      '<p class="review-explain">色带表示示例请求中保留了技能正文。高亮枝条是读入动作，或有明确引用的操作；是否正确遵循，要继续看执行结果。</p>' +
      skill.intervals.map(r => '<div class="source-row"><span>第 ' + r.turn + ' 轮读入</span>' + esc(r.endReason) + '</div>').join('') +
      skill.relations.map((r, i) => '<section class="study-proof"><strong>第 ' + r.turn + ' 轮 · 第 ' + r.step + ' 步</strong><p>“' + esc(r.quote) + '”</p><button class="geist-text-action" data-study-location="' + i + '">定位这一步 ↗</button></section>').join(''));
    $('drawer-body').querySelectorAll('[data-study-location]').forEach(el => el.onclick = () => { const r = skill.relations[Number(el.dataset.studyLocation)]; closeDrawer(); reviewEnterPath(r.turn, r.step); });
  }
  function studyControls() {
    let controls = $('study-materials'), summary = $('study-summary');
    if (!controls) {
      controls = document.createElement('div'); controls.id = 'study-materials'; controls.className = 'study-materials';
      controls.setAttribute('aria-label', '选择追踪的技能材料');
      summary = document.createElement('div'); summary.id = 'study-summary'; summary.className = 'study-summary'; summary.setAttribute('aria-live', 'polite');
      $('graph-scroll').before(controls, summary);
    }
    const selected = studySelected();
    controls.innerHTML = '<span>技能材料</span>' + study.skills.map(s => '<button data-study-skill="' + s.name + '" aria-pressed="' + (selected?.name === s.name) + '" title="' + esc(s.path) + '"><svg viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1h6l4 4v10H2zM8 1v4h4"/></svg>' + s.label + '</button>').join('') + (selected ? '<button id="study-clear">× 取消选择</button>' : '');
    controls.querySelectorAll('[data-study-skill]').forEach(el => el.onclick = () => geistSkillChoose(geistSkillSelected === el.dataset.studySkill ? null : el.dataset.studySkill));
    if ($('study-clear')) $('study-clear').onclick = () => geistSkillChoose(null);
    summary.innerHTML = selected ? '<strong>' + selected.name + '</strong><span>读入 ' + selected.reads.length + ' 次 · 明确引用 ' + selected.relations.length + ' 处</span><span>浅色带：正文保留范围</span><button id="study-evidence">查看依据 ↗</button>' : '<span>选择上方材料，在原图中追踪它的读取、引用与相关改动。</span>';
    if ($('study-evidence')) $('study-evidence').onclick = () => studyEvidence(selected);
  }
  const studyControlsBase = geistActorControls;
  geistActorControls = function() { studyControlsBase(); studyControls(); };
  function studyPaint() {
    const graph = $('graph'), selected = studySelected(); graph.querySelector('.study-ranges')?.remove();
    const relatedSeqs = new Set(selected?.relations.flatMap(r => r.seqs) || []);
    const readSeqs = new Set(selected?.reads.map(r => r.seq) || []);
    const seqs = new Set([...relatedSeqs, ...readSeqs]);
    const paths = new Set(reviewFileOperations.filter(op => relatedSeqs.has(op.seq)).map(op => fileIdentity(op.path)));
    graph.querySelectorAll('[data-tool-result]').forEach(el => {
      const p = geistOutcomeBranches[Number(el.dataset.toolResult)], hit = p.members.some(m => m.result.seqs.some(seq => seqs.has(seq)));
      el.classList.toggle('study-related', !!selected && hit); el.classList.toggle('study-dim', !!selected && !hit);
    });
    graph.querySelectorAll('[data-file-group]').forEach(el => {
      const p = reviewFileGroups[Number(el.dataset.fileGroup)], hit = p.members.some(m => paths.has(m.file.id));
      el.classList.toggle('study-related', !!selected && hit); el.classList.toggle('study-dim', !!selected && !hit);
    });
    graph.querySelectorAll('[data-step]').forEach(el => {
      const step = turn().steps[Number(el.dataset.step)], hit = step.calls.some(c => seqs.has(c.seq));
      el.classList.toggle('study-dim', !!selected && !hit);
    });
    if (!selected) return;
    const frame = geistActorContext(), t = view === 'path' ? turn() : null;
    let marks = '';
    for (const interval of selected.intervals) {
      const from = t ? Math.max(interval.from, t.start) : interval.from, to = t ? Math.min(interval.to, endOf(t)) : interval.to;
      if (to <= from) continue;
      const x = frame.map({ time: from }), end = frame.map({ time: to });
      marks += '<rect x="' + x + '" y="' + (frame.base - 11) + '" width="' + Math.max(2, end - x) + '" height="22" rx="4" class="study-range"/>';
    }
    graph.insertAdjacentHTML('afterbegin', '<g class="study-ranges">' + marks + '</g>');
  }
  const studyActorsBase = geistRenderActors;
  geistRenderActors = function() { studyActorsBase(); studyPaint(); };
  const studyFilesBase = reviewFilesBind;
  reviewFilesBind = function() { studyFilesBase(); studyPaint(); };
  const studyResultBase = geistOpenResult;
  geistOpenResult = function(result) {
    studyResultBase(result); const selected = studySelected();
    const relation = selected?.relations.find(r => result.seqs.some(seq => r.seqs.includes(seq)));
    if (relation) $('drawer-body').insertAdjacentHTML('afterbegin', '<section class="study-proof"><strong>为什么关联 ' + esc(selected.name) + '</strong><p>“' + esc(relation.quote) + '”</p></section>');
  };
  showSource = () => openDrawer('Skill 关系模拟', '全部为合成数据', '<p>演示同一份技能材料如何进入上下文、被明确引用、经历压缩后重新读取。色带依据本示例设定的上下文快照；不代表对真实会话完成了影响归因。</p>');
