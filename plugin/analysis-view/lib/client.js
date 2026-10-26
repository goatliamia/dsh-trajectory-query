// dsh-analysis-view — 「分析」标签的客户端半边。
// 版面:轮次 / 花费 / 工具 / incident / 按需解读;数据全部来自 /analysis-view/digest。
window.__ModuleLoader__.load({
  id: "dsh-analysis-view",
  factory: (require) => {
    const React = require("react");

    /* 样式 */
    const STYLE_ID = "dsh-analysis-view-style";
    const CSS = `
.av-root{--av-accent:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-state-success-primary));padding:16px;overflow:auto;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
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
.av-btn.primary{border-color:var(--av-accent);color:var(--av-accent)}
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
.av-cost-row{display:grid;grid-template-columns:34px minmax(0,1fr) minmax(52px,.42fr) 44px;align-items:center;gap:8px;margin-bottom:4px;border-radius:4px;cursor:pointer}
.av-cost-row:hover{background:var(--dsw-alias-bg-layer-2)}
.av-cost-row:focus-visible{outline:2px solid var(--av-accent);outline-offset:-2px}
.av-cost-turn{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-track{display:flex;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.av-fill{height:100%}
.av-fill.hit{background:var(--dsw-alias-state-success-primary);opacity:.55}
.av-fill.miss{background:var(--dsw-alias-state-warn-primary);opacity:.85}
.av-fill.out{background:var(--av-accent);opacity:.75}
.av-rate{font-size:11px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-rate.warn{color:var(--dsw-alias-state-warn-primary)}
.av-donut{position:relative;width:112px;height:112px;flex:none}
.av-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.av-donut-num{font-size:16px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.av-legend-col{flex:1;min-width:0;max-height:84px;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px}
.av-flow-side{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.av-leg{display:flex;align-items:center;gap:8px;background:transparent;border:0;border-radius:6px;padding:3px 5px;font:inherit;color:inherit;cursor:pointer;text-align:left}
.av-leg:hover{background:var(--dsw-alias-bg-layer-2)}
.av-leg[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);outline:1px solid var(--dsw-alias-border-l1);outline-offset:-1px}
.av-leg-name{font-size:12px}
.av-leg-num{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.av-leg-err{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.av-tool-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
.av-flow-card{min-width:0;display:flex;flex-direction:column;gap:8px}
.av-flow-head{display:flex;align-items:baseline;gap:8px;min-width:0;height:18px}
.av-flow-title{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.av-flow-meta{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.av-flow-body{display:flex;gap:12px;align-items:flex-start;min-width:0}
.av-donut-sm{width:84px;height:84px;flex:none}
.av-donut-sm .av-donut-num{font-size:13px}
.av-leg-static{cursor:default}
.av-leg-static:hover{background:transparent}
.av-stat-line{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;font-variant-numeric:tabular-nums}
@media (max-width:760px){.av-tool-flow{grid-template-columns:minmax(0,1fr)}}
.av-num{font-variant-numeric:tabular-nums;text-align:right}
.av-bad{color:var(--dsw-alias-state-error-primary)}
.av-warn{color:var(--dsw-alias-state-warn-primary)}
.av-incident-list{max-height:360px;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain;padding-right:4px}
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
.av-btn:focus-visible,.av-seg:focus-visible,.av-chip:focus-visible{outline:2px solid var(--av-accent);outline-offset:1px}
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

    let clientCtx = null;

    /** 等对话里那一轮的行出现(切视图是异步的)。 */
    function waitForChatTurn(turn, ms) {
      const selector = '[data-chat-turn="' + turn + '"]';
      const found = document.querySelector(selector);
      if (found !== null) return Promise.resolve(found);
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const row = document.querySelector(selector);
          if (row !== null) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(row);
          }
        });
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, ms);
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    /** 和对话搜索同一条路:切到「对话」→ 需要时按 seq 加载那一页 → 滚到该轮。 */
    async function jumpToChatTurn(openView, sessionId, turn) {
      if (openView === undefined) return false;
      try {
        openView("chat", "");
      } catch {
        /* 切不过去就按当前 DOM 找 */
      }
      let row = await waitForChatTurn(turn.turn, 1200);
      if (row === null && clientCtx !== null && typeof clientCtx.get === "function") {
        const sessions = clientCtx.get("sessions");
        const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
        const session = binding && binding.session;
        if (session && typeof session.loadThrough === "function" && typeof turn.startSeq === "number") {
          try {
            await session.loadThrough(turn.startSeq);
          } catch {
            /* 分页失败就按已加载的找 */
          }
          row = await waitForChatTurn(turn.turn, 1500);
        }
      }
      if (row === null) return false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }

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
        // 优先用 host 给的 callId(失败那条→这轮第一条),都没有才退到投影索引。
        const known = turn.firstErrorCallId !== undefined && turn.firstErrorCallId !== null
          ? turn.firstErrorCallId
          : turn.firstCallId !== undefined && turn.firstCallId !== null
            ? turn.firstCallId
            : turn.firstErrorSeq !== null ? index.get(turn.firstErrorSeq) : undefined;
        const callable = known !== undefined;
        const clickable = callable && props.openView !== undefined;
        const title = "第 " + turn.turn + " 轮 · " + turn.toolCalls + " 次调用" + (turn.errors > 0 ? " · " + turn.errors + " 次失败" : "") +
          (turn.durationMs !== null ? " · " + ms(turn.durationMs) : "") + (clickable ? " · 点击跳到轨迹" : "");
        return h("button", {
          key: turn.turn,
          className: "av-seg " + tone + (clickable ? " clickable" : ""),
          style: many ? undefined : { flexGrow: String(weight(turn)), flexBasis: "0" },
          title,
          "aria-label": title,
          tabIndex: clickable ? 0 : -1,
          onClick: clickable ? () => props.openView("trajectory", known) : undefined,
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
        (turn.firstCallId !== undefined && turn.firstCallId !== null) ||
        (turn.firstErrorSeq !== null && index.get(turn.firstErrorSeq) !== undefined));
      return any ? "点一轮跳到轨迹里对应的调用" : "这一轮没有可定位的调用";
    }

    const COST_ROWS_MAX = 120;
    const COST_RATE_WARN = 0.9;

    function Cost(props) {
      const cost = props.cost;
      const list = React.useRef(null);
      const turns = React.useMemo(() => ((cost && Array.isArray(cost.byTurn)) ? cost.byTurn : []).filter((turn) => turn.turn !== null), [cost]);
      // cost.byTurn 只有 token 数字,没有 seq;按轮号从 turnStats 里补 startSeq,跳转才知道要加载到哪。
      const startSeqByTurn = React.useMemo(() => {
        const map = new Map();
        for (const stat of props.turnStats || []) if (typeof stat.startSeq === "number") map.set(stat.turn, stat.startSeq);
        return map;
      }, [props.turnStats]);
      const jumpTurn = (turn) => jumpToChatTurn(props.openView, props.sessionId, {
        turn: turn.turn,
        startSeq: startSeqByTurn.get(turn.turn),
      });
      React.useEffect(() => {
        const el = list.current;
        if (el !== null) el.scrollTop = el.scrollHeight;
      }, [turns.length]);
      if (!cost || !cost.requestCount) {
        return h("div", { className: "av-section" }, [
          h("div", { key: "h", className: "av-section-head" }, h("h3", { className: "av-section-title" }, "花费")),
          h("div", { key: "e", className: "av-empty" }, "这段会话没有可用的 token 数据"),
        ]);
      }
      const shown = turns.slice(-COST_ROWS_MAX);
      const maxInput = shown.reduce((acc, turn) => Math.max(acc, (turn.input || 0) + (turn.cacheRead || 0)), 0);
      const maxOutput = shown.reduce((acc, turn) => Math.max(acc, turn.output || 0), 0);
      const width = (value, max) => (max === 0 ? 0 : Math.max(0, (value / max) * 100));
      const rows = shown.map((turn, position) => {
        const miss = turn.input || 0;
        const hit = turn.cacheRead || 0;
        const out = turn.output || 0;
        const rate = turn.cacheEfficiency;
        const first = position === 0;
        const title = "第 " + turn.turn + " 轮 · 未命中 " + fmt(turn.input) + " · 命中 " + fmt(turn.cacheRead) + " · 输出 " + fmt(turn.output) + " · 命中率 " + pct(rate) + (first ? " · 首轮缓存是空的,命中率低属正常" : "");
        return h("div", {
          key: String(turn.turn),
          className: "av-cost-row",
          title: title + " · 点击跳到对话这一轮",
          role: "button",
          tabIndex: 0,
          onClick: () => jumpTurn(turn),
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") jumpTurn(turn);
          },
        }, [
          h("span", { key: "t", className: "av-cost-turn" }, "T" + turn.turn),
          h("div", { key: "i", className: "av-track" }, [
            h("div", { key: "h", className: "av-fill hit", style: { width: width(hit, maxInput) + "%" } }),
            h("div", { key: "m", className: "av-fill miss", style: { width: width(miss, maxInput) + "%" } }),
          ]),
          h("div", { key: "o", className: "av-track" }, [
            h("div", { key: "o", className: "av-fill out", style: { width: width(out, maxOutput) + "%" } }),
          ]),
          h("span", { key: "r", className: "av-rate" + (rate !== null && rate < COST_RATE_WARN ? " warn" : "") }, pct(rate)),
        ]);
      });
      const worst = [...turns]
        .filter((turn) => (turn.input || 0) > 0)
        .sort((a, b) => (b.input || 0) - (a.input || 0))
        .slice(0, 2);
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "花费"),
          h("span", { key: "n", className: "av-hint" }, cost.requestCount + " 次请求 · " + turns.length + " 轮" + (cost.unknownRequests > 0 ? " · " + cost.unknownRequests + " 次未上报" : "")),
        ]),
        h("div", { key: "sum", className: "av-cost-head" }, [
          h("div", { key: "in" }, [h("div", { className: "av-cost-num" }, fmt(cost.input)), h("div", { className: "av-cost-label" }, "未命中")]),
          h("div", { key: "cr" }, [h("div", { className: "av-cost-num" }, fmt(cost.cacheRead)), h("div", { className: "av-cost-label" }, "命中")]),
          h("div", { key: "out" }, [h("div", { className: "av-cost-num" }, fmt(cost.output)), h("div", { className: "av-cost-label" }, "输出")]),
          h("div", { key: "eff" }, [h("div", { className: "av-cost-num" }, pct(cost.cacheEfficiency)), h("div", { className: "av-cost-label" }, "命中率")]),
        ]),
        cost.cacheEfficiency === null ? null : h("div", { key: "note", className: "av-hint", style: { marginBottom: 8 } },
          "缓存承担了 " + pct(cost.cacheEfficiency) + " 的输入处理,实际新处理 " + fmt(cost.input)),
        rows.length > 0 ? h("div", { key: "rows", className: "av-cost-rows", ref: list }, rows) : null,
        worst.length > 0 && turns.length > 1
          ? h("div", { key: "worst", className: "av-hint", style: { marginTop: 6 } },
            "未命中最多:" + worst.map((turn) => "T" + turn.turn + " " + fmt(turn.input)).join(" · "))
          : null,
        h("div", { key: "l", className: "av-legend" }, [
          h("span", { key: "h", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-state-success-primary)", opacity: 0.55 } }), "命中"]),
          h("span", { key: "m", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--dsw-alias-state-warn-primary)", opacity: 0.85 } }), "未命中"]),
          h("span", { key: "o", className: "av-legend-item" }, [h("span", { className: "av-swatch", style: { background: "var(--av-accent)", opacity: 0.75 } }), "输出"]),
          turns.length > COST_ROWS_MAX ? h("span", { key: "more", className: "av-legend-item" }, "只画最近 " + COST_ROWS_MAX + " 轮") : null,
        ]),
      ]);
    }

    // 类别由 host 按工具自己的声明判定(digest 里每个工具带 category),客户端只负责画。
    const CATEGORY_LABELS = { file: "文件", run: "执行", web: "网络", context: "上下文", coop: "协作", plugin: "插件", other: "其他" };
    // 类别色只用非红:红留给错误。取静态色板里的蓝、绿、橙、灰。
    const CATEGORY_COLORS = {
      file: "var(--av-accent)",
      run: "var(--dsw-static-amber-400)",
      web: "var(--dsw-static-deepseek-450)",
      context: "var(--dsw-static-blue-300)",
      coop: "var(--dsw-static-green-500)",
      plugin: "var(--dsw-static-neutral-400)",
      other: "var(--dsw-static-neutral-300)",
    };
    const categoryOf = (tool) => (tool.category !== undefined && CATEGORY_LABELS[tool.category] !== undefined ? tool.category : "other");

    function Tools(props) {
      const tools = (props.tools || []).filter((tool) => tool.calls > 0);
      const [pickedCategory, setPickedCategory] = React.useState(null);
      const [pickedTool, setPickedTool] = React.useState(null);
      if (tools.length === 0) return null;
      const buckets = new Map();
      let totalCalls = 0;
      let totalErrors = 0;
      let totalMs = 0;
      for (const tool of tools) {
        const id = categoryOf(tool);
        if (!buckets.has(id)) buckets.set(id, { id, label: CATEGORY_LABELS[id], color: CATEGORY_COLORS[id], calls: 0, errors: 0, ms: 0, tools: [] });
        const bucket = buckets.get(id);
        bucket.calls += tool.calls;
        bucket.errors += tool.errors;
        bucket.ms += tool.totalMs || 0;
        bucket.tools.push(tool);
        totalCalls += tool.calls;
        totalErrors += tool.errors;
        totalMs += tool.totalMs || 0;
      }
      const slices = [...buckets.values()].sort((a, b) => b.calls - a.calls);
      const ring = (items, total, valueOf, radius, stroke, gap, colorOf) => {
        const circumference = 2 * Math.PI * radius;
        let consumed = 0;
        return items.map((item) => {
          const value = Math.max(0, valueOf(item) || 0);
          const raw = total === 0 ? 0 : (value / total) * circumference;
          const length = Math.max(0, raw - gap);
          const arc = h("circle", {
            key: item.id || item.name,
            cx: 50,
            cy: 50,
            r: radius,
            fill: "none",
            stroke: colorOf(item),
            strokeWidth: stroke,
            strokeDasharray: length + " " + (circumference - length),
            strokeDashoffset: String(-consumed),
            transform: "rotate(-90 50 50)",
          });
          consumed += raw;
          return arc;
        });
      };
      // 三张图默认都在:类别 → 该类工具 → 一个工具的分布。没选就给默认(最大类别、它的第一名工具)。
      const defaultCategory = slices.length > 0 ? slices[0] : null;
      const category = pickedCategory === null ? defaultCategory : buckets.get(pickedCategory) || defaultCategory;
      const categoryTools = category === null ? [] : category.tools.slice().sort((a, b) => b.calls - a.calls);
      const defaultTool = categoryTools.length > 0 ? categoryTools[0] : null;
      const tool = category === null || pickedTool === null ? defaultTool : categoryTools.find((item) => item.name === pickedTool) || defaultTool;
      const shade = (color, index) => "color-mix(in srgb, " + color + " " + Math.max(30, 100 - index * 13) + "%, var(--dsw-alias-bg-layer-2))";
      const toolSlices = category === null ? [] : categoryTools.map((item, index) => ({ ...item, color: shade(category.color, index) }));
      const toolTurns = tool === null ? [] : (tool.byTurn || []).map((item) => ({ id: "t" + item.turn, label: "T" + item.turn, turn: item.turn, calls: item.calls }));
      const turnSlices = toolTurns.map((item, index) => ({ ...item, color: shade(category.color, index) }));
      const activeCategory = pickedCategory === null ? null : pickedCategory;
      const legend = slices.map((slice) => h("button", {
        key: slice.id,
        className: "av-leg",
        "aria-pressed": activeCategory === slice.id,
        onClick: () => {
          setPickedCategory((current) => (current === slice.id ? null : slice.id));
          setPickedTool(null);
        },
      }, [
        h("span", { key: "s", className: "av-swatch", style: { background: slice.color } }),
        h("span", { key: "n", className: "av-leg-name" }, slice.label),
        h("span", { key: "c", className: "av-leg-num" }, slice.calls + " 次 · " + Math.round((slice.calls / totalCalls) * 100) + "%"),
        slice.errors > 0 ? h("span", { key: "e", className: "av-leg-err" }, "×" + slice.errors) : null,
      ]));
      return h("div", { className: "av-section" }, [
        h("div", { key: "h", className: "av-section-head" }, [
          h("h3", { key: "t", className: "av-section-title" }, "工具"),
          h("span", { key: "n", className: "av-hint" }, tools.length + " 种 · " + totalCalls + " 次 · " + ms(totalMs) + (totalErrors > 0 ? " · " + totalErrors + " 失败" : "")),
        ]),
        h("div", { key: "flow", className: "av-tool-flow" }, [
          h("div", { key: "category", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, "按类别"),
              h("span", { key: "m", className: "av-flow-meta" }, slices.length + " 类"),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "84", height: "84", role: "img", "aria-label": "各类别调用占比" }, ring(slices, totalCalls, (slice) => slice.calls, 40, 13, 1, (slice) => slice.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(totalCalls)),
                  h("span", { key: "l" }, "次调用"),
                ]),
              ]),
              h("div", { key: "l", className: "av-legend-col" }, legend),
            ]),
          ]),
          category === null ? null : h("div", { key: "tools", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, category.label + "的工具"),
              h("span", { key: "m", className: "av-flow-meta" }, category.calls + " 次 · " + ms(category.ms) + (category.errors > 0 ? " · " + category.errors + " 失败" : "")),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "84", height: "84", role: "img", "aria-label": category.label + "内各工具占比" }, ring(toolSlices, category.calls, (item) => item.calls, 40, 13, 2, (item) => item.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(categoryTools.length)),
                  h("span", { key: "l" }, "种"),
                ]),
              ]),
              h("div", { key: "l", className: "av-legend-col" }, toolSlices.map((item) => h("button", {
                key: item.name,
                className: "av-leg",
                "aria-pressed": tool !== null && tool.name === item.name,
                onClick: () => setPickedTool((current) => (current === item.name ? null : item.name)),
                title: item.name + " · 平均 " + ms(item.avgMs) + " · 最慢 " + ms(item.maxMs),
              }, [
                h("span", { key: "s", className: "av-swatch", style: { background: item.color } }),
                h("span", { key: "n", className: "av-leg-name" }, item.name),
                h("span", { key: "c", className: "av-leg-num" }, item.calls + " 次"),
                item.errors > 0 ? h("span", { key: "e", className: "av-leg-err" }, "×" + item.errors) : null,
              ]))),
            ]),
          ]),
          tool === null ? null : h("div", { key: "tool", className: "av-flow-card" }, [
            h("div", { key: "h", className: "av-flow-head" }, [
              h("span", { key: "t", className: "av-flow-title" }, tool.name + " 用在哪些轮"),
              h("span", { key: "m", className: "av-flow-meta" }, tool.calls + " 次"),
            ]),
            h("div", { key: "b", className: "av-flow-body" }, [
              h("div", { key: "d", className: "av-donut av-donut-sm" }, [
                h("svg", { key: "s", viewBox: "0 0 100 100", width: "84", height: "84", role: "img", "aria-label": tool.name + " 在各轮的调用占比" }, ring(turnSlices, tool.calls, (item) => item.calls, 40, 13, 1.5, (item) => item.color)),
                h("div", { key: "c", className: "av-donut-center" }, [
                  h("span", { key: "n", className: "av-donut-num" }, String(tool.calls)),
                  h("span", { key: "l" }, "次"),
                ]),
              ]),
              h("div", { key: "l", className: "av-flow-side" }, [
                h("div", { key: "legend", className: "av-legend-col" }, turnSlices.map((item) => h("div", { key: item.id, className: "av-leg av-leg-static", title: "第 " + item.turn + " 轮 · " + item.calls + " 次" }, [
                  h("span", { key: "s", className: "av-swatch", style: { background: item.color } }),
                  h("span", { key: "n", className: "av-leg-name" }, item.label),
                  h("span", { key: "c", className: "av-leg-num" }, item.calls + " 次"),
                ]))),
                h("div", { key: "stats", className: "av-stat-line" }, [
                  h("span", { key: "e", className: tool.errors > 0 ? "av-bad" : "" }, "失败 " + (tool.errors > 0 ? tool.errors : "—")),
                  h("span", { key: "a" }, "平均 " + ms(tool.avgMs)),
                  h("span", { key: "x" }, "最慢 " + ms(tool.maxMs)),
                ]),
              ]),
            ]),
          ]),
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
      const shown = incidents.slice(0, 20);
      const cards = shown.map((incident, position) => {
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
        h("div", { key: "c", className: "av-incident-list" }, cards),
        incidents.length > shown.length ? h("div", { key: "more", className: "av-hint", style: { marginTop: 6 } }, "还有 " + (incidents.length - shown.length) + " 条") : null,
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
        h(Cost, { key: "c", cost, turnStats: turns, sessionId, openView }),
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
        clientCtx = ctx;
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
