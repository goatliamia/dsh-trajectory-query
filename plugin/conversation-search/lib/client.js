// dsh-conversation-search client half — 右侧栏的「对话搜索」tab。
// 输入关键词 → host 在当前会话的日志里做字面检索 → 点结果滚到对话里对应的那一轮。
window.__ModuleLoader__.load({
  id: "dsh-conversation-search",
  factory: (require) => {
    const React = require("react");
    let clientCtx = null;

    const STYLE_ID = "dsh-conversation-search-style";
    const CSS = `
.cs-root{display:flex;flex-direction:column;height:100%;min-height:0;gap:8px;padding:10px;font-size:13px;color:var(--dsw-alias-label-primary)}
.cs-input{width:100%;box-sizing:border-box;height:30px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;padding:0 8px;outline:none}
.cs-input::placeholder{color:var(--dsw-alias-label-secondary)}
.cs-input:focus{border-color:var(--dsw-alias-brand-primary)}
.cs-meta{font-size:11px;color:var(--dsw-alias-label-secondary);min-height:14px;font-variant-numeric:tabular-nums}
.cs-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px}
.cs-hit{text-align:left;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:6px 8px;cursor:pointer;font:inherit;color:inherit}
.cs-hit:hover{background:var(--dsw-alias-bg-layer-2)}
.cs-hit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cs-head{display:flex;gap:6px;align-items:baseline;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:3px}
.cs-seq{font-variant-numeric:tabular-nums}
.cs-snip{font-size:12px;line-height:1.5;word-break:break-word}
.cs-snip mark{background:transparent;color:var(--dsw-alias-brand-primary)}
.cs-empty{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.cs-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
`;

    const ensureStyle = () => {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      document.head.appendChild(el);
    };

    const h = React.createElement;
    const TYPE_LABEL = {
      "user/message": "用户",
      "assistant/message": "助手",
      "tool/call": "工具调用",
      "tool/result": "工具结果",
      "turn/end": "轮次结束",
      "session/title": "标题",
    };

    function waitForRow(turn, ms) {
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

    function flash(row) {
      const previous = row.style.outline;
      const previousOffset = row.style.outlineOffset;
      row.style.outline = "2px solid var(--dsw-alias-brand-primary)";
      row.style.outlineOffset = "-2px";
      setTimeout(() => {
        row.style.outline = previous;
        row.style.outlineOffset = previousOffset;
      }, 1600);
    }

    /** 滚到对话里的那一轮;对话没开着时返回 false,由调用方给一句提示。 */
    async function reveal(sessionId, hit) {
      const sessions = clientCtx && typeof clientCtx.get === "function" ? clientCtx.get("sessions") : undefined;
      const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
      const session = binding && binding.session;
      const selector = '[data-chat-turn="' + hit.turn + '"]';
      let row = document.querySelector(selector);
      if (row === null && session && typeof session.loadThrough === "function") {
        try {
          await session.loadThrough(hit.seq);
        } catch {
          /* 分页失败就按当前已加载的找 */
        }
        row = await waitForRow(hit.turn, 1500);
      }
      if (row === null) return false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      flash(row);
      return true;
    }

    function Snippet(props) {
      const text = props.text;
      const at = props.matchAt;
      const length = props.query.length;
      if (at < 0 || at + length > text.length) return h("div", { className: "cs-snip" }, text);
      return h("div", { className: "cs-snip" }, [
        text.slice(0, at),
        h("mark", { key: "m" }, text.slice(at, at + length)),
        text.slice(at + length),
      ]);
    }

    function SearchPane(props) {
      React.useEffect(() => ensureStyle(), []);
      const sessionId = props.sessionId;
      const [query, setQuery] = React.useState("");
      const [state, setState] = React.useState({ status: "idle", data: null, error: null });
      const [notice, setNotice] = React.useState("");
      const runId = React.useRef(0);

      React.useEffect(() => {
        const needle = query.trim();
        if (!sessionId || needle === "") {
          setState({ status: "idle", data: null, error: null });
          return void 0;
        }
        const id = ++runId.current;
        setNotice("");
        const timer = setTimeout(() => {
          setState((previous) => ({ status: "loading", data: previous.data, error: null }));
          const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
          const url = "/conversation-search/search?session=" + encodeURIComponent(sessionId) + "&q=" + encodeURIComponent(needle);
          fetch(url, ctl ? { signal: ctl.signal, cache: "no-store" } : { cache: "no-store" })
            .then((response) => {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then((json) => {
              if (id !== runId.current) return;
              if (json && json.error) throw new Error(String(json.error));
              setState({ status: "ready", data: json, error: null });
            })
            .catch((error) => {
              if (id !== runId.current) return;
              if (error && error.name === "AbortError") return;
              setState({ status: "error", data: null, error: String((error && error.message) || error) });
            });
        }, 280);
        return () => clearTimeout(timer);
      }, [sessionId, query]);

      const open = (hit) => async () => {
        if (!sessionId) return;
        setNotice("");
        const ok = await reveal(sessionId, hit);
        if (!ok) setNotice("没找到「对话」里的这一轮;切到「对话」再点一次");
      };

      const data = state.data;
      const hits = data && Array.isArray(data.hits) ? data.hits : [];
      const meta = state.status === "error"
        ? "搜索失败:" + state.error
        : state.status === "loading"
          ? "搜索中…"
          : data
            ? data.total + " 条命中" + (data.truncated ? "(显示前 " + data.returned + " 条)" : "") + " · " + (data.log ? data.log.id : "")
            : "";

      const rows = hits.map((hit) => h("button", {
        key: hit.seq,
        className: "cs-hit",
        onClick: open(hit),
        title: "跳到第 " + hit.turn + " 轮(seq " + hit.seq + ")",
      }, [
        h("div", { key: "head", className: "cs-head" }, [
          h("span", { key: "turn" }, "T" + hit.turn),
          h("span", { key: "type" }, TYPE_LABEL[hit.type] || hit.type),
          h("span", { key: "seq", className: "cs-seq" }, "seq " + hit.seq),
        ]),
        h(Snippet, { key: "snip", text: hit.text, matchAt: hit.matchAt, query: data.query }),
      ]));

      return h("div", { className: "cs-root" }, [
        h("input", {
          key: "input",
          className: "cs-input",
          type: "search",
          value: query,
          autoFocus: true,
          placeholder: "在对话里搜关键词",
          "aria-label": "在对话里搜关键词",
          onChange: (event) => setQuery(event.target.value),
        }),
        sessionId ? h("div", { key: "meta", className: "cs-meta" }, meta) : h("div", { key: "meta", className: "cs-meta" }, "还没有选中会话"),
        notice !== "" ? h("div", { key: "notice", className: "cs-hint" }, notice) : null,
        h("div", { key: "list", className: "cs-list" }, [
          rows.length > 0
            ? rows
            : h("div", { key: "empty", className: "cs-empty" },
              state.status === "ready" ? "没有匹配的内容" : "输入关键词,回车或停顿即搜索"),
        ]),
      ]);
    }

    return {
      inject: ["slots", "sidebarRightTabs"],
      apply(ctx) {
        clientCtx = ctx;
        ctx.sidebarRightTabs.register({
          id: "dsh-conversation-search",
          kind: "conversation-search",
          title: () => "对话搜索",
          guide: [{
            id: "conversation-search",
            order: 30,
            title: () => "对话搜索",
            description: () => "在当前会话里搜关键词,点结果跳到那一轮",
          }],
        });
        const slots = ctx.slots;
        if (!slots) return;
        slots.inject("sidebar.right.pane.tab", () => slots.register({
          name: "sidebar.right.pane.tab",
          id: "dsh-conversation-search",
        }, SearchPane));
      },
    };
  },
});
