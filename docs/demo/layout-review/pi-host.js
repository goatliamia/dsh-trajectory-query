  // Pi uses the common objects and renderer; native provenance stays explicit.
  const piSynthetic = data.synthetic === true, piPrefix = piSynthetic ? '模拟' : '';
  const piEvidence = data.evidence, piSource = piEvidence.source || {};
  const piNumber = value => value == null ? '未记录' : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(Math.round(value));
  const piHeaderBase = header;
  header = function() { piHeaderBase(); $('review-state').textContent = session.totals.turns + ' 轮' + (piSynthetic ? '模拟记录' : '原生记录'); };
  showSource = function() {
    openDrawer('Pi 数据依据', piSynthetic ? '按源码格式生成的合成样本' : 'Session v3 · 只读原生记录', [
      ['来源', piSynthetic ? '全部内容、时长、用量与结果均为模拟；没有调用模型。' : piSource.file || '当前 SessionManager 选中分支'],
      ['版本依据', piSource.revision ? (piSource.version || '') + ' · ' + piSource.revision : 'Pi Session v3；消息、分支与工具结果保留原生身份。'],
      ['步骤', '一次 assistant cycle 与随后的工具结果；不同于 Codex 的可见动作。'],
      ['用量', '直接读取 AssistantMessage.usage。input、cacheRead、cacheWrite 相加得到该次输入；来源分色另作可见文本估算。'],
      ['上下文', '按 parentId 分支、压缩的 firstKeptEntryId/systemMessage 和追加式 context_edit 回放；扩展 custom 状态不当作模型输入。'],
      ['文件与命令', '原生 read/edit/write 与 bash 的字面读取、搜索、执行分别保留。脚本里的读取意图不证明每个条件分支都执行。'],
      ['时间', '有 tool_execution_start/end 采集时按 toolCallId 配对；只有原生 durationMs 时单独显示执行计量，不倒推起点。扩展仅保留近期计时元数据。'],
      ['工具与 Skill', 'SDK 当前目录与历史声明分别取证；Skill 目录、明确引用、正文读取分开，不推断影响区间。'],
      ['边界', '可见文本估算不包含隐藏思考、媒体 tokens 和服务商序列化；未记录容量不画虚构比例。子代理仅展示明确记录的扩展活动。'],
    ].map(([label, value]) => '<div class="source-row"><span>' + esc(label) + '</span>' + esc(value) + '</div>').join(''));
  };
  const piContextBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    piContextBase(); const region = $('geist-context-overview'); if (region.dataset.pi) return; region.dataset.pi = 'true';
    region.querySelector('h2').innerHTML = piSynthetic ? '模拟请求输入 <small>Usage 示例 · 来源另作估算</small>' : '最近请求输入 <small>Pi 实报用量 · 来源另作估算</small>';
    const pressure = geistContextSnapshot?.pressure;
    if (piSynthetic || !pressure?.contextWindow) {
      region.querySelector('.geist-context-total>span').textContent = piSynthetic ? '模拟用量' : '容量未记录';
      region.querySelector('.geist-context-total>div>span').textContent = ' tokens · 来源构成见分色';
      region.querySelector('.geist-context-occupied').style.width = '100%';
    }
    region.querySelector('.geist-context-meter').setAttribute('aria-label', '可见文本来源构成估算；实际用量单独读取 Pi usage');
    const note = document.createElement('p'); note.className = 'review-quiet'; note.style.cssText = 'font-size:11px;margin:6px 0 0';
    note.textContent = piSynthetic ? '全部数据均为模拟；色条展示可见来源比例。' : '总数取自 Pi 实报输入；分色与趋势为可见文本估算。'; region.append(note);
  };
  geistShowCurrentSource = function(key, summary) {
    const category = geistContextCategory(key), item = summary.categories.find(i => i.key === key);
    openDrawer(category.label, 'Pi ' + piPrefix + ' · 可见文本估算', '<p class="review-explain">约 ' + piNumber(item?.value) + ' tokens 的文本估算量，来自当前保留的 Session v3 内容。中文字符计 1，其余字符除以 4；未包含隐藏思考、图片或服务商序列化。</p>');
  };
  reviewOpenContextSources = function(key = 'system') { geistShowCurrentSource(key, contextOverview(null, null, reviewContextData.current)); };
  reviewOpenContext = function(number) {
    const row = reviewContextMap.get(number), changed = row ? CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after > 0 : row.parts[c.key].delta !== 0) : [];
    openDrawer('第 ' + number + ' 轮 · ' + piPrefix + '来源变化', 'Pi 可见文本估算', '<p class="review-explain">比较请求前可见材料，不等同于服务商精确 token。</p>' + changed.map(c => '<div class="source-row"><span>' + c.label + '</span>末次 ≈' + piNumber(row.parts[c.key].after) + (row.isBaseline ? '' : ' · 变化 ' + reviewSigned(row.parts[c.key].delta)) + '</div>').join(''));
  };
  reviewOpenCompaction = function(seqs) {
    openDrawer('Pi ' + piPrefix + '压缩', 'Session v3 · compaction', reviewContextData.boundaries.filter(e => seqs.includes(e.seq)).map(e => '<div class="source-row"><span>第 ' + e.turn + ' 轮 · tokensBefore=' + piNumber(e.tokensBefore) + '</span>' + esc(e.summary) + '<p>firstKeptEntryId=' + esc(e.firstKeptEntryId) + '；压缩前记录量不当作实际节省量。</p></div>').join(''));
  };
  const piCaptionBase = geistArrangeCaption;
  const piSourceButton = document.createElement('button'); piSourceButton.className = 'geist-text-action quiet'; piSourceButton.textContent = 'Pi 数据依据 ↗'; piSourceButton.onclick = showSource;
  geistArrangeCaption = function() { piCaptionBase(); $('geist-legend')?.append(piSourceButton); };
  const piChangeBase = reviewOpenChange, piSummaryBase = reviewRenderStepSummary;
  reviewRenderStepSummary = function(t, step) { piSummaryBase(t, step); $('step-panel').querySelectorAll('[data-insight-change]').forEach(button => { if (step.calls.find(c => c.seq === Number(button.dataset.insightChange))?.nativeName === 'write') button.textContent = '查看写入内容 ↗'; }); };
  reviewOpenChange = function(t, step, fact, nested = false) {
    if (step.calls.find(c => c.seq === fact.seq)?.nativeName !== 'write') return piChangeBase(t, step, fact, nested);
    reviewOpenDetail({ title: piPrefix + '写入内容', subtitle: fact.target + ' · Pi write.content', html: '<p class="review-quiet">展示完整写入参数；原生结果没有旧文件快照，不据此虚构完整差异。</p>' + block({ text: fact.preview.after, omitted: 0 }) }, nested);
  };
  const piKnownSum = values => { const known = values.filter(n => Number.isFinite(n) && n >= 0); return known.length ? known.reduce((n, v) => n + v, 0) : null; };
  geistStatsByStep.clear();
  for (const t of session.turns) for (const s of t.steps) {
    const calls = s.calls.filter(c => /capture$/.test(c.timingSource) && c.end != null), spans = calls.map(c => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
    let coverage = 0, end = -Infinity; for (const [a, b] of spans) { coverage += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    geistStatsByStep.set(t.number + ':' + s.number, { turn: t.number, step: s.number, model: s.assistantDurationMs, toolWall: calls.length ? coverage : null, tool: piKnownSum(s.calls.map(c => c.durationMs)), calls: calls.map(c => ({ seq: c.seq, startedAt: c.start, endedAt: c.end })), tools: s.calls.map(c => ({ name: c.name, count: 1 })), toolPending: s.calls.filter(c => c.status === 'unknown').length });
  }
  geistOpenTiming = function(number, stepNumber) {
    const step = brRound(number).steps.find(s => s.number === stepNumber);
    openDrawer('Pi ' + piPrefix + '时间', '原生 durationMs 与采集起止分别保留', '<p>助手原生耗时：' + (step.assistantDurationMs == null ? '未记录' : preciseTime(step.assistantDurationMs)) + '。</p><p>工具只有采集起止时才展示执行区间；没有把历史顺序或结果时刻当成工具起点。</p>');
  };
