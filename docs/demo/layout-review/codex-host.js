  // Host adapter only. Geometry, result branches, file selection and navigation
  // stay in the shared renderer. Codex actions are NOT model-request steps.
  const codexMeta = data.evidence;
  const codexNumber = value => value == null ? '未记录' : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(Math.round(value));
  const codexOriginalHeader = header;
  header = function() {
    codexOriginalHeader();
    $('session-name').textContent = 'CODEX · ' + data.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC · 只读快照';
    $('session-facts').innerHTML = session.totals.turns + ' 轮<span>/</span>' + session.totals.steps + ' 个可见动作<span>/</span>' + session.totals.calls + ' 次操作记录';
  };
  showSource = function() {
    const sources = [
      ['官方历史', data.evidence.api.name + '；轮次、item、参数、结果、状态、文件 diff。'],
      ['本机补充', codexMeta.local ? '读取 thread.path 指向的 rollout JSONL，以 item.id 精确关联 ' + codexMeta.timingMatched + ' 条起止记录。此格式属于本地适配器，非公开稳定 API。' : '没有读取本机 rollout；保留动作顺序，不补造起止时刻。'],
      ['动作含义', '图中的“步”是可见回复或操作记录；不是一次模型请求，不包含推理正文。'],
      ['实际输入量', '本地 token_count / token_usage_record 的最近一次请求输入 tokens；不是下一次请求预测量，也不是整轮总消耗。'],
      ['来源柱形', '按本机可见的保留文本估算：中文字符数 + 其余字符数 / 4。压缩时按 replacement_history 重建；不把实际输入量强行摊入七类。'],
      ['尚未覆盖', '图片 tokens、隐藏推理、请求序列化、未记录的系统／工具定义；缺失不等于 0。来源估算总和不能与实际输入量相加。'],
      ['文件读取', '官方 commandActions 与命令内 Get-Content / cat / readFileSync 等字面路径。成功进程仅证明命令返回，条件脚本的每个读取分支仍有估算边界。'],
      ['Skill', '显式 Skill 引用、读取 SKILL.md 与压缩快照中的技能文本是来源证据，不证明已遵守或导致了后续行为。'],
      ['来源标识', 'official-api / local-rollout / estimate 随数据保留；MCP server/tool/appContext 是线索，不把缺失 pluginId 伪造成插件身份。'],
      ['快照', data.mainSession + ' · ' + data.generatedAt],
    ];
    openDrawer('Codex 数据来源与边界', '共享事件模型与执行图 · 宿主独立适配', sources.map(([label, content]) => '<div class="source-row"><span>' + esc(label) + '</span>' + esc(content) + '</div>').join(''));
  };
  geistShowCurrentSource = function(key, summary) {
    const item = summary.categories.find(c => c.key === key), category = geistContextCategory(key);
    openDrawer(category.label, '可见保留文本估算 · estimate', '<div class="review-context-headline"><strong>≈' + codexNumber(item?.value) + '</strong><span>tokens 的文本估算量</span></div><p class="review-explain">从本机 rollout 的消息、工具定义、调用与返回识别来源；发生压缩时按 replacement_history 重建可见保留文本。中文字符计 1，其余字符除以 4。</p><p class="review-quiet">这不是官方分类 token 数，未包含图片、隐藏推理和未记录内容；不能由此证明某项内容实际进入了下一次请求。上方实际输入量独立读取最近请求用量。</p>');
  };
  const codexContextOverviewBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    codexContextOverviewBase();
    const region = $('geist-context-overview');
    if (region.dataset.codex) return; region.dataset.codex = 'true';
    const title = region.querySelector('h2');
    title.innerHTML = '最近请求输入 <small>实际用量 · 来源另作估算</small>';
    region.querySelector('.geist-context-meter')?.setAttribute('aria-label', '总长度表示最近请求实际输入占模型窗口的比例；颜色分段表示可见来源的估算比例。');
    const note = document.createElement('p'); note.className = 'review-quiet';
    note.style.margin = '6px 0 0'; note.style.fontSize = '11px';
    note.textContent = '总长度按实际用量，分色按可见来源估算；图中每步为可见动作。';
    region.append(note);
  };
  // Replace DSH-specific explanation drawers, while keeping the common bars.
  reviewOpenContext = function(number) {
    const row = reviewContextMap.get(number), samples = reviewContextData.requests.filter(r => r.turn === number), usages = reviewContextData.usage.filter(u => u.turnId === brRound(number).id);
    const changed = row ? CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after > 0 : row.parts[c.key].delta !== 0) : [];
    const parts = row ? changed.map(c => '<div class="source-row"><span>' + c.label + '</span>末次 ≈' + codexNumber(row.parts[c.key].after) + (row.isBaseline ? '' : ' · 变化 ' + (row.parts[c.key].delta > 0 ? '+' : '') + codexNumber(row.parts[c.key].delta)) + '</div>').join('') || '<p>本轮没有识别到可见文本来源变化。</p>' : '<p>没有本机可见文本构成记录。</p>';
    openDrawer('第 ' + number + ' 轮 · 来源估算', 'estimate · ' + samples.length + ' 个动作后取样', '<p class="review-explain">按可见保留文本估算，压缩时按替换历史重建。它表达文本来源变化，不是逐请求 token 计量。缺少的图片、隐藏推理和未记录内容不当作零。</p>' + parts + (usages.length ? '<h3>实际请求用量 · local-rollout</h3><p>本轮 ' + usages.length + ' 条响应计量；末条输入 ' + codexNumber(usages.at(-1).usage.input_tokens) + '，输出 ' + codexNumber(usages.at(-1).usage.output_tokens) + ' tokens。输入是该请求看到的上下文，跨请求累计会重复计算。</p>' : ''));
  };
  reviewOpenContextSources = function(key = 'system') { const summary = contextOverview(geistContextSnapshot?.pressure, null, reviewContextData.current); geistShowCurrentSource(key, summary); };
  reviewOpenCompaction = function(seqs) {
    const entries = reviewContextData.boundaries.filter(e => seqs.includes(e.seq));
    openDrawer('Codex 上下文压缩', 'official-api + local-rollout', '<p class="review-explain">黄色虚线标出 Codex 记录的压缩完成位置。本机 replacement_history 可用于重建可见保留文本；加密摘要无法读取，不计入文本估算，也不当作零 token。</p>' + entries.map(e => '<div class="source-row"><span>第 ' + e.turn + ' 轮 · seq ' + e.seq + '</span>此轮保留文本估算净变化 ' + reviewSigned(reviewContextMap.get(e.turn)?.net || 0) + '；包含轮内新增内容，并非此次压缩单独减少的实际 tokens。<br><button class="geist-text-action" data-codex-compaction-turn="' + e.turn + '">查看本轮来源估算 ↗</button></div>').join(''));
    $('drawer-body').querySelectorAll('[data-codex-compaction-turn]').forEach(el => el.onclick = () => reviewOpenContext(Number(el.dataset.codexCompactionTurn)));
  };
  const codexStepDetailBase = reviewOpenStepDetail;
  reviewOpenStepDetail = function(t, step, insight, info) {
    codexStepDetailBase(t, step, insight, null);
    if (info) $('review-detail-body').insertAdjacentHTML('beforeend', '<div class="review-detail-section"><h3>动作后的可见保留文本</h3><p>约 ' + codexNumber(info.total) + ' tokens 的文本估算量；非请求发出前的精确计量。</p></div>');
  };
  const codexCaptionBase = geistArrangeCaption;
  geistArrangeCaption = function() {
    codexCaptionBase();
    // No retry history was imported; absence is not a measured zero.
    if (!reviewContextData.retries.length) $('review-all-retries')?.remove();
    $('graph-caption').querySelectorAll('.review-overlay-caption').forEach(el => { if (/上下文/.test(el.textContent)) el.innerHTML = '可见文本估算 <b>↑增 ↓减 · 非精确 tokens</b>'; });
    $('graph-caption').querySelectorAll('.geist-tool-time-key').forEach(el => el.title = '按本机 rollout 对应 item.id 的实际起止绘制；未记录时不补造');
    const legend = $('geist-legend'); if (legend) legend.append(codexSourceButton);
  };
  const codexStepBase = reviewRenderStepSummary;
  reviewRenderStepSummary = function(t, step) {
    codexStepBase(t, step);
    const meta = $('step-panel').querySelector('.geist-step-meta>span>b'); if (meta) meta.textContent = '动作 ' + step.number;
    if (!step.endObserved) { const time = $('step-panel').querySelector('.geist-step-meta>span>span'); if (time) time.textContent = '轮内起止未记录'; }
    for (const call of step.calls) {
      const fact = reviewContextData.callFacts[call.seq];
      if (!fact?.diffChanges || $('step-panel').querySelector('[data-codex-diff="' + call.seq + '"]')) continue;
      const button = document.createElement('button'); button.className = 'geist-text-action'; button.dataset.codexDiff = call.seq; button.textContent = '查看文件差异 ↗';
      button.onclick = () => openDrawer('Codex 文件差异', 'official-api · fileChange.changes · 原始 diff', fact.diffChanges.map(change => '<h3>' + esc(change.path) + '</h3><p>' + esc(change.kind?.type || 'change') + '</p>' + block(change.diff)).join(''));
      $('step-panel').querySelector('.geist-operations').append(button);
    }
  };
  geistOpenTiming = function(number, stepNumber) {
    const step = brRound(number).steps.find(s => s.number === stepNumber);
    openDrawer('操作实际用时', 'local-rollout · 通过 item.id 关联', '<p class="review-explain">' + (step.endObserved ? '此动作实际起止差为 ' + preciseTime(step.end - step.start) + '。' : '未记录精确起止；不按动作数量分摊轮次耗时。') + '</p><p class="review-quiet">Codex 动作不等同于模型请求；此处没有推断模型处理用时。</p>');
  };
  const codexStatsTurns = session.turns.map(t => ({ turn: t.number, steps: t.steps.map(s => {
    const calls = s.calls.filter(c => c.timingSource === 'local-rollout' && c.end != null);
    return { turn: t.number, step: s.number, toolWall: calls.length ? Math.max(...calls.map(c => c.end)) - Math.min(...calls.map(c => c.start)) : null, tool: calls.reduce((n, c) => n + (c.durationMs ?? c.end - c.start), 0), calls: calls.map(c => ({ seq: c.seq, startedAt: c.start, endedAt: c.end })), tools: calls.map(c => ({ name: c.name, count: 1 })), toolPending: 0 };
  }) }));
  geistStatsByStep.clear(); for (const t of codexStatsTurns) for (const s of t.steps) geistStatsByStep.set(t.turn + ':' + s.step, s);
  // Expose host-specific source evidence as a small drawer from the title area.
  const codexSourceButton = document.createElement('button'); codexSourceButton.className = 'geist-text-action quiet'; codexSourceButton.textContent = 'Codex 数据依据 ↗'; codexSourceButton.onclick = showSource;
