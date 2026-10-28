  // Pi keeps the common graph/objects. Only host semantics and synthetic labels
  // differ; no independent report page or alternate graph renderer is added.
  const piEvidence = data.evidence, piNumber = value => value == null ? '未记录' : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(Math.round(value));
  const piHeaderBase = header;
  header = function() { piHeaderBase(); $('review-state').textContent = session.totals.turns + ' 轮模拟记录'; };
  showSource = function() {
    const source = piEvidence.source;
    openDrawer('Pi 模拟数据依据', 'Pi ' + source.version + ' · ' + source.revision.slice(0, 12), [
      ['模拟范围', '全部文本、文件、工具结果、用量和采集时刻均为合成数据；未登录、未调用付费模型、未安装扩展。'],
      ['源码', source.repository + ' · ' + source.localPath],
      ['更新方式', '原工作树有用户修改，已 fetch 更新引用；只读 ' + source.revision + '，没有覆盖原工作树。'],
      ['会话与事件', 'Session v3 的 id/parentId 树、message、custom_message、compaction；AgentEvent 的 turn 与 tool_execution 事件。采集时间属于演示外层 envelope，不冒充原生时间字段。'],
      ['工具与文件', 'read.path，edit.edits 的精确替换，write.content；错误取自 ToolResultMessage.isError，edit 的 diff/patch 取自 details。'],
      ['上下文', '按系统 sections、工具声明、用户、补充、Skill、助手和工具结果独立估算可见文本；不是服务商精确 token。压缩遵循 firstKeptEntryId 与 systemMessage。'],
      ['技能', 'catalog 是可见目录；显式 <skill name location> 是命令展开后的用户消息；读取 SKILL.md 是材料读取。均不证明遵守或因果影响。'],
      ['子代理', '当前 Pi README 明确默认不内置 sub-agents；仓库有示例扩展，本图没有安装或伪造原生子代理。'],
      ['边界', '隐藏思考、图片 tokens、服务商序列化未计入。模型窗口未知，不画虚构容量占比。历史仅有工具 durationMs 时，不把结果生成时刻倒推为精确执行起点。'],
    ].map(([label, value]) => '<div class="source-row"><span>' + esc(label) + '</span>' + esc(value) + '</div>').join(''));
  };
  const piContextBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    piContextBase(); const region = $('geist-context-overview');
    if (region.dataset.pi) return; region.dataset.pi = 'true';
    region.querySelector('h2').innerHTML = '模拟请求输入 <small>Usage 字段示例 · 来源另作估算</small>';
    region.querySelector('.geist-context-total>span').textContent = '模拟用量';
    region.querySelector('.geist-context-total>div>span').textContent = ' tokens · 模型窗口未指定';
    const meter = region.querySelector('.geist-context-meter'); meter.style.display = 'block'; meter.setAttribute('aria-label', '模拟可见内容的来源构成；不表示模型容量占用');
    region.querySelector('.geist-context-occupied').style.width = '100%';
    const note = document.createElement('p'); note.className = 'review-quiet'; note.style.cssText = 'font-size:11px;margin:6px 0 0'; note.textContent = '色条表示可见来源的构成比例；模型窗口未指定。全部数据均为模拟。'; region.append(note);
  };
  geistShowCurrentSource = function(key, summary) {
    const c = geistContextCategory(key), item = summary.categories.find(i => i.key === key);
    openDrawer(c.label, 'Pi 模拟 · 可见文本估算', '<p class="review-explain">约 ' + piNumber(item?.value) + ' tokens 的文本估算量。按当前保留的 Session v3 消息、system sections 和工具声明归类；中文字符计 1，其余字符除以 4。</p><p class="review-quiet">目录、技能正文与工具结果分别识别；未包含隐藏思考、图片或服务商序列化。这些数值是演示，不是你的真实会话。</p>');
  };
  reviewOpenContextSources = function(key = 'system') { geistShowCurrentSource(key, contextOverview(null, null, reviewContextData.current)); };
  reviewOpenContext = function(number) {
    const row = reviewContextMap.get(number);
    const changed = row ? CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after > 0 : row.parts[c.key].delta !== 0) : [];
    openDrawer('第 ' + number + ' 轮 · 模拟来源变化', 'Pi 可见文本估算 · 零变化来源已省略', '<p class="review-explain">每个步骤对应一次 Pi assistant turn 与随后的工具结果。柱形比较请求前可见文本；不等同于服务商精确 token。</p>' + (changed.length ? changed.map(c => '<div class="source-row"><span>' + c.label + '</span>末次 ≈' + piNumber(row.parts[c.key].after) + (row.isBaseline ? '' : ' · 变化 ' + (row.parts[c.key].delta > 0 ? '+' : '') + piNumber(row.parts[c.key].delta)) + '</div>').join('') : '<p>没有记录可比较的来源变化。</p>'));
  };
  reviewOpenCompaction = function(seqs) {
    const entries = reviewContextData.boundaries.filter(e => seqs.includes(e.seq));
    openDrawer('Pi 模拟压缩', 'Session v3 · compaction', entries.map(e => '<div class="source-row"><span>第 ' + e.turn + ' 轮 · tokensBefore=' + e.tokensBefore + '（模拟值）</span>' + esc(e.summary) + '<p>firstKeptEntryId=' + esc(e.firstKeptEntryId) + '；按压缩检查点恢复 systemMessage，再保留指定范围。tokensBefore 不是本次实际节省量。</p></div>').join(''));
  };
  const piCaptionBase = geistArrangeCaption;
  const piSource = document.createElement('button'); piSource.className = 'geist-text-action quiet'; piSource.textContent = 'Pi 模拟依据 ↗'; piSource.onclick = showSource;
  geistArrangeCaption = function() { piCaptionBase(); $('geist-legend')?.append(piSource); $('graph-caption').querySelectorAll('.review-overlay-caption').forEach(el => { if (/上下文/.test(el.textContent)) el.innerHTML = '来源估算 <b>模拟 · ↑增 ↓减</b>'; }); };
  const piChangeBase = reviewOpenChange;
  const piSummaryBase = reviewRenderStepSummary;
  reviewRenderStepSummary = function(t, step) {
    piSummaryBase(t, step);
    $('step-panel').querySelectorAll('[data-insight-change]').forEach(button => {
      if (step.calls.find(c => c.seq === Number(button.dataset.insightChange))?.nativeName === 'write') button.textContent = '查看写入内容 ↗';
    });
  };
  reviewOpenChange = function(t, step, fact, nested = false) {
    const call = step.calls.find(c => c.seq === fact.seq);
    if (call?.nativeName !== 'write') return piChangeBase(t, step, fact, nested);
    reviewOpenDetail({ title: '模拟写入内容', subtitle: fact.target + ' · Pi write.content', html: '<p class="review-quiet">展示写入参数中的完整内容。Pi write 不直接返回旧文件快照，不能据此虚构旧文件差异。</p>' + block({ text: fact.preview.after, omitted: 0 }) }, nested);
  };
  const piStats = session.turns.map(t => ({ turn: t.number, steps: t.steps.map(s => {
    const calls = s.calls.filter(c => /capture$/.test(c.timingSource) && c.end != null), spans = calls.map(c => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
    let coverage = 0, end = -Infinity; for (const [a, b] of spans) { coverage += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    return { turn: t.number, step: s.number, toolWall: calls.length ? coverage : null, tool: calls.reduce((n, c) => n + c.durationMs, 0), calls: calls.map(c => ({ seq: c.seq, startedAt: c.start, endedAt: c.end })), tools: calls.map(c => ({ name: c.name, count: 1 })), toolPending: 0 };
  }) }));
  geistStatsByStep.clear(); for (const t of piStats) for (const s of t.steps) geistStatsByStep.set(t.turn + ':' + s.step, s);
  geistOpenTiming = function(number, stepNumber) {
    const step = brRound(number).steps.find(s => s.number === stepNumber);
    openDrawer('Pi 模拟执行时间', '全部为合成的采集时间与 durationMs', '<p>此步骤模拟时长 ' + preciseTime(step.end - step.start) + '；包含一次助手响应及其工具操作。实际接入时，tool_execution_start/end 由采集器关联 toolCallId，原生 durationMs 作为独立执行计量保留。</p>');
  };
