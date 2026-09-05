// dsh-analysis-view — 常驻 client 插件(分析 tab)。
// 镜像:会话内动态插件 tqan-3/pkg-8。web profile 的 loader 约定:client 文件
// 必须以 __ModuleLoader__.load({ id, factory }) 自注册,factory 接收 require
// (react 等外部模块必须经 require 获取,不能引用全局),返回 { inject, apply }
// 描述符(同 dsh-runtime-seam / dsh-approval-hotkeys 的打包形态)。
window.__ModuleLoader__.load({
  id: "dsh-analysis-view",
  factory: (require) => {
    const React = require("react");

    function AnalysisSnapshotBuilder() {
      this.counts = { nodes: 0, upserts: 0 };
      this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
    }
    AnalysisSnapshotBuilder.prototype.replace = function (input) {
      const nodes = (input && input.nodes) || [];
      this.counts.nodes = nodes.length;
      this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
      return this.snap;
    };
    AnalysisSnapshotBuilder.prototype.apply = function (input) {
      const upserts = (input && input.upserts) || [];
      this.counts.nodes += upserts.length;
      this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: this.counts };
      return this.snap;
    };
    AnalysisSnapshotBuilder.prototype.snapshot = function () { return this.snap; };

    function digestView(props) {
      const useTrajectory = props && props.useTrajectory;
      let snap = null;
      try { snap = useTrajectory ? useTrajectory((s) => s) : null; } catch { snap = null; }
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];
      const turnSet = new Set(); let toolCalls = 0, errors = 0;
      const names = {}; const errFirst = []; const nameSeq = [];
      for (const n of nodes) {
        const k = n && n.kind;
        if (k === 'assistant' && n.turn > 0) turnSet.add(n.turn);
        if (k === 'tool-result') { toolCalls++; if (n.error || n.isError) { errors++; if (errFirst.length < 4) errFirst.push({ kind: (n.error && (n.error.name || n.error.code)) || n.name || 'error', seq: n.seq }); } }
        if (k === 'assistant' && Array.isArray(n.blocks)) for (const b of n.blocks) if (b && b.kind === 'tool-call' && b.name) { const nm = b.name; names[nm] = (names[nm] || 0) + 1; nameSeq.push({ name: nm, seq: n.seq }); }
      }
      const turns = turnSet.size;
      const retry = [];
      for (let i = 1; i < nameSeq.length; i++) if (nameSeq[i - 1].name === nameSeq[i].name) retry.push(nameSeq[i - 1].seq + '→' + nameSeq[i].seq);
      const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => name + '×' + count);
      const sub = { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' };
      const row = (k, v) => React.createElement('div', { key: k, style: { padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)' } }, React.createElement('span', { style: { fontSize: 13 } }, k), React.createElement('span', { style: sub }, '  ' + v));
      const kpi = [['turns', String(turns)], ['tool calls', String(toolCalls)], ['errors', String(errors)]];
      return React.createElement('div', { style: { padding: 12, overflow: 'auto', minHeight: 0 } }, [
        React.createElement('h3', { key: 'h', style: { margin: '0 0 4px', fontSize: 14 } }, '分析', React.createElement('span', { style: sub }, '  ·  turns/tools/errors v1 (轨迹投影)')),
        React.createElement('div', { key: 'kpi', style: { display: 'flex', gap: 14, margin: '8px 0', flexWrap: 'wrap' } }, kpi.map(([k, v]) => React.createElement('span', { key: k, style: { fontSize: 13 } }, React.createElement('b', { style: { marginRight: 4 } }, v), k))),
        row('tools v1', toolCalls + ' 次 · top: ' + (top.join(' · ') || '无')),
        row('errors v1', errors + ' 个;首现: ' + (errFirst.map((e) => e.kind + '@' + e.seq).join(', ') || '无')),
        row('现象区', retry.length ? 'retry v1(同名,去参数) ×' + retry.length + ';样例 ' + retry.slice(0, 4).join(', ') + '. 同参检测需 host 分析器。' : '无候选。同参检测需 host 分析器。'),
        React.createElement('div', { key: 'foot', style: Object.assign({}, sub, { marginTop: 8 }) }, '确定性列,非模型生成; 复跑: node analyzers/run-digest.mjs <session.zstd>')
      ]);
    }

    return {
      inject: ["slots", "uiConversation"],
      apply(ctx) {
        ctx.uiConversation.views.register({ target: 'analysis', create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
        const s = ctx.slots;
        if (!s) return;
        s.inject('conversation.view', () => s.register({
          name: 'conversation.view',
          id: 'analysis',
          order: 20,
          label: () => '分析',
          children: {},
          inject: (sessionId) => {
          const target = ctx.uiConversation.binding(sessionId).target('trajectory');
          return { hooks: { trajectory: { getSnapshot: () => target.getSnapshot(), subscribe: (l) => target.subscribe(l) } } };
        }
        }, digestView));
      },
    };
  },
});
