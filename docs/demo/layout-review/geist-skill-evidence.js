  const geistSkillAnalysis = data.context?.skillAnalysis;
  const geistSkillScopeCache = new Map();
  function geistSkillScope(name = geistSkillSelected) {
    if (!geistSkillAnalysis || !name) return null;
    if (geistSkillScopeCache.has(name)) return geistSkillScopeCache.get(name);
    const records = geistSkillAnalysis.records.filter(s => s.name === name); if (!records.length) return null;
    const intervals = records.flatMap(r => r.intervals);
    const contains = time => intervals.some(i => time >= i.from && time < i.to);
    const calls = session.turns.flatMap(t => t.steps.flatMap(step => step.calls.filter(call => contains(call.start)).map(call => ({ ...call, turn: t.number, step: step.number }))));
    const seqs = new Set(calls.map(c => c.seq));
    const operations = reviewFileOperations.filter(op => seqs.has(op.seq));
    const paths = new Set(operations.map(op => fileIdentity(op.path)));
    const changes = new Set(operations.filter(op => op.kind === 'change' && op.status === 'returned').map(op => fileIdentity(op.path)));
    const first = Math.min(...intervals.map(i => i.from));
    const end = Math.max(...intervals.map(i => i.to));
    const firstTurn = records[0].turn;
    const lastTurn = session.turns.find(t => end <= endOf(t))?.number || session.turns.at(-1).number;
    const result = { records, intervals, contains, calls, seqs, paths, changes, first, end, firstTurn, lastTurn };
    geistSkillScopeCache.set(name, result); return result;
  }
  function geistSkillScopeControls() {
    if (!geistSkillAnalysis || !$('geist-context-overview')) return;
    let choices = $('skill-trace-choices');
    if (!choices) { choices = document.createElement('div'); choices.id = 'skill-trace-choices'; choices.className = 'skill-trace-choices'; $('geist-context-overview').append(choices); }
    choices.hidden = !geistActorLayers.skills;
    const names = [...new Set(geistSkillAnalysis.records.map(r => r.name))];
    const key = names.join('|') + ':' + geistSkillSelected;
    if (choices.dataset.key !== key) {
      choices.dataset.key = key;
      choices.innerHTML = '<span>追踪 Skill</span>' + names.map(name => '<button data-real-skill="' + esc(name) + '" aria-pressed="' + (geistSkillSelected === name) + '">' + esc(name) + '</button>').join('');
      choices.querySelectorAll('[data-real-skill]').forEach(el => el.onclick = () => geistSkillChoose(geistSkillSelected === el.dataset.realSkill ? null : el.dataset.realSkill));
    }
    const scope = geistSkillScope(), selection = $('actor-selection');
    if (selection && choices.nextElementSibling !== selection) selection.before(choices);
    if (scope && selection && geistActorLayers.skills && selection.dataset.scopeKey !== geistSkillSelected) {
      selection.dataset.scopeKey = geistSkillSelected;
      selection.innerHTML = '<span>观察第 ' + scope.firstTurn + '–' + scope.lastTurn + ' 轮 · ' + scope.calls.length + ' 次工具调用 · ' + scope.changes.size + ' 个文件有改动</span><button id="actor-skill-evidence">范围与工具线索 ↗</button><button id="actor-skill-clear" aria-label="取消 Skill 选择">× 取消</button>';
      $('actor-skill-evidence').onclick = () => geistOpenSkillEvidence();
      $('actor-skill-clear').onclick = () => geistSkillChoose(null);
    }
  }
  const geistSkillControlsBase = geistActorControls;
  geistActorControls = function() { geistSkillControlsBase(); geistSkillScopeControls(); };
  const geistSkillEvidenceBase = geistOpenSkillEvidence;
  geistOpenSkillEvidence = function(id = geistSkillSelected) {
    const scope = geistSkillScope(id);
    if (!scope) return geistSkillEvidenceBase(id);
    const counts = new Map(); scope.calls.forEach(c => counts.set(c.name, (counts.get(c.name) || 0) + 1));
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const records = scope.records, scripts = records.flatMap(r => r.scripts), tools = records.flatMap(r => r.tools), mentions = records.flatMap(r => r.mentions);
    const requests = scope.intervals.reduce((n, i) => n + i.requests, 0);
    openDrawer(id, '读取后的执行观察范围', '<div class="skill-scope-intro"><strong>第 ' + scope.firstTurn + ' 轮读入 → 第 ' + scope.lastTurn + ' 轮正文移出</strong><p>先看这段执行发生了什么，再沿工具、文件和引用检查具体联系。</p></div>' +
      '<p class="review-explain">这段里调用了 ' + scope.calls.length + ' 次工具，修改了 ' + scope.changes.size + ' 个文件；' + scope.calls.filter(c => c.status === 'error').length + ' 次调用返回错误。</p>' +
      '<div class="skill-scope-tools">' + common.map(([name, count]) => '<span>' + esc(name) + ' <b>' + count + '</b></span>').join('') + '</div>' +
      '<h3>这份 Skill 提供了哪些执行线索</h3>' +
      (tools.length || scripts.length ? [...tools.map(t => ({ label: '提到工具 ' + t.name, quote: t.quote })), ...scripts.map(s => ({ label: '脚本 ' + s.path, quote: s.quote }))].map(item => '<section class="skill-scope-source"><strong>' + esc(item.label) + '</strong><p>' + esc(item.quote) + '</p></section>').join('') : '<p>正文主要描述行为与设计规则，没有识别到具名工具或脚本命令。仍可在上面的执行范围内观察改动。</p>') +
      (mentions.length ? '<h3>记录中的明确提及</h3>' + mentions.map((m, i) => '<section class="skill-scope-source"><p>' + esc(m.quote) + '</p><button class="geist-text-action" data-skill-mention="' + i + '">第 ' + m.turn + ' 轮 · 第 ' + m.step + ' 步 ↗</button></section>').join('') : '') +
      '<details class="skill-scope-source"><summary>范围依据</summary><p>复用 DSH 官方 SurfaceManager 重放模型可见历史，正文覆盖 ' + requests + ' 个已记录请求。第 ' + scope.lastTurn + ' 轮的上下文替换移除了原文；摘要或后续改动仍可能保留它的影响。</p><p>范围内活动是观察对象；工具名和命令匹配是进一步的关联线索。</p></details>');
    $('drawer-body').querySelectorAll('[data-skill-mention]').forEach(el => el.onclick = () => { const m = mentions[Number(el.dataset.skillMention)]; closeDrawer(); reviewEnterPath(m.turn, m.step); });
  };
  const geistSkillTouchesBase = geistRenderSkillTouches;
  geistRenderSkillTouches = frame => geistSkillScope() ? '' : geistSkillTouchesBase(frame);
  function geistPaintSkillScope() {
    if (!geistSkillAnalysis) return;
    const graph = $('graph'); graph.querySelector('.real-skill-range')?.remove();
    const scope = geistActorLayers.skills ? geistSkillScope() : null;
    const frame = geistActorContext(), t = view === 'path' ? turn() : null;
    if (scope) {
      let svg = '';
      for (const interval of scope.intervals) {
        const from = t ? Math.max(t.start, interval.from) : interval.from, to = t ? Math.min(endOf(t), interval.to) : interval.to;
        if (to <= from) continue;
        const x = frame.map({ time: from }), end = frame.map({ time: to });
        svg += '<rect x="' + x + '" y="' + (frame.base - 12) + '" width="' + Math.max(2, end - x) + '" height="24" rx="3"/>';
      }
      graph.insertAdjacentHTML('afterbegin', '<g class="real-skill-range" aria-label="所选 Skill 读取后的观察区间">' + svg + '</g>');
    }
    graph.querySelectorAll('[data-tool-result]').forEach(el => {
      const group = geistOutcomeBranches[Number(el.dataset.toolResult)], hit = scope && group.members.some(m => m.result.seqs.some(seq => scope.seqs.has(seq)));
      el.classList.toggle('skill-scope-outside', !!scope && !hit);
    });
    graph.querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)], hit = scope && group.members.some(m => scope.paths.has(m.file.id) || m.file.skillId === geistSkillSelected);
      el.classList.toggle('skill-scope-outside', !!scope && !hit);
    });
    graph.querySelectorAll('[data-step]').forEach(el => {
      const step = t?.steps[Number(el.dataset.step)];
      el.classList.toggle('skill-scope-outside', !!scope && step && !scope.contains(step.start));
    });
    graph.querySelectorAll('.review-context-turn').forEach(el => {
      const number = Number(el.dataset.contextTurn), round = session.turns.find(t => t.number === number);
      if (round) el.classList.toggle('skill-scope-outside', !!scope && !scope.intervals.some(i => round.start < i.to && endOf(round) >= i.from));
    });
  }
  const geistSkillActorsBase = geistRenderActors;
  geistRenderActors = function() { geistSkillActorsBase(); geistPaintSkillScope(); };
  const geistSkillFilesBase = reviewFilesBind;
  reviewFilesBind = function() { geistSkillFilesBase(); geistPaintSkillScope(); };
