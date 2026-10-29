  reviewOpenFileHistory = function(file, focusOperations = null) {
    const history = fileChangeHistory(reviewFileOperations, file.id);
    if (!history) return;
    const originTurn = focusOperations?.[0]?.turn ?? (view === 'path' ? turn().number : null);
    const hasChanges = history.changeRounds.length > 0;
    const state = { reads: !hasChanges, open: new Set(originTurn ? [originTurn] : []) };
    const factFor = op => reviewContextData.callFacts?.[op.seq];
    const changeName = op => op.tool === 'write' ? '写入' : '修改';
    const operationsOf = round => round.operations.filter(op => state.reads || op.kind === 'change');
    const visibleRounds = () => history.rounds.filter(round => operationsOf(round).length);
    const counts = round => {
      const operations = operationsOf(round), failed = operations.filter(op => op.status === 'error').length, pending = operations.filter(op => op.status !== 'returned' && op.status !== 'error').length;
      const direct = operations.filter(op => op.kind === 'read' && op.access !== 'match' && op.status === 'returned').length;
      const matches = operations.filter(op => op.access === 'match' && op.status === 'returned').length;
      return [round.changes ? round.changes + ' 次写入/修改' : '', failed ? failed + ' 次受阻' : '', state.reads && direct ? direct + ' 次直接读取' : '', state.reads && matches ? matches + ' 次匹配片段' : '', pending ? pending + ' 次待确认' : ''].filter(Boolean).join(' · ');
    };
    const excerpt = fact => {
      if (!fact?.preview) return '';
      const before = new Set(fact.preview.before.split(/\r?\n/).map(line => line.trim()));
      const line = fact.preview.after.split(/\r?\n/).map(line => line.trim()).find(line => line && !before.has(line));
      return line ? '<code class="geist-history-excerpt" title="' + esc(line) + '">' + esc(shorten(line, 120)) + '</code>' : '';
    };
    const renderOperation = op => {
      const fact = factFor(op), planned = op.status !== 'returned' || fact?.tone === 'bad' || fact?.tone === 'unknown';
      const outcome = fact?.outcome || (op.status === 'returned' ? '工具已返回' : op.status === 'error' ? '操作受阻' : '结果未记录');
      return '<div class="geist-history-operation" data-history-operation="' + op.seq + '"><div class="geist-history-operation-title"><strong class="' + (op.kind === 'read' ? 'read' : op.status === 'error' ? 'failed' : 'change') + '">' + (op.access === 'match' ? '匹配片段' : op.kind === 'read' ? '读取' : changeName(op)) + '</strong><span>第 ' + op.step + ' 步</span>' + (op.status === 'error' ? '<span class="failed">受阻</span>' : '') + '</div><p>' + esc(outcome) + '</p>' +
        (!planned ? excerpt(fact) : '') + '<div class="geist-history-operation-links">' +
        (fact?.preview ? '<button class="geist-text-action" data-history-diff="' + op.seq + '">' + (planned ? '查看原计划' : '查看改动片段') + ' ↗</button>' : '') +
        '<button class="geist-text-action quiet" data-history-step="' + op.seq + '">定位到这一步 ↗</button></div></div>';
    };
    const render = () => {
      const rounds = visibleRounds(), x = i => rounds.length < 2 ? 24 : 24 + i / (rounds.length - 1) * 572;
      const hitRadius = Math.min(9, rounds.length < 2 ? 9 : 286 / (rounds.length - 1));
      const line = '<svg class="geist-history-map" viewBox="0 0 620 52" role="group" aria-label="文件全程记录，按轮次顺序排列"><path d="M24 17H596" class="geist-history-rail"/>' +
        rounds.map((round, i) => '<g role="button" tabindex="0" data-history-jump="' + round.turn + '" aria-label="第 ' + round.turn + ' 轮，' + counts(round) + '"><title>第 ' + round.turn + ' 轮 · ' + counts(round) + '</title><circle cx="' + x(i) + '" cy="17" r="' + hitRadius + '" fill="transparent"/><circle cx="' + x(i) + '" cy="17" r="' + Math.min(hitRadius, round.turn === originTurn ? 4 : 3) + '" class="geist-history-dot ' + (round.failed ? 'failed' : round.changes ? 'change' : 'read') + (round.turn === originTurn ? ' current' : '') + '"/></g>').join('') +
        '<text x="24" y="43">第 ' + rounds[0].turn + ' 轮</text>' + (rounds.length > 1 ? '<text x="596" y="43" text-anchor="end">第 ' + rounds.at(-1).turn + ' 轮</text>' : '') + '</svg>';
      const matches = history.reads.filter(op => op.access === 'match').length;
      return '<div class="geist-history-overview"><p><strong>' + (hasChanges ? history.changeRounds.length + ' 轮涉及写入/修改' : history.rounds.length + ' 轮有文件记录') + '</strong><span>' + (history.changes.length ? '修改已返回 ' + history.changes.length + ' 次 · ' : '') + '直接读取 ' + (history.reads.length - matches) + ' 次' + (matches ? ' · 搜索片段 ' + matches + ' 次' : '') + (history.failed.length ? ' · 受阻 ' + history.failed.length + ' 次' : '') + '</span></p>' + line +
        '<div class="geist-history-controls"><span>全程文件工具记录 · 按轮次顺序</span>' + (originTurn && rounds.some(r => r.turn === originTurn) ? '<button class="geist-text-action" data-history-jump="' + originTurn + '">定位第 ' + originTurn + ' 轮</button>' : '') +
        '<button id="review-history-reads" class="geist-text-action"' + (!hasChanges ? ' disabled' : '') + ' aria-pressed="' + state.reads + '">' + (state.reads ? '✓ 包含读取' : '包含读取') + '</button></div></div>' +
        '<div class="geist-history-rounds">' + rounds.map(round => '<details class="geist-history-round" data-history-tone="' + (operationsOf(round).some(op => op.status === 'error') ? 'failed' : round.changes ? 'change' : 'read') + '" data-history-round="' + round.turn + '"' + (state.open.has(round.turn) ? ' open' : '') + '><summary><strong>第 ' + round.turn + ' 轮</strong><span>' + counts(round) + '</span>' + (round.turn === originTurn ? '<em>图中位置</em>' : '') + '</summary><div class="geist-history-round-content">' + operationsOf(round).map(renderOperation).join('') + '</div></details>').join('') + '</div>' +
        '<p class="review-file-evidence-note">按本会话中同一路径的文件工具记录串联。差异入口展示各次替换片段；整文件首尾对比仍需要历史文件快照。</p>';
    };
    function jump(number) {
      const section = $('review-detail-body').querySelector('[data-history-round="' + number + '"]');
      if (!section) return;
      state.open.add(number); section.open = true;
      section.scrollIntoView({ block: 'start', behavior: 'auto' });
      section.querySelector('summary').focus({ preventScroll: true });
    }
    const detail = { title: history.label + ' · 全程变化', subtitle: history.path, html: '', bind: () => {
      const body = $('review-detail-body');
      body.querySelectorAll('[data-history-round]').forEach(section => {
        const number = Number(section.dataset.historyRound); section.open = state.open.has(number);
        section.ontoggle = () => section.open ? state.open.add(number) : state.open.delete(number);
      });
      body.querySelectorAll('[data-history-jump]').forEach(el => {
        el.onclick = () => jump(Number(el.dataset.historyJump));
        if (el.tagName.toLowerCase() === 'g') el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(); } };
      });
      $('review-history-reads').onclick = () => {
        if (!hasChanges) return;
        const headerBottom = body.querySelector('.geist-history-overview').getBoundingClientRect().bottom;
        const sections = [...body.querySelectorAll('[data-history-round]')];
        const anchor = sections.find(section => section.open && section.getBoundingClientRect().bottom > headerBottom && section.getBoundingClientRect().top < body.getBoundingClientRect().bottom) ||
          sections.find(section => section.getBoundingClientRect().top >= headerBottom);
        const anchorTurn = anchor?.dataset.historyRound;
        state.reads = !state.reads; detail.scroll = body.scrollTop; detail.html = render(); reviewPaintDetail();
        const restored = anchorTurn && body.querySelector('[data-history-round="' + anchorTurn + '"]');
        if (restored) restored.scrollIntoView({ block: 'start', behavior: 'auto' });
        $('review-history-reads').focus({ preventScroll: true });
      };
      body.querySelectorAll('[data-history-diff]').forEach(el => el.onclick = () => {
        const op = history.operations.find(o => o.seq === Number(el.dataset.historyDiff)), t = brRound(op.turn), step = t?.steps.find(s => s.number === op.step);
        if (step) reviewOpenChange(t, step, factFor(op), true);
      });
      body.querySelectorAll('[data-history-step]').forEach(el => el.onclick = () => {
        const op = history.operations.find(o => o.seq === Number(el.dataset.historyStep)); reviewCloseDetail();
        if (view === 'path' && turn().number === op.turn) reviewJumpToStep(turn(), op.step); else reviewEnterPath(op.turn, op.step);
      });
    } };
    detail.html = render(); reviewOpenDetail(detail);
  };
