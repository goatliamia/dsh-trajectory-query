  // Claude local transcripts supply message usage, not a reconstructed request.
  const claudeHeader = header;
  header = function() {
    claudeHeader();
    $('session-name').textContent = 'CLAUDE CODE · 本地记录';
    $('session-facts').innerHTML = session.totals.turns + ' 轮<span>/</span>' + session.totals.steps + ' 条助手记录<span>/</span>' + session.totals.calls + ' 次工具调用';
  };
  showSource = function() {
    const rows = [
      ['来源', data.evidence.source?.file || '显式选定的本地 transcript'],
      ['单位', '一条可见助手记录为一步；同一消息可含多条记录，用量按消息 ID 只计一次。工具调用与结果按 ID 配对。'],
      ['用量', '读取记录中的 input、output、cache read 和 cache creation tokens；缺失字段保持未知。'],
      ['上下文', '未记录完整请求组成、工具定义和隐藏上下文，不能据此重建请求或来源比例。'],
      ['覆盖', '仅当前文件中的可见内容；未重建分支与子代理记录。时间起止缺失时不推算耗时。'],
    ];
    openDrawer('Claude Code 数据依据', '本地 transcript · 只读', rows.map(([k, v]) => '<div class="source-row"><span>' + esc(k) + '</span>' + esc(v) + '</div>').join(''));
  };
  const claudeValue = n => Number.isFinite(n) ? String(n) : '未记录';
  geistRenderContextOverview = function() {
    const region = $('geist-context-overview'), latest = reviewContextData.usage.at(-1)?.usage;
    region.innerHTML = '<header><h2>请求上下文 <small>组成未记录</small></h2></header><p class="review-quiet">Claude transcript 未提供完整请求组成或模型窗口，无法显示来源比例。</p>' + (latest ? '<p class="review-quiet">最近一条已记录用量：输入 ' + claudeValue(latest.input) + ' · 缓存读取 ' + claudeValue(latest.cacheRead) + ' · 缓存创建 ' + claudeValue(latest.cacheWrite) + ' · 输出 ' + claudeValue(latest.output) + ' tokens。</p>' : '<p class="review-quiet">用量未记录。</p>');
  };
  reviewOpenContext = function(number) {
    const rows = reviewContextData.usage.filter(u => u.turn === number);
    openDrawer('第 ' + number + ' 轮 · Claude 用量', '原生消息记录', rows.length ? rows.map(({ usage: u }) => '<div class="source-row"><span>消息用量</span>输入 ' + claudeValue(u.input) + ' · 缓存读取 ' + claudeValue(u.cacheRead) + ' · 缓存创建 ' + claudeValue(u.cacheWrite) + ' · 输出 ' + claudeValue(u.output) + ' tokens</div>').join('') : '<p>用量未记录。</p>');
  };
  reviewOpenContextSources = function() { showSource(); };
  geistShowCurrentSource = function() { showSource(); };
  reviewOpenCompaction = function() { openDrawer('上下文压缩', 'Claude Code', '<p>当前记录未重建压缩后的请求组成。</p>'); };
  geistOpenTiming = function() { openDrawer('时间', 'Claude Code transcript', '<p>工具开始与结束时间未完整记录，无法计算耗时。</p>'); };
  geistStatsByStep.clear();
  for (const t of session.turns) for (const s of t.steps) geistStatsByStep.set(t.number + ':' + s.number, { turn: t.number, step: s.number, model: null, toolWall: null, tool: null, calls: [], tools: s.calls.map(c => ({ name: c.name, count: 1 })), toolPending: s.calls.filter(c => c.status === 'unknown').length });
  const claudeCaption = geistArrangeCaption;
  geistArrangeCaption = function() {
    claudeCaption();
    $('review-all-retries')?.remove();
    $('graph-caption')?.querySelectorAll('.review-overlay-caption').forEach(el => { if (/上下文/.test(el.textContent)) el.remove(); });
    if (!$('claude-source-link')) { const button = document.createElement('button'); button.id = 'claude-source-link'; button.className = 'geist-text-action quiet'; button.textContent = 'Claude 数据依据 ↗'; button.onclick = showSource; $('geist-legend')?.append(button); }
  };
  const claudeStyle = document.createElement('style');
  claudeStyle.textContent = '#geist-context-overview .study-source-actions{display:none}'; document.head.append(claudeStyle);
