  // Skill is a role of an existing input object, not another event lane.
  function geistSkillMaterials(files, scope) {
    if (!geistActorLayers.skills) return files;
    const materials = files.map(f => ({ ...f }));
    for (const skill of geistSkills) {
      const uses = skillUseEvents(skill).filter(e => scope.has(e.turn)); if (!uses.length) continue;
      const paths = new Set(uses.filter(e => e.path).map(e => fileIdentity(e.path)));
      const matches = materials.filter(f => paths.has(f.id));
      if (matches.length) { matches.forEach(f => { f.skillId = skill.id; f.skillName = skill.name; f.lane = 'read'; }); continue; }
      materials.push({ id: 'skill-material:' + skill.id, path: uses[0].path || skill.name, label: skill.name, skillId: skill.id, skillName: skill.name,
        referenceOnly: true, lane: 'read', reads: [], changes: [], failed: [], pending: [],
        operations: uses.map(e => ({ ...e, kind: 'reference', status: 'returned' })),
      });
    }
    return materials;
  }
  function geistSkillMaterialLabel(members) {
    const skills = members.filter(m => m.file.skillId);
    if (!skills.length) return null;
    const ids = [...new Set(skills.map(m => m.file.skillId))];
    if (skills.length === members.length) return ids.length === 1 ? 'Skill · ' + skills[0].file.skillName : ids.length + ' 项 Skill';
    return members.length + ' 份材料 · 含 Skill';
  }
  function geistOpenMaterials(files) {
    openDrawer('这段工作读到的材料', '选择材料，查看读取与引用记录', '<div class="actor-skill-list">' + files.map((f, i) => '<button data-actor-material="' + i + '"><strong>' + esc(f.skillId ? 'Skill · ' + f.skillName : f.label) + '</strong><span>' + esc(f.path) + '</span></button>').join('') + '</div>');
    $('drawer-body').querySelectorAll('[data-actor-material]').forEach(el => el.onclick = () => {
      const file = files[Number(el.dataset.actorMaterial)];
      if (file.skillId) { geistSkillChoose(file.skillId); geistOpenSkillEvidence(); }
      else { closeDrawer(); reviewSelectFile(file.id); reviewOpenFileHistory(file); }
    });
  }
  function geistBindSkillMaterials() {
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)], files = group.members.map(m => m.file);
      const skillFiles = files.filter(f => f.skillId); if (!skillFiles.length) return;
      el.classList.add('actor-skill-material');
      const selected = skillFiles.some(f => f.skillId === geistSkillSelected);
      el.classList.toggle('actor-skill-selected', selected);
      if (selected) el.setAttribute('aria-pressed', 'true');
      el.querySelector('.review-file-name').textContent = reviewTrimFileLabel(geistSkillMaterialLabel(group.members), group.width);
      el.querySelector('title').textContent = files.length === 1 ? 'Skill · ' + skillFiles[0].skillName + '；查看读取与引用记录' : files.length + ' 份材料，包含 Skill；点击选择';
      const open = () => {
        if (files.length > 1) { geistOpenMaterials(files); return; }
        geistSkillChoose(skillFiles[0].skillId); geistOpenSkillEvidence();
      };
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }
  function geistRenderSkillTouches(frame) {
    const skill = geistSkills.find(s => s.id === geistSkillSelected);
    if (!skill || !geistActorLayers.skills) return '';
    return skillUseEvents(skill).filter(frame.filter).map(e => {
      const x = frame.map(e);
      if (x < frame.left - 20 || x > frame.right + 20) return '';
      return brGroup('class="actor-skill-touch" data-actor-skill-event-id="' + esc(e.id) + '"',
        '<rect x="' + (x - 7) + '" y="' + (frame.base - 22) + '" width="14" height="24" class="br-hit"/><path d="M' + x + ' ' + frame.base + 'v-14" class="actor-skill-link"/><circle cx="' + x + '" cy="' + (frame.base - 14) + '" r="4" class="actor-skill-anchor"/>',
        skill.name + ' · 第 ' + e.turn + ' 轮 · ' + skillEvidenceLabel(e));
    }).join('');
  }
