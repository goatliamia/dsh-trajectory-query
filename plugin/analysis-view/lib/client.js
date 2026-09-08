// dsh-analysis-view — runtime incident view(分析 tab)。
// 面板只渲染"有证据的 incident";工具名级表面模式不判 incident。
// 同参重复 / 空转 / 因果归属需要参数与状态 → 标为"需 host 分析"(由 analyzers/incidents.mjs 产出)。
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
      const sessionId = props && props.sessionId;
      const [host, setHost] = React.useState(null);
      const [hostErr, setHostErr] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        if (!sessionId) return void 0;
        fetch("/analysis-view/digest?session=" + encodeURIComponent(sessionId))
          .then((r) => r.json())
          .then((j) => { if (alive) setHost(j); })
          .catch((e) => { if (alive) setHostErr(String((e && e.message) || e)); });
        return () => { alive = false; };
      }, [sessionId]);
      let snap = null;
      try { snap = useTrajectory ? useTrajectory((s) => s) : null; } catch { snap = null; }
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];

      const turnSet = new Set();
      const turnMarkers = [];
      const callIdBySeq = new Map();
      const errRaw = [];
      let toolCalls = 0, errors = 0;

      for (const n of nodes) {
        const k = n && n.kind;
        if (k === "assistant" && n.turn > 0) {
          turnSet.add(n.turn);
          turnMarkers.push({ seq: n.seq, turn: n.turn });
          if (Array.isArray(n.blocks)) for (const b of n.blocks) if (b && b.kind === "tool-call" && b.callId) callIdBySeq.set(n.seq, b.callId);
        }
        if (k === "tool-result") {
          toolCalls++;
          if (n.callId) callIdBySeq.set(n.seq, n.callId);
          if (n.error || n.isError) {
            errors++;
            if (errRaw.length < 12) errRaw.push({ kind: (n.error && (n.error.name || n.error.code)) || n.name || "error", seq: n.seq, callId: n.callId });
          }
        }
      }
      turnMarkers.sort((a, b) => a.seq - b.seq);
      const turnAt = (seq) => { let t; for (const m of turnMarkers) { if (m.seq <= seq) t = m.turn; else break; } return t; };
      const errFirst = errRaw.map((e) => ({ ...e, turn: turnAt(e.seq) }));
      const turns = turnSet.size;

      const errForTurn = new Map();
      for (const e of errFirst) if (e.turn !== undefined && !errForTurn.has(e.turn)) errForTurn.set(e.turn, e);

      const incidents = [];
      if (errors > 0) {
        const kinds = {};
        for (const e of errFirst) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
        incidents.push({
          type: "error", severity: errors, title: "调用失败",
          detail: errors + " 个工具调用返回错误(" + Object.keys(kinds).join(", ") + ")",
          cause: "工具调用返回了错误结果",
          runtimeKnew: "错误码/失败状态已在事件中",
          modelKnew: "收到 tool result(可能已含错误)",
          harness: "未检测到针对性处理(需 host 判定)",
          impact: "该部分目标未达成",
          seqs: errFirst.map((e) => ({ seq: e.seq, callId: e.callId }))
        });
      }

      const clientIncidents = incidents.slice();
      const hostIncidents = host && Array.isArray(host.incidents)
        ? host.incidents.map((inc) => ({ ...inc, seqs: (inc.seqs || []).map((s) => (typeof s === "number" ? { seq: s, callId: callIdBySeq.get(s) } : s)) }))
        : null;
      const shown = hostIncidents || clientIncidents;
      const hostState = host ? ("已加载 · " + ((host.incidents && host.incidents.length) || 0) + " incidents") : hostErr ? ("不可用: " + hostErr) : sessionId ? "加载中…" : "无 sessionId(未发起请求)";
      const go = (callId) => () => { if (openView && callId) openView("trajectory", callId); };
      const chipBtn = (seq, callId) => React.createElement("button", { key: String(seq) + "-" + String(callId), onClick: go(callId), style: chip, title: openView ? "切到轨迹" : "" }, String(seq));
      const fact = (k, v) => React.createElement("div", { key: k, style: { padding: "4px 0", borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)" } }, React.createElement("span", { style: { fontSize: 13 } }, k), React.createElement("span", { style: sub }, "  " + v));

      const card = (inc) => React.createElement("div", { key: inc.type, style: { border: "1px solid var(--dsw-alias-border-l2, #eee)", borderRadius: 6, padding: 8, margin: "8px 0" } }, [
        React.createElement("div", { key: "h", style: { display: "flex", alignItems: "center", gap: 6 } }, React.createElement("b", { style: { fontSize: 13 } }, inc.title), React.createElement("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-danger, #e5484d)" } }, inc.severity + " 次")),
        React.createElement("div", { key: "d", style: Object.assign({}, sub, { margin: "2px 0" }) }, inc.detail),
        React.createElement("div", { key: "c", style: { fontSize: 12 } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "原因: "), inc.cause),
        React.createElement("div", { key: "rk", style: { fontSize: 12 } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Runtime 知道: "), inc.runtimeKnew),
        React.createElement("div", { key: "mk", style: { fontSize: 12 } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Model 知道: "), inc.modelKnew),
        React.createElement("div", { key: "hr", style: { fontSize: 12 } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "Harness 反应: "), inc.harness),
        React.createElement("div", { key: "im", style: { fontSize: 12 } }, React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #666)" } }, "影响: "), inc.impact),
        React.createElement("div", { key: "seq", style: { margin: "4px 0 0" } }, inc.seqs.slice(0, 8).map((s) => chipBtn(s.seq, s.callId)))
      ]);

      const strip = React.createElement("div", { key: "strip", style: { margin: "8px 0", padding: 8, border: "1px solid var(--dsw-alias-border-l2, #eee)", borderRadius: 6 } }, [
        React.createElement("div", { key: "a", style: Object.assign({}, sub, { marginBottom: 6 }) }, "Turn 地图(共 " + turns + " 个 turn · 红 = 有失败,可点跳轨迹 · 灰 = 正常)"),
        React.createElement("div", { key: "b", style: { display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" } }, [...turnSet].sort((a, b) => a - b).map((t) => {
          const e = errForTurn.get(t);
          const isErr = e !== undefined;
          return React.createElement("button", { key: t, onClick: isErr ? go(e.callId) : void 0, title: "turn " + t + (isErr ? " · 失败 @seq " + e.seq : ""), style: { width: 14, height: 20, padding: 0, border: "1px solid " + (isErr ? "#c33" : "var(--dsw-alias-border-l2, #c9c9c9)"), borderRadius: 3, cursor: isErr ? "pointer" : "default", background: isErr ? "#e5484d" : "#dcdcdc" } });
        }))
      ]);

      const kpi = [["turns", String(turns)], ["tool calls", String(toolCalls)], ["errors", String(errors)], ["incidents", String(shown.length)]];
      const facts = [
        fact("调用失败", errors + " 次(证据已列)"),
        fact("同参重复调用", hostIncidents ? ((host.incidents || []).filter((x) => x.type === "retry-loop").length + " 个(host)") : "需 host 分析"),
        fact("空转 turn", host ? String(host.emptyTurns) + " 个(host)" : "需 host 分析"),
        fact("host 分析", hostState),
        fact("分析器版本", "incidents v1(host + client 渲染)")
      ];

      return React.createElement("div", { style: { padding: 12, overflow: "auto", minHeight: 0 } }, [
        React.createElement("h3", { key: "h", style: { margin: "0 0 4px", fontSize: 14 } }, "分析 (Incident View)", React.createElement("span", { style: sub }, "  ·  只列有证据的 incident;工具名级表面模式不判")),
        React.createElement("div", { key: "kpi", style: { display: "flex", gap: 14, margin: "8px 0", flexWrap: "wrap" } }, kpi.map(([k, v]) => React.createElement("span", { key: k, style: { fontSize: 13 } }, React.createElement("b", { style: { marginRight: 4 } }, v), k))),
        shown.length ? React.createElement("div", { key: "inc" }, shown.map(card)) : React.createElement("div", { key: "noinc", style: sub }, "未检测到有证据的 incident。"),
        strip,
        React.createElement("div", { key: "mech", style: { margin: "8px 0", paddingTop: 4, borderTop: "1px solid var(--dsw-alias-border-l2, #eee)" } }, [React.createElement("div", { key: "h", style: Object.assign({}, sub, { marginBottom: 2 }) }, "机械层事实 / host 分析"), ...facts]),
        React.createElement("div", { key: "open", style: { margin: "8px 0" } }, React.createElement("details", null, React.createElement("summary", { style: { fontSize: 12, cursor: "pointer" } }, "开放解读 (AI-skill,消耗 tokens)"), React.createElement("div", { style: sub }, "占位:由 analysis skill 基于 incident 证据带 (session, seq) 引用生成。")))
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
            return { hooks: { trajectory: { getSnapshot: () => target.getSnapshot(), subscribe: (l) => target.subscribe(l) } }, sessionId };
          }
        }, digestView));
      },
    };
  },
});
