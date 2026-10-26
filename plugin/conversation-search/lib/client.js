// dsh-conversation-search client half — 右侧栏的「对话搜索」tab。
// 一次搜索按"轮次"给结果:第几轮、你问了什么、命中的那句话;点一轮滚到对话里对应的位置。
window.__ModuleLoader__.load({
  id: "dsh-conversation-search",
  factory: (require) => {
    const React = require("react");
    let clientCtx = null;

    const STYLE_ID = "dsh-conversation-search-style";
    const CSS = `
.cs-root{display:flex;flex-direction:column;height:100%;min-height:0;padding:10px;font-size:13px;color:var(--dsw-alias-label-primary)}
.cs-bar{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.cs-input{flex:1;min-width:0;box-sizing:border-box;height:30px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;padding:0 8px;outline:none}
.cs-input::placeholder{color:var(--dsw-alias-label-secondary)}
.cs-input:focus{border-color:var(--dsw-alias-brand-primary)}
.cs-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;min-height:14px}
.cs-scope{margin-left:auto;display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none}
.cs-scope input{margin:0}
.cs-list{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1)}
.cs-turn{display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px 8px;cursor:pointer;font:inherit;color:inherit}
.cs-turn:hover{background:var(--dsw-alias-bg-layer-2)}
.cs-turn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.cs-turn-head{display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:5px}
.cs-count{margin-left:auto;font-variant-numeric:tabular-nums}
.cs-match{display:flex;gap:8px;font-size:12px;line-height:1.65;margin-top:3px}
.cs-role{flex:none;width:30px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.7}
.cs-prompt{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cs-text{flex:1;min-width:0;word-break:break-word}
.cs-text mark{background:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:inherit;font-weight:500;border-radius:2px;padding:0 1px}
.cs-empty{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.cs-hint{font-size:11px;color:var(--dsw-alias-label-secondary);padding:2px 0}
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

    function Mark(props) {
      const at = props.matchAt;
      const length = props.query.length;
      const text = props.text;
      if (at < 0 || at + length > text.length) return h(React.Fragment, null, text);
      return h(React.Fragment, null, [text.slice(0, at), h("mark", { key: "m" }, text.slice(at, at + length)), text.slice(at + length)]);
    }

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
    async function reveal(sessionId, group) {
      const sessions = clientCtx && typeof clientCtx.get === "function" ? clientCtx.get("sessions") : undefined;
      const binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
      const session = binding && binding.session;
      const seq = group.matches.length > 0 ? group.matches[0].seq : group.promptSeq;
      let row = document.querySelector('[data-chat-turn="' + group.turn + '"]');
      if (row === null && seq !== null && seq !== undefined && session && typeof session.loadThrough === "function") {
        try {
          await session.loadThrough(seq);
        } catch {
          /* 分页失败就按当前已加载的找 */
        }
        row = await waitForRow(group.turn, 1500);
      }
      if (row === null) return false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      flash(row);
      return true;
    }

    function SearchPane(props) {
      React.useEffect(() => ensureStyle(), []);
      const sessionId = props.sessionId;
      const [query, setQuery] = React.useState("");
      const [scope, setScope] = React.useState("chat");
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
          const url = "/conversation-search/search?session=" + encodeURIComponent(sessionId) +
            "&q=" + encodeURIComponent(needle) + "&scope=" + scope;
          fetch(url, { cache: "no-store" })
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
              setState({ status: "error", data: null, error: String((error && error.message) || error) });
            });
        }, 280);
        return () => clearTimeout(timer);
      }, [sessionId, query, scope]);

      const open = (group) => async () => {
        if (!sessionId) return;
        setNotice("");
        const ok = await reveal(sessionId, group);
        if (!ok) setNotice("没找到「对话」里的这一轮;切到「对话」再点一次");
      };

      const data = state.data;
      const groups = data && Array.isArray(data.turns) ? data.turns : [];
      const meta = state.status === "error"
        ? "搜索失败:" + state.error
        : data
          ? data.matchedTurns + " 轮 · " + data.totalMatches + " 处" + (data.truncated ? "(显示前 " + data.returnedTurns + " 轮)" : "")
          : state.status === "loading" ? "搜索中…" : "";

      const cards = groups.map((group) => {
        const promptIsMatch = group.matches.some((match) => match.seq === group.promptSeq);
        return h("button", {
          key: group.turn,
          className: "cs-turn",
          onClick: open(group),
          title: "跳到第 " + group.turn + " 轮",
        }, [
          h("div", { key: "head", className: "cs-turn-head" }, [
            h("span", { key: "t" }, "第 " + group.turn + " 轮"),
            h("span", { key: "c", className: "cs-count" }, group.count + " 处"),
          ]),
          group.prompt !== "" && !promptIsMatch
            ? h("div", { key: "prompt", className: "cs-match" }, [
              h("span", { key: "r", className: "cs-role" }, "你"),
              h("span", { key: "t", className: "cs-prompt" }, group.prompt),
            ])
            : null,
          group.matches.map((match) => h("div", { key: match.seq, className: "cs-match" }, [
            h("span", { key: "r", className: "cs-role" }, match.role),
            h("span", { key: "t", className: "cs-text" }, h(Mark, { text: match.text, matchAt: match.matchAt, query: data.query })),
          ])),
        ]);
      });

      return h("div", { className: "cs-root" }, [
        h("div", { key: "bar", className: "cs-bar" }, [
          h("input", {
            key: "input",
            className: "cs-input",
            type: "search",
            value: query,
            autoFocus: true,
            placeholder: "在对话里搜关键词",
            "aria-label": "在对话里搜关键词",
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Escape") setQuery("");
            },
          }),
        ]),
        h("div", { key: "meta", className: "cs-meta" }, [
          h("span", { key: "m" }, sessionId ? meta : "还没有选中会话"),
          h("label", { key: "scope", className: "cs-scope", title: "默认只搜你和助手说过的话" }, [
            h("input", {
              type: "checkbox",
              checked: scope === "all",
              onChange: (event) => setScope(event.target.checked ? "all" : "chat"),
            }),
            "也搜工具",
          ]),
        ]),
        notice !== "" ? h("div", { key: "notice", className: "cs-hint" }, notice) : null,
        h("div", { key: "list", className: "cs-list" }, [
          cards.length > 0
            ? cards
            : h("div", { key: "empty", className: "cs-empty" },
              state.status === "ready" ? "没有匹配的内容" : "输入关键词,停顿即搜索"),
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
          key: "dsh-conversation-search",
        }, SearchPane));
      },
    };
  },
});
