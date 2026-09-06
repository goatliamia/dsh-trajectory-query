// dsh-analysis-view — 常驻 client 插件(分析 tab)。
// web profile 的 loader 约定:client 文件必须以 __ModuleLoader__.load({ id, factory })
// 自注册,factory 接收 require(react 等外部模块必须经 require 获取,不能引用全局),
// 返回 { inject, apply } 描述符(同 dsh-runtime-seam / dsh-approval-hotkeys 的打包形态)。
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

    const sub = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #666)" };
    const chip = { display: "inline-block", margin: "0 4px", padding: "0 5px", borderRadius: 4, background: "var(--dsw-alias-bg-layer-2, #ececec)", fontSize: 11, color: "var(--dsw-alias-label-secondary, #666)", cursor: "pointer", border: "0", fontFamily: "inherit" };

    function digestView(props) {
      const useTrajectory = props && props.useTrajectory;
      const openView = props && props.openView;
      let snap = null;
      try { snap = useTrajectory ? useTrajectory((s) => s) : null; } catch { snap = null; }
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];

      const turnSet = new Set();
      const turnTools = new Map();
      const nameSeq = [];
      const callIdBySeq = new Map();
      let toolCalls = 0, errors = 0;
      const errFirst = [];

      for (const n of nodes) {
        const k = n && n.kind;
        if (k === "assistant" && n.turn > 0) {
          turnSet.add(n.turn);
          if (Array.isArray(n.blocks)) for (const b of n.blocks) {
            if (b && b.kind === "tool-call" && b.name) {
              turnTools.set(n.turn, (turnTools.get(n.turn) || 0) + 1);
              nameSeq.push({ name: b.name, seq: n.seq, callId: b.callId });
              if (b.callId) callIdBySeq.set(n.seq, b.callId);
            }
          }
        }
        if (k === "tool-result") {
          toolCalls++;
          if (n.callId) callIdBySeq.set(n.seq, n.callId);
          if (n.error || n.isError) {
            errors++;
            if (errFirst.length < 5) errFirst.push({ kind: (n.error && (n.error.name || n.error.code)) || n.name || "error", seq: n.seq, callId: n.callId });
          }
        }
      }

      const turns = turnSet.size;
      let emptyTurns = 0;
      for (const t of turnSet) if (!(turnTools.get(t) > 0)) emptyTurns++;
      const maxT = Math.max(1, ...[...turnTools.values()]);

      const retry = [];
      for (let i = 1; i < nameSeq.length; i++) if (nameSeq[i - 1].name === nameSeq[i].name) retry.push({ ...nameSeq[i - 1], nextSeq: nameSeq[i].seq });

      const go = (callId) => () => { if (openView && callId) openView("trajectory", callId); };
      const chipBtn = (seq, callId) => React.createElement("button", { key: String(seq) + "-" + String(callId), onClick: go(callId), style: chip, title: openView ? "切换到轨迹" : "" }, String(seq));

      const factRow = (k, v) => React.createElement("div", { key: k, style: { padding: "5px 0", borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)" } }, React.createElement("span", { style: { fontSize: 13 } }, k), React.createElement("span", { style: sub }, "  " + v));

      const active = React.createElement("div", { key: "act", style: { margin: "8px 0" } }, [
        React.createElement("div", { key: "a", style: Object.assign({}, sub, { marginBottom: 4 }) }, "Turn 活动 (tool 调用密度 · 红=有错误)"),
        React.createElement("div", { key: "b", style: { display: "flex", alignItems: "flex-end", gap: 2, height: 56 } }, [...turnSet].sort((a, b) => a - b).map((t) => {
          const c = turnTools.get(t) || 0;
          const h = c ? Math.max(6, Math.round((c / maxT) * 44)) : 4;
          return React.createElement("div", { key: t, title: "turn " + t + " · " + c + " calls", style: { width: 8, height: h, background: "var(--dsw-alias-state-business-primary, #3b82f6)", borderRadius: 2 } });
        }))
      ]);

      const phenRows = [];
      phenRows.push(factRow("errors v1", errors + " 个; 首现: " + (errFirst.length ? errFirst.slice(0, 4).map((e) => React.createElement("span", { key: e.seq }, e.kind, chipBtn(e.seq, e.callId))) : "无")));
      phenRows.push(factRow("retry v1", (retry.length ? "疑似重复 ×" + retry.length + "; 样例(seq): " : "无候选。同参检测需 host 分析器。") + retry.slice(0, 4).map((r) => React.createElement("span", { key: r.seq }, chipBtn(r.seq, r.callId), "→", chipBtn(r.nextSeq, nameSeq.find((x) => x.seq === r.nextSeq)?.callId)))));
      phenRows.push(factRow("空转 turn", emptyTurns + " / " + turns + " 个 turn 没有工具调用(潜在空转)"));

      const kpi = [["turns", String(turns)], ["tool calls", String(toolCalls)], ["errors", String(errors)]];

      return React.createElement("div", { style: { padding: 12, overflow: "auto", minHeight: 0 } }, [
        React.createElement("h3", { key: "h", style: { margin: "0 0 4px", fontSize: 14 } }, "分析", React.createElement("span", { style: sub }, "  ·  turns/tools/errors v1 (轨迹投影)")),
        React.createElement("div", { key: "kpi", style: { display: "flex", gap: 14, margin: "8px 0", flexWrap: "wrap" } }, kpi.map(([k, v]) => React.createElement("span", { key: k, style: { fontSize: 13 } }, React.createElement("b", { style: { marginRight: 4 } }, v), k))),
        active,
        ...phenRows,
        React.createElement("div", { key: "open", style: { margin: "8px 0" } }, React.createElement("details", null, React.createElement("summary", { style: { fontSize: 12, cursor: "pointer" } }, "开放解读(消耗 tokens)"), React.createElement("div", { style: sub }, "占位:模型在半开放维度内解释,每条带 (session, seq) 引用。"))),
        React.createElement("div", { key: "foot", style: Object.assign({}, sub, { marginTop: 8 }) }, "确定性列,非模型生成; 复跑: node analyzers/run-digest.mjs <session.zstd>")
      ]);
    }

    return {
      inject: ["slots", "uiConversation"],
      apply(ctx) {
        ctx.uiConversation.views.register({ target: "analysis", create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
        const s = ctx.slots;
        if (!s) return;
        s.inject("conversation.view", () => s.register({
          name: "conversation.view",
          id: "analysis",
          order: 20,
          label: () => "分析",
          children: {},
          inject: (sessionId) => {
            const target = ctx.uiConversation.binding(sessionId).target("trajectory");
            return { hooks: { trajectory: { getSnapshot: () => target.getSnapshot(), subscribe: (l) => target.subscribe(l) } } };
          }
        }, digestView));
      },
    };
  },
});
