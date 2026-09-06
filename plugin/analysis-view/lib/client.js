// dsh-analysis-view — runtime incident view(分析 tab)。
// 检测为确定性分析器逻辑(非模型);卡片=Event/Cause/Runtime knew/Model knew/Harness response/Impact;
// 机械层事实块与 AI-skill 解读明确分开。web profile loader 用 __ModuleLoader__.load 自注册。
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
    const chip = { display: "inline-block", margin: "0 3px", padding: "0 5px", borderRadius: 4, background: "var(--dsw-alias-bg-layer-2, #ececec)", fontSize: 11, color: "var(--dsw-alias-label-secondary, #666)", cursor: "pointer", border: "0", fontFamily: "inherit" };

    function digestView(props) {
      const useTrajectory = props && props.useTrajectory;
      const openView = props && props.openView;
      let snap = null;
      try { snap = useTrajectory ? useTrajectory((s) => s) : null; } catch { snap = null; }
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];

      const turnSet = new Set();
      const turnTools = new Map();
      const turnErrors = new Set();
      const callIdBySeq = new Map();
      const nameSeq = [];
      const errorByCall = new Map();
      const errFirst = [];
      let toolCalls = 0, errors = 0;

      for (const n of nodes) {
        const k = n && n.kind;
        if (k === "assistant" && n.turn > 0) {
          turnSet.add(n.turn);
          if (Array.isArray(n.blocks)) for (const b of n.blocks) if (b && b.kind === "tool-call" && b.name) {
            turnTools.set(n.turn, (turnTools.get(n.turn) || 0) + 1);
            nameSeq.push({ name: b.name, seq: n.seq, callId: b.callId });
            if (b.callId) callIdBySeq.set(n.seq, b.callId);
          }
        }
        if (k === "tool-result") {
          toolCalls++;
          if (n.callId) callIdBySeq.set(n.seq, n.callId);
          if (n.error || n.isError) {
            errors++;
            if (n.callId) errorByCall.set(n.callId, true);
            if (n.turn) turnErrors.add(n.turn);
            if (errFirst.length < 8) errFirst.push({ kind: (n.error && (n.error.name || n.error.code)) || n.name || "error", seq: n.seq, callId: n.callId });
          }
        }
      }
      const turns = turnSet.size;
      let emptyTurns = 0;
      for (const t of turnSet) if (!(turnTools.get(t) > 0)) emptyTurns++;
      const maxT = Math.max(1, ...[...turnTools.values()]);

      // —— 确定性 incident 检测(v1)——
      const incidents = [];
      const retryRunTurns = new Set();
      let i = 0;
      while (i < nameSeq.length) {
        let j = i;
        while (j < nameSeq.length && nameSeq[j].name === nameSeq[i].name) j++;
        if (j - i >= 2) {
          const run = nameSeq.slice(i, j);
          const hasErr = run.some((x) => errorByCall.get(x.callId));
          for (const x of run) { const t = turnOfSeq(x.seq); if (t !== undefined) retryRunTurns.add(t); }
          incidents.push({ type: "retry-loop", severity: run.length + (hasErr ? 2 : 0), title: "重复调用循环", detail: "连续 " + (j - i) + " 次对 \"" + run[0].name + "\" 的重复调用", cause: run[0].name + " 同签名工具连续重复调用" + (hasErr ? "; 且其中含失败结果" : ""), runtimeKnew: hasErr ? "上一次调用失败,重复状态已累积" : "重复调用状态已累积", modelKnew: "仅收到各次 tool result,无重复/失败聚合状态", harness: "未检测到主动打断", impact: (j - i) + " 次冗余调用", seqs: run.map((x) => ({ seq: x.seq, callId: x.callId })) });
        }
        i = j;
      }
      if (errors > 0) incidents.push({ type: "error", severity: 1, title: "调用失败", detail: errors + " 个调用返回错误", cause: "工具调用返回了错误", runtimeKnew: "错误码见证据", modelKnew: "收到 tool result(可能已含错误)", harness: "未检测到针对性处理", impact: "该部分目标未达成", seqs: errFirst.slice(0, 4).map((e) => ({ seq: e.seq, callId: e.callId })) });
      if (emptyTurns > 0) incidents.push({ type: "noop", severity: 1, title: "空转 turn", detail: emptyTurns + " 个 turn 无任何工具调用", cause: "该 turn 未产生工具动作", runtimeKnew: "-", modelKnew: "无工具上下文", harness: "-", impact: "该 turn 未推进", seqs: [] });
      incidents.sort((a, b) => b.severity - a.severity);

      const go = (callId) => () => { if (openView && callId) openView("trajectory", callId); };
      const chipBtn = (seq, callId) => React.createElement("button", { key: String(seq) + "-" + String(callId), onClick: go(callId), style: chip, title: openView ? "切到轨迹" : "" }, String(seq));
      const turnOfSeq = (seq) => { const n = nodes.find((x) => x.seq === seq); return n ? n.turn : undefined; };

      const fact = (k, v) => React.createElement("div", { key: k, style: { padding: "4px 0", borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)" } }, React.createElement("span", { style: { fontSize: 13 } }, k), React.createElement("span", { style: sub }, "  " + v));

      const card = (inc) => React.createElement("div", { key: inc.type + "-" + inc.title, style: { border: "1px solid var(--dsw-alias-border-l2, #eee)", borderRadius: 6, padding: 8, margin: "8px 0", background: "var(--dsw-alias-bg-layer-1, #fff)" } }, [
        React.createElement("div", { key: "h", style: { display: "flex", alignItems: "center", gap: 6 } }, React.createElement("b", { style: { fontSize: 13 } }, inc.title), React.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-danger, #e5484d)" } }, "sev " + inc.severity)),
        React.createElement("div", { key: "d", style: Object.assign({}, sub, { margin: "2px 0" }) }, inc.detail),
        React.createElement("div", { key: "c", style: { fontSize: 12, margin: "2px 0" } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "原因: "), inc.cause),
        React.createElement("div", { key: "rk", style: { fontSize: 12, margin: "2px 0" } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Runtime 知道: "), inc.runtimeKnew),
        React.createElement("div", { key: "mk", style: { fontSize: 12, margin: "2px 0" } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Model 知道: "), inc.modelKnew),
        React.createElement("div", { key: "hr", style: { fontSize: 12, margin: "2px 0" } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Harness 反应: "), inc.harness),
        React.createElement("div", { key: "im", style: { fontSize: 12, margin: "2px 0" } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "影响: "), inc.impact),
        inc.seqs.length ? React.createElement("div", { key: "seq", style: { margin: "4px 0 0" } }, inc.seqs.map((s) => chipBtn(s.seq, s.callId))) : null
      ]);

      const strip = React.createElement("div", { key: "strip", style: { margin: "8px 0" } }, [
        React.createElement("div", { key: "a", style: Object.assign({}, sub, { marginBottom: 4 }) }, "Turn 活动 (tool 密度 · 红=错误 · 橙=重复循环 · 灰=空转)"),
        React.createElement("div", { key: "b", style: { display: "flex", alignItems: "flex-end", gap: 2, height: 48 } }, [...turnSet].sort((a, b) => a - b).map((t) => {
          const c = turnTools.get(t) || 0;
          const h = c ? Math.max(6, Math.round((c / maxT) * 36)) : 4;
          const col = turnErrors.has(t) ? "#e5484d" : retryRunTurns.has(t) ? "#f5a623" : c ? "var(--dsw-alias-state-business-primary, #3b82f6)" : "#c9c9c9";
          return React.createElement("div", { key: t, title: "turn " + t + " · " + c + " calls" + (turnErrors.has(t) ? " · error" : ""), style: { width: 8, height: h, background: col, borderRadius: 2 } });
        }))
      ]);

      const kpi = [["turns", String(turns)], ["tool calls", String(toolCalls)], ["errors", String(errors)], ["incidents", String(incidents.length)]];
      const facts = [
        fact("retry-loop v1", incidents.filter((x) => x.type === "retry-loop").length + " 个"),
        fact("error", errors + " 个"),
        fact("空转 turn", emptyTurns + " / " + turns + " 个 turn 无工具调用"),
        fact("分析器版本", "incidents v1 · turns v1 · tools v1")
      ];

      return React.createElement("div", { style: { padding: 12, overflow: "auto", minHeight: 0 } }, [
        React.createElement("h3", { key: "h", style: { margin: "0 0 4px", fontSize: 14 } }, "分析 (Incident View)", React.createElement("span", { style: sub }, "  ·  检测为确定性分析器,非模型判断")),
        React.createElement("div", { key: "kpi", style: { display: "flex", gap: 14, margin: "8px 0", flexWrap: "wrap" } }, kpi.map(([k, v]) => React.createElement("span", { key: k, style: { fontSize: 13 } }, React.createElement("b", { style: { marginRight: 4 } }, v), k))),
        incidents.length ? React.createElement("div", { key: "inc", style: { margin: "6px 0" } }, incidents.map(card)) : React.createElement("div", { key: "noinc", style: sub }, "未检测到显著 incident。" ),
        strip,
        React.createElement("div", { key: "mech", style: { margin: "8px 0", paddingTop: 4, borderTop: "1px solid var(--dsw-alias-border-l2, #eee)" } }, [React.createElement("div", { key: "h", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #666)", marginBottom: 2 } }, "机械层事实(确定性)"), ...facts]),
        React.createElement("div", { key: "open", style: { margin: "8px 0" } }, React.createElement("details", null, React.createElement("summary", { style: { fontSize: 12, cursor: "pointer" } }, "开放解读 (AI-skill,消耗 tokens)"), React.createElement("div", { style: sub }, "占位:由 analysis skill 基于以上 incident 证据带 (session, seq) 引用生成。")))
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
