  const geistContextSnapshot = data.officialStats?.context;
  const geistContextNumber = n => n == null ? '未记录' : n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  function geistContextCategory(key) {
    return CONTEXT_CATEGORIES.find(c => c.key === key) || { key: 'messages', label: '对话内容', color: 'var(--chart-assistant)' };
  }
  function geistShowCurrentSource(key, summary) {
    const category = geistContextCategory(key), item = summary.categories.find(c => c.key === key);
    const explanations = {
      system: '模型运行所需的系统提示。', tools: '供模型选择和调用的工具说明与参数结构。',
      user: '用户直接发送的消息。', inject: '由运行环境补充的内容，例如环境信息、状态与通知。',
      skill: '通过技能来源进入上下文的内容。', assistant: '仍保留在上下文中的助手回复与工具调用。',
      tool: '工具返回后仍保留在上下文中的内容。', messages: '除系统提示和工具定义之外，当前保留的消息内容。',
    };
    openDrawer(category.label, '最新记录的上下文构成', '<div class="review-context-headline"><strong>≈' + geistContextNumber(item?.value) + '</strong><span>tokens · 约占构成 ' + (item?.share < .1 ? '不足 0.1' : item?.share.toFixed(1)) + '%</span></div><p class="review-explain">' + explanations[key] + '</p><p class="review-quiet">上方显示当前保留量；路径中的柱形显示每轮或每步的增减，使用相同颜色。</p><p class="review-quiet">总占用直接读取官方 contextPressure；来源是估算构成，不与总占用直接相加。' + (summary.detailed ? '细分沿用已安装 Context 插件的现有投影；未提供细分时展示官方的系统、工具、消息三类。' : '当前为官方 contextBreakdown 的三类构成。') + '</p>');
  }
  function geistRenderContextOverview() {
    let region = $('geist-context-overview');
    if (!region) { region = document.createElement('section'); region.id = 'geist-context-overview'; region.className = 'geist-context-overview'; region.setAttribute('aria-label', '当前上下文总览'); $('graph-scroll').before(region); }
    if (region.dataset.ready) return;
    region.dataset.ready = 'true';
    const summary = contextOverview(geistContextSnapshot?.pressure, geistContextSnapshot?.breakdown, reviewContextData.current);
    const route = reviewContextData.route;
    const model = route?.model ? (route.provider ? route.provider + ' · ' : '') + route.model + (route.reasoningEffort ? ' (' + route.reasoningEffort + ')' : '') : '';
    const share = value => value < .1 ? '<0.1%' : value.toFixed(1) + '%';
    const name = item => geistContextCategory(item.key).label;
    region.innerHTML = '<header><h2>当前上下文 <small title="此 Demo 的最新会话快照；查看历史步骤不会改写当前总量">第 ' + session.turns.at(-1).number + ' 轮末</small></h2><span class="geist-context-model">' + esc(model) + '</span></header>' +
      '<div class="geist-context-total"><div><strong>' + geistContextNumber(summary.used) + '</strong><span>' + (summary.capacity ? ' / ' + geistContextNumber(summary.capacity) + ' tokens' : ' tokens · 容量未记录') + '</span></div><span>' + (summary.percent == null ? '占用未记录' : '<b>' + summary.percent.toFixed(1) + '%</b> 已用') + '</span></div>' +
      '<div class="geist-context-meter" role="img" aria-label="' + esc(summary.percent == null ? '上下文占用未记录' : '上下文已用 ' + summary.used + ' / ' + summary.capacity + ' tokens，分段按估算来源比例展示') + '">' +
      '<div class="geist-context-occupied" style="width:' + (summary.fill ?? 0) + '%">' + summary.categories.map(item => '<span style="width:' + item.share + '%;background:' + geistContextCategory(item.key).color + '" title="' + esc(name(item) + ' ≈' + geistContextNumber(item.value) + ' tokens') + '"></span>').join('') + '</div></div>' +
      '<div class="geist-context-sources" aria-label="估算来源构成，与路径颜色一致">' + summary.categories.map(item => '<button data-current-source="' + item.key + '" title="' + esc(name(item) + '，约占构成 ' + share(item.share) + '；点击查看说明') + '"><i style="background:' + geistContextCategory(item.key).color + '"></i><span>' + name(item) + '</span><b>≈' + geistContextNumber(item.value) + '</b></button>').join('') + '</div>';
    region.querySelectorAll('[data-current-source]').forEach(el => el.onclick = () => geistShowCurrentSource(el.dataset.currentSource, summary));
  }
