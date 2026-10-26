// dsh-analysis-view — 「分析」标签的客户端半边。
// 版面:轮次 / 花费 / 工具 / incident / 按需解读;数据全部来自 /analysis-view/digest。
window.__ModuleLoader__.load({
  id: "dsh-analysis-view",
  factory: (require) => {
    const React = require("react");

    /* 样式 */
    const STYLE_ID = "dsh-analysis-view-style";
    const CSS = `
.av-root{padding:16px;overflow:auto;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.av-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.av-title{margin:0;font-size:14px;font-weight:500;letter-spacing:.01em}
.av-meta{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-live{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}
.av-live.stale{background:var(--dsw-alias-state-warn-primary)}
.av-live.dead{background:var(--dsw-alias-state-idle-primary)}
.av-spacer{flex:1}
.av-btn{font:inherit;font-size:12px;line-height:1;padding:5px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.av-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.av-btn:disabled{opacity:.55;cursor:default}
.av-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.av-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px;overflow:hidden}
.av-kpi{padding:10px 14px;min-width:0;border-left:1px solid var(--dsw-alias-border-l1)}
.av-kpi:first-child{border-left:0}
.av-kpi-num{font-size:20px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.2}
.av-kpi-num.warn{color:var(--dsw-alias-state-warn-primary)}
.av-kpi-num.bad{color:var(--dsw-alias-state-error-primary)}
.av-kpi-label{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:760px){.av-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.av-kpi:nth-child(4){border-left:0}.av-kpi:nth-child(n+4){border-top:1px solid var(--dsw-alias-border-l1)}}
.av-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:12px;margin-bottom:12px}
.av-section-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.av-section-title{font-size:13px;font-weight:500;margin:0}
.av-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-strip{display:flex;align-items:stretch;gap:2px;height:28px}
.av-strip.scroll{overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;padding-bottom:3px;cursor:grab;scrollbar-width:thin}
.av-strip.scroll:active{cursor:grabbing}
.av-strip.scroll .av-seg{flex:0 0 14px;width:14px}
.av-seg{position:relative;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:0;padding:0;min-width:14px;cursor:default;overflow:hidden}
.av-seg.ok{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}
.av-seg.warn{background:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}
.av-seg.bad{background:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.av-seg.clickable{cursor:pointer}
.av-seg.clickable:hover{outline:1px solid var(--dsw-alias-border-l2);outline-offset:1px}
.av-seg-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.av-legend{display:flex;gap:12px;margin-top:8px;flex-wrap:wrap}
.av-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-swatch{width:8px;height:8px;border-radius:2px;flex:none}
.av-cost-head{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}
.av-cost-num{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}
.av-cost-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.av-cost-rows{max-height:240px;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;padding-right:4px}
.av-cost-row{display:grid;grid-template-columns:44px 1fr;align-items:center;gap:8px;margin-bottom:4px}
.av-cost-turn{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-track{display:flex;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.av-fill{height:100%}
.av-fill.in{background:var(--dsw-alias-brand-primary);opacity:.9}
.av-fill.cache{background:var(--dsw-alias-brand-primary);opacity:.5}
.av-fill.out{background:var(--dsw-alias-brand-primary);opacity:.28}
.av-table{width:100%;border-collapse:collapse;font-size:12px}
.av-table th{text-align:left;font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 8px 6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.av-table th.av-num{text-align:right}
.av-table td{padding:5px 8px 5px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.av-table tr:last-child td{border-bottom:0}
.av-num{font-variant-numeric:tabular-nums;text-align:right}
.av-tool{display:flex;align-items:center;gap:8px}
.av-tool-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.av-share{flex:1;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);min-width:24px}
.av-share-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);opacity:.55}
.av-bad{color:var(--dsw-alias-state-error-primary)}
.av-warn{color:var(--dsw-alias-state-warn-primary)}
.av-incident{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px 10px 14px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-1)}
.av-incident:last-child{margin-bottom:0}
.av-bar{position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--dsw-alias-state-idle-primary)}
.av-bar.high{background:var(--dsw-alias-state-error-primary)}
.av-bar.mid{background:var(--dsw-alias-state-warn-primary)}
.av-incident-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.av-incident-title{font-size:13px;font-weight:500}
.av-badge{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;line-height:16px}
.av-detail{font-size:12px;color:var(--dsw-alias-label-secondary);margin:3px 0 8px}
.av-why{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:2px 16px;font-size:12px}
.av-why-key{color:var(--dsw-alias-label-secondary);font-size:11px;display:block}
.av-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;align-items:center}
.av-chip{font:inherit;font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-variant-numeric:tabular-nums}
.av-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.av-chip:disabled{cursor:default;opacity:.6}
.av-skel{background:var(--dsw-alias-bg-layer-2);border-radius:6px}
.av-skel.line{height:10px;margin-bottom:8px}
.av-notice{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.av-empty{padding:32px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;min-height:120px;display:flex;align-items:center;justify-content:center}
.av-btn:focus-visible,.av-seg:focus-visible,.av-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.av-btn,.av-seg,.av-chip{transition:background-color .14s ease,border-color .14s ease,color .14s ease}
@media (prefers-reduced-motion:reduce){.av-btn,.av-seg,.av-chip{transition-duration:.01ms}}
.av-interp{font-size:13px;white-space:pre-wrap}
.av-foot{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
`;
    const ensureStyle = () => {
      if (typeof document === "undefined") return () => {};
      if (document.getElementById(STYLE_ID) !== null) return () => {};
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
      return () => { if (el.parentNode) el.parentNode.removeChild(el); };
    };

    /* ---------------- 数字与格式 ---------------- */
    const h = React.createElement;
    const fmt = (value) => {
      if (value === null || value === undefined) return "—";
      if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 0 : 1) + "M";
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + "k";
      return String(value);
    };
    const pct = (value) => (value === null || value === undefined ? "—" : (value * 100).toFixed(value >= 0.9995 ? 0 : 1) + "%");
    const ms = (value) => {
      if (value === null || value === undefined) return "—";
      if (value < 1000) return Math.round(value) + "ms";
      if (value < 60000) return (value / 1000).toFixed(1) + "s";
      return Math.floor(value / 60000) + "m" + Math.round((value % 60000) / 1000) + "s";
    };

    /* ---------------- 数据 ---------------- */
    // version 是轨迹投影的节点数:会话在长,它就变。变了就重取一次(带 700ms 静默期),
    // 手点「刷新」则跳过后端 2 秒缓存并立刻取。
    function useDigest(sessionId, version) {
      const [state, setState] = React.useState({ status: sessionId ? "loading" : "idle", data: null, error: null, at: 0 });
      const [nonce, setNonce] = React.useState(0);
      const fetchedNonce = React.useRef(-1);
      React.useEffect(() => {
        if (!sessionId) {
          setState({ status: "idle", data: null, error: null, at: 0 });
          return void 0;
        }
        let alive = true;
        const manual = fetchedNonce.current !== nonce;
        fetchedNonce.current = nonce;
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => {
          const url = "/analysis-view/digest?session=" + encodeURIComponent(sessionId) + (manual ? "&fresh=1" : "");
          fetch(url, ctl ? { signal: ctl.signal, cache: "no-store" } : { cache: "no-store" })
            .then((r) => {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.json();
            })
            .then((json) => {
              if (!alive) return;
              if (json && json.error) throw new Error(String(json.error));
              setState({ status: "ready", data: json, error: null, at: Date.now() });
            })
            .catch((error) => {
              if (!alive) return;
              if (error && (error.name === "AbortError" || ctl === null)) return;
              const message = String((error && error.message) || error);
              setState((prev) => ({ status: prev.data ? "stale" : "error", data: prev.data, error: message, at: prev.at }));
            });
        }, manual ? 0 : 700);
        return () => {
          alive = false;
          clearTimeout(timer);
          if (ctl) ctl.abort();
        };
      }, [sessionId, version, nonce]);
      const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
      return { ...state, refresh };
    }

    /** 轨迹投影里的 seq → callId,让证据 chip 能跳到轨迹视图。 */
    function buildCallIndex(snap) {
      const index = new Map();
      const nodes = Array.isArray(snap && snap.eventNodes) ? snap.eventNodes : [];
      for (const node of nodes) {
        if (!node) continue;
        if (node.kind === "tool-result" && node.callId) index.set(node.seq, node.callId);
        if (node.kind === "assistant" && Array.isArray(node.blocks)) {
          for (const block of node.blocks) if (block && block.kind === "tool-call" && block.callId) index.set(node.seq, block.callId);
        }
      }
      return { index, version: nodes.length };
    }

    /* ---------------- 小组件 ---------------- */
    function Kpi(props) {
      return h("div", { className: "av-kpi" }, [
        h("div", { key: "n", className: "av-kpi-num" + (props.tone ? " " + props.tone : "") }, props.value),
        h("div", { key: "l", className: "av-kpi-label", title: props.title || props.label }, props.label),
      ]);
    }

    function Skeleton() {
      return h("div", { "aria-busy": "true", "aria-label": "正在读取会话" }, [
        h("div", { key: "k", className: "av-kpis" }, [0, 1, 2, 3].map((i) => h("div", { key: i, className: "av-skel", style: { height: 58 } }))),
        h("div", { key: "s", className: "av-section" }, [
          h("div", { key: "a", className: "av-skel line", style: { width: "28%" } }),
          h("div", { key: "b", className: "av-skel", style: { height: 28 } }),
        ]),
        h("div", { key: "c", className: "av-section" }, [
          h("div", { className: "av-skel line", style: { width: "36%" } }),
          h("div", { className: "av-skel line", style: { width: "82%" } }),
          h("div", { className: "av-skel line", style: { width: "64%", marginBottom: 0 } }),
        ]),
      ]);
    }

    function Notice(props) {
      return h("div", { className: "av-notice" }, [
        h("span", { key: "t" }, props.text),
        props.action ? h("button", { key: "b", className: "av-btn", onClick: props.action.onClick }, props.action.label) : null,
      ]);
    }

    function turnTone(turn) {
      if (turn.errors >= 3 || turn.endReason === "error") return "bad";
      if (turn.errors > 0) return "warn";
      return "ok";
    }

    // 24 轮以内按比例铺满,每格至少 14px;再多就换成等宽格 + 横向拖动,右边是最新。
    const STRIP_MAX = 24;

    function WorkPath(props) {
      const turns = props.turns || [];
      const index = props.index;
      const many = turns.length > STRIP_MAX;
      const rail = React.useRef(null);
      const drag = React.useRef(null);
      const [atEnd, setAtEnd] = React.useState(true);
      const scrollToEnd = React.useCallback(() => {
        const el = rail.current;
        if (el !== null) el.scrollLeft = el.scrollWidth;
      }, []);
      React.useEffect(() => {
        if (many) scrollToEnd();
      }, [many, turns.length, scrollToEnd]);
      if (turns.length === 0) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, h("h3", { className: "av-section-title" }, "轮次")),
          h("div", { key: "e", className: "av-empty" }, "这段会话还没有开始任何 turn"),
        ]);
      }
      const weight = (turn) => {
        const value = turn.durationMs !== null ? turn.durationMs : turn.requests > 0 ? turn.requests * 1000 : turn.toolCalls > 0 ? turn.toolCalls * 1000 : 1;
        return Math.max(1, value);
      };
      const segments = turns.map((turn) => {
        const tone = turnTone(turn);
        const callId = turn.firstErrorCallId !== undefined && turn.firstErrorCallId !== null
          ? turn.firstErrorCallId
          : turn.firstErrorSeq === null ? undefined : index.get(turn.firstErrorSeq);
        const clickable = callId !== undefined && props.openView !== undefined;
        const title = "第 " + turn.turn + " 轮 · " + turn.toolCalls + " 次调用" + (turn.errors > 0 ? " · " + turn.errors + " 次失败" : "") +
          (turn.durationMs !== null ? " · " + ms(turn.durationMs) : "") + (clickable ? " · 点击跳到轨迹" : "");
        return h("button", {
          key: turn.turn,
          className: "av-seg " + tone + (clickable ? " clickable" : ""),
          style: many ? undefined : { flexGrow: String(weight(turn)), flexBasis: "0" },
          title,
          "aria-label": title,
          tabIndex: clickable ? 0 : -1,
          onClick: clickable ? () => props.openView("trajectory", callId) : undefined,
        }, turns.length <= 20 ? h("span", { className: "av-seg-label" }, String(turn.turn)) : null);
      });
      const startDrag = (event) => {
        const el = rail.current;
        if (!many || el === null) return;
        drag.current = { x: event.clientX, left: el.scrollLeft };
      };
      const moveDrag = (event) => {
        const state = drag.current;
        const el = rail.current;
        if (state === null || el === null) return;
        el.scrollLeft = state.left - (event.clientX - state.x);
      };
      const endDrag = () => {
        drag.current = null;
      };
      const onScroll = () => {
        const el = rail.current;
        if (el === null) return;
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
      };
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "轮次"),
          h("span", { key: "n", className: "av-hint" }, many
            ? turns.length + " 轮 · 右边最新,可拖动;每格 14px 起,点一下就能选中"
            : turns.length + " 个 turn · 宽度按时长,颜色按失败"),
          many && !atEnd ? h("span", { key: "sp", className: "av-spacer" }) : null,
          many && !atEnd ? h("button", { key: "end", className: "av-btn", onClick: scrollToEnd }, "回到最新") : null,
        ]),
        h("div", {
          key: "s",
          ref: rail,
          className: "av-strip" + (many ? " scroll" : ""),
          onScroll: many ? onScroll : undefined,
          onPointerDown: many ? startDrag : undefined,
          onPointerMove: many ? moveDrag : undefined,
          onPointerUp: many ? endDrag : undefined,
          onPointerLeave: many ? endDrag : undefined,
        }, segments),
        h("div", { key: "l", className: "av-legend" }, [
          h("span", { key: "ok", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-success-primary)", opacity: 0.5 } }), "正常"]),
          h("span", { key: "warn", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-warn-primary)" } }), "有失败"]),
          h("span", { key: "bad", className: "av-legend-item" }, [h("span", { key: "s", className: "av-swatch", style: { background: "var(--dsw-alias-state-error-primary)" } }), "多次失败 / 异常收尾"]),
          h("span", { key: "hint", className: "av-legend-item" }, clickableHint(turns, index)),
        ]),
      ]);
    }

    function clickableHint(turns, index) {
      const any = turns.some((turn) => (turn.firstErrorCallId !== undefined && turn.firstErrorCallId !== null) ||
        (turn.firstErrorSeq !== null && index.get(turn.firstErrorSeq) !== undefined));
      return any ? "有失败的轮次可点,跳到轨迹里对应调用" : "轨迹视图里没有对应调用时不可跳转";
    }

    const COST_ROWS_MAX = 120;

    function Cost(props) {
      const cost = props.cost;
      const list = React.useRef(null);
      const turns = React.useMemo(() => ((cost && Array.isArray(cost.byTurn)) ? cost.byTurn : []).filter((turn) => turn.turn !== null), [cost]);
      React.useEffect(() => {
        const el = list.current;
        if (el !== null) el.scrollTop = el.scrollHeight;
      }, [turns.length]);
      if (!cost || !cost.requestCount) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, h("h3", { className: "av-section-title" }, "花费")),
          h("div", { key: "e", className: "av-empty" }, "适配器没有上报 usage,这段会话没有 token 数据"),
        ]);
      }
      const max = turns.reduce((acc, turn) => Math.max(acc, (turn.input || 0) + (turn.cacheRead || 0) + (turn.output || 0)), 0);
      const shown = turns.slice(-COST_ROWS_MAX);
      const rows = shown.map((turn) => {
        const total = (turn.input || 0) + (turn.cacheRead || 0) + (turn.output || 0);
        const width = (value) => (max === 0 ? 0 : Math.max(0, (value / max) * 100));
        return h("div", { key: String(turn.turn), className: "av-cost-row", title: "turn " + turn.turn + " · 输入 " + fmt(turn.input) + " · 缓存读 " + fmt(turn.cacheRead) + " · 输出 " + fmt(turn.output) + " · 缓存 " + pct(turn.cacheEfficiency) }, [
          h("span", { key: "t", className: "av-cost-turn" }, "T" + turn.turn),
          h("div", { key: "b", className: "av-track" }, [
            h("div", { key: "i", className: "av-fill in", style: { width: width(turn.input || 0) + "%" } }),
            h("div", { key: "c", className: "av-fill cache", style: { width: width(turn.cacheRead || 0) + "%" } }),
            h("div", { key: "o", className: "av-fill out", style: { width: width(turn.output || 0) + "%" } }),
          ]),
        ]);
      });
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "花费"),
          h("span", { key: "n", className: "av-hint" }, cost.requestCount + " 次请求" + (cost.unknownRequests > 0 ? " · " + cost.unknownRequests + " 次未上报" : "") + (turns.length > 12 ? " · " + turns.length + " 轮,可滚动" : "")),
        ]),
        h("div", { key: "sum", className: "av-cost-head" }, [
          h("div", { key: "in" }, [h("div", { className: "av-cost-num" }, fmt(cost.input)), h("div", { className: "av-cost-label" }, "输入")]),
          h("div", { key: "cr" }, [h("div", { className: "av-cost-num" }, fmt(cost.cacheRead)), h("div", { className: "av-cost-label" }, "缓存读")]),
          h("div", { key: "out" }, [h("div", { className: "av-cost-num" }, fmt(cost.output)), h("div", { className: "av-cost-label" }, "输出")]),
          h("div", { key: "eff" }, [h("div", { className: "av-cost-num" }, pct(cost.cacheEfficiency)), h("div", { className: "av-cost-label" }, "缓存命中")]),
        ]),
        rows.length > 0 ? h("div", { key: "rows", className: "av-cost-rows", ref: list }, rows) : null,
        h("div", { key: "l", className: "av-legend" }, [
          h("span", { key: "i", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-brand-primary)", opacity: 0.9 } }), "输入"]),
          h("span", { key: "c", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-brand-primary)", opacity: 0.5 } }), "缓存读"]),
          h("span", { key: "o", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-brand-primary)", opacity: 0.28 } }), "输出"]),
          turns.length > COST_ROWS_MAX ? h("span", { key: "more", className: "av-legend-item" }, "只画最近 " + COST_ROWS_MAX + " 轮") : null,
        ]),
      ]);
    }

    function Tools(props) {
      const tools = (props.tools || []).filter((tool) => tool.calls > 0);
      if (tools.length === 0) return null;
      const max = tools.reduce((acc, tool) => Math.max(acc, tool.calls), 0);
      const shown = tools.slice(0, 12);
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "工具"),
          h("span", { key: "n", className: "av-hint" }, tools.length + " 种 · 按调用次数" + (tools.length > shown.length ? ",只列前 " + shown.length : "")),
        ]),
        h("table", { key: "t", className: "av-table" }, [
          h("thead", { key: "h" }, h("tr", {}, [
            h("th", { key: "n" }, "工具"),
            h("th", { key: "c", className: "av-num", style: { width: 56 } }, "调用"),
            h("th", { key: "e", className: "av-num", style: { width: 56 } }, "失败"),
            h("th", { key: "m", className: "av-num", style: { width: 72 } }, "平均耗时"),
          ])),
          h("tbody", { key: "b" }, shown.map((tool) => h("tr", { key: tool.name, title: "最近一次 seq " + tool.lastSeq + (tool.maxMs !== null ? " · 最慢 " + ms(tool.maxMs) : "") }, [
            h("td", { key: "n" }, h("div", { className: "av-tool" }, [
              h("span", { className: "av-tool-name" }, tool.name),
              h("span", { className: "av-share" }, h("span", { className: "av-share-fill", style: { width: (max === 0 ? 0 : (tool.calls / max) * 100) + "%", display: "block" } })),
            ])),
            h("td", { key: "c", className: "av-num" }, String(tool.calls)),
            h("td", { key: "e", className: "av-num" + (tool.errors > 0 ? " av-bad" : "") }, tool.errors > 0 ? String(tool.errors) : "—"),
            h("td", { key: "m", className: "av-num" }, ms(tool.avgMs)),
          ]))),
        ]),
      ]);
    }

    function Reasons(props) {
      const rows = [
        ["Cause", props.cause],
        ["Runtime 知道", props.runtimeKnew],
        ["Model 收到", props.modelKnew],
        ["Harness 反应", props.harness],
        ["影响", props.impact],
      ];
      return h("div", { className: "av-why" }, rows.map(([key, value], position) => h("div", { key: String(position) }, [
        h("span", { key: "k", className: "av-why-key" }, key),
        h("span", { key: "v" }, value),
      ])));
    }

    function Incidents(props) {
      const incidents = props.incidents || [];
      const index = props.index;
      if (incidents.length === 0) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, [
            h("h3", { key: "t", className: "av-section-title" }, "Incident"),
            h("span", { key: "n", className: "av-hint" }, "检查过:同参重复调用、调用失败、空转 turn"),
          ]),
          h("div", { key: "e", className: "av-empty" }, "没有发现可归因的 incident"),
        ]);
      }
      const cards = incidents.map((incident, position) => {
        const tone = incident.severity >= 5 ? "high" : incident.severity >= 3 ? "mid" : "";
        return h("div", { key: incident.type + "-" + position, className: "av-incident" }, [
          h("span", { key: "bar", className: "av-bar" + (tone ? " " + tone : "") }),
          h("div", { key: "h", className: "av-incident-head" }, [
            h("span", { key: "t", className: "av-incident-title" }, incident.title),
            h("span", { key: "b", className: "av-badge" }, "严重度 " + incident.severity),
          ]),
          h("div", { key: "d", className: "av-detail" }, incident.detail),
          h(Reasons, { key: "why", cause: incident.cause, runtimeKnew: incident.runtimeKnew, modelKnew: incident.modelKnew, harness: incident.harness, impact: incident.impact }),
          incident.seqs && incident.seqs.length > 0 ? h("div", { key: "s", className: "av-chips" }, [].concat(
            incident.seqs.slice(0, 10).map((entry) => {
              const seq = typeof entry === "number" ? entry : entry.seq;
              const callId = typeof entry === "number" ? index.get(entry) : entry.callId;
              const jump = callId !== undefined && props.openView !== undefined;
              return h("button", {
                key: String(seq),
                className: "av-chip",
                disabled: !jump,
                title: jump ? "在轨迹里打开 seq " + seq : "seq " + seq + "(轨迹里没有对应调用)",
                onClick: jump ? () => props.openView("trajectory", callId) : undefined,
                style: jump ? undefined : { cursor: "default" },
              }, String(seq));
            }),
            incident.seqs.length > 10 ? [h("span", { key: "more", className: "av-hint" }, "还有 " + (incident.seqs.length - 10) + " 条")] : [],
          )) : null,
        ]);
      });
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "Incident"),
          h("span", { key: "n", className: "av-hint" }, incidents.length + " 条 · 按严重度排序 · seq 可点"),
        ]),
        h("div", { key: "c" }, cards),
      ]);
    }

    function Interpret(props) {
      const [state, setState] = React.useState({ status: "idle", text: null, error: null, truncated: false });
      const sessionId = props.sessionId;
      const run = () => {
        if (!sessionId) return;
        setState({ status: "loading", text: null, error: null, truncated: false });
        fetch("/analysis-view/interpret?session=" + encodeURIComponent(sessionId), { cache: "no-store" })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.error) setState({ status: "error", text: null, error: String(json.error), truncated: false });
            else setState({ status: "ready", text: String((json && json.text) || ""), error: null, truncated: Boolean(json && json.truncated) });
          })
          .catch((error) => setState({ status: "error", text: null, error: String((error && error.message) || error), truncated: false }));
      };
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "开放解读"),
          h("span", { key: "n", className: "av-hint" }, "按需生成,会调用一次模型"),
          h("span", { key: "sp", className: "av-spacer" }),
          h("button", { key: "b", className: "av-btn primary", onClick: run, disabled: state.status === "loading" || !sessionId }, state.status === "loading" ? "生成中" : state.text !== null ? "重新生成" : "生成解读"),
        ]),
        state.status === "idle" ? h("div", { key: "i", className: "av-hint" }, "基于上面的确定性 incident 与证据片段生成,每条陈述引用 (session, seq@logId)") : null,
        state.status === "loading" ? h("div", { key: "l" }, [h("div", { className: "av-skel line", style: { width: "92%" } }), h("div", { className: "av-skel line", style: { width: "70%", marginBottom: 0 } })]) : null,
        state.status === "error" ? h(Notice, { key: "e", text: "解读失败:" + state.error, action: { label: "重试", onClick: run } }) : null,
        state.status === "ready" ? h("div", { key: "r", className: "av-interp" }, state.text) : null,
        state.status === "ready" && state.truncated ? h("div", { key: "t", className: "av-hint" }, "输出触到 token 上限,已截断") : null,
      ]);
    }

    /* ---------------- 面板 ---------------- */
    function AnalysisPanel(props) {
      React.useEffect(() => ensureStyle(), []);
      const sessionId = props && props.sessionId;
      const openView = props && props.openView;
      const useTrajectory = props && props.useTrajectory;
      const snapshot = useTrajectory ? useTrajectory((state) => state) : null;
      const { index, version } = React.useMemo(() => buildCallIndex(snapshot), [snapshot]);
      const digest = useDigest(sessionId, version);
      const data = digest.data;
      const incidents = data && Array.isArray(data.incidents) ? data.incidents : [];
      const status = digest.status;

      // 读不到 host 时降级:只列轨迹投影里的工具报错,并写明计数来源。
      const localErrors = React.useMemo(() => {
        const nodes = Array.isArray(snapshot && snapshot.eventNodes) ? snapshot.eventNodes : [];
        const seqs = [];
        for (const node of nodes) if (node && node.kind === "tool-result" && (node.error || node.isError)) seqs.push(node.seq);
        return seqs;
      }, [snapshot]);
      const degraded = status === "error" && !data && localErrors.length > 0
        ? [{
          type: "error",
          severity: localErrors.length,
          title: "调用失败",
          detail: localErrors.length + " 个工具调用返回错误(host 分析不可用,计数来自轨迹投影)",
          cause: "工具调用返回了错误结果",
          runtimeKnew: "错误码/失败状态已在事件中",
          modelKnew: "收到 tool result(可能已含错误)",
          harness: "未检测到针对性处理(需 host 判定)",
          impact: "该部分目标未达成",
          seqs: localErrors,
        }]
        : [];

      const head = h("div", { key: "h", className: "av-head" }, [
        h("span", { key: "d", className: "av-live " + (status === "ready" ? "" : status === "stale" ? "stale" : "dead"), title: status === "ready" ? "已读取" : status === "stale" ? "刷新失败,显示上一次结果" : "未连接" }),
        h("h2", { key: "t", className: "av-title" }, "分析"),
        data && data.log ? h("span", { key: "m", className: "av-meta" }, [
          data.log.id + " · " + fmt(data.log.events) + " 事件 · seq " + data.log.minSeq + "–" + data.log.maxSeq,
        ]) : null,
        h("span", { key: "sp", className: "av-spacer" }),
        h("button", { key: "r", className: "av-btn", onClick: digest.refresh, disabled: !sessionId || status === "loading" }, "刷新"),
      ]);

      if (!sessionId) return h("div", { className: "av-root" }, [head, h(Notice, { key: "n", text: "还没有选中会话" })]);

      if (status === "loading" || (status === "idle" && !data)) return h("div", { className: "av-root" }, [head, h(Skeleton, { key: "s" })]);

      if (status === "error" && !data) {
        return h("div", { className: "av-root" }, [
          head,
          h(Notice, { key: "e", text: "读取会话失败:" + digest.error, action: { label: "重试", onClick: digest.refresh } }),
          degraded.length > 0 ? h(Incidents, { key: "inc", incidents: degraded, index, openView }) : null,
        ]);
      }

      const cost = data && data.cost;
      const turns = data && Array.isArray(data.turnStats) ? data.turnStats : [];
      const tools = data && Array.isArray(data.toolStats) ? data.toolStats : [];

      return h("div", { className: "av-root" }, [
        head,
        status === "stale" ? h(Notice, { key: "st", text: "刷新失败,先显示上一次的结果:" + digest.error, action: { label: "重试", onClick: digest.refresh } }) : null,
        h("div", { key: "k", className: "av-kpis" }, [
          h(Kpi, { key: "turns", label: "轮次", value: String(data ? data.turns : "—") }),
          h(Kpi, { key: "calls", label: "工具调用", value: String(data ? data.toolCalls : "—") }),
          h(Kpi, { key: "errors", label: "失败", value: String(data ? data.errors : "—"), tone: data && data.errors > 0 ? "bad" : "" }),
          h(Kpi, { key: "cache", label: "缓存命中", value: pct(cost && cost.cacheEfficiency) }),
          h(Kpi, { key: "events", label: "事件", value: fmt(data && data.eventCount) }),
        ]),
        h(WorkPath, { key: "w", turns, index, openView }),
        h(Cost, { key: "c", cost }),
        h(Tools, { key: "tools", tools }),
        h(Incidents, { key: "inc", incidents, index, openView }),
        h(Interpret, { key: "i", sessionId }),
        h("div", { key: "f", className: "av-foot" }, [
          h("span", { key: "v" }, "日志 " + (data && data.log ? data.log.id : "—")),
          h("span", { key: "l" }, "读于 " + (digest.at ? new Date(digest.at).toLocaleTimeString() : "—")),
          h("span", { key: "n" }, "轨迹 " + version + " 节点"),
        ]),
      ]);
    }

    /* ---------------- 注册 ---------------- */
    function AnalysisSnapshotBuilder() {
      this.snap = { order: [], nodes: new Map(), locations: new Map(), navigation: null, timeline: null, counts: { nodes: 0, upserts: 0 } };
    }
    AnalysisSnapshotBuilder.prototype.replace = function () { return this.snap; };
    AnalysisSnapshotBuilder.prototype.apply = function () { return this.snap; };
    AnalysisSnapshotBuilder.prototype.snapshot = function () { return this.snap; };

    return {
      inject: ["slots", "uiConversation"],
      apply(ctx) {
        ctx.uiConversation.views.register({ target: "analysis", create: () => new AnalysisSnapshotBuilder(), isActive: () => true });
        const slots = ctx.slots;
        if (!slots) return;
        slots.inject("conversation.view", () => slots.register({
          name: "conversation.view",
          id: "analysis",
          order: 20,
          label: () => "分析",
          children: {},
          inject: (sessionId) => {
            const target = ctx.uiConversation.binding(sessionId).target("trajectory");
            return { hooks: { trajectory: { getSnapshot: () => target.getSnapshot(), subscribe: (listener) => target.subscribe(listener) } }, sessionId };
          },
        }, AnalysisPanel));
      },
    };
  },
});
