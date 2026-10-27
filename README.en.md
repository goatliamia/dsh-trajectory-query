# dsh-trajectory-query

Three DSH plugins that make a session already written to the log retrievable, readable and analysable.

| Plugin | Where | What it does |
|---|---|---|
| `dsh-trajectory-tools` | host (model tools) | Three read-only entries: search past events, read a verbatim window, walk relations |
| `dsh-analysis-view` | "Analysis" tab | Turns, spend, tools, incidents, plus an on-demand interpretation |
| `dsh-conversation-search` | right sidebar | Search the current conversation and jump to the matching turn |

No changes to DSH core, nothing written back to the session, no new instrumentation. Design notes live in [docs/design.md](docs/design.md).

## Requirements

- DSH 0.2.1-rc.3 with the Web GUI
- Node.js 18+
- profile at `~/.dsh/profiles/web` (default)

## Install

The packages are local file dependencies, not published to npm.

```bash
# 1. pack (inside each directory)
cd plugin/trajectory-tools    && pnpm pack
cd ../analysis-view           && pnpm pack
cd ../conversation-search     && pnpm pack
```

Copy the `.tgz` files somewhere stable (e.g. `~/Documents/plugins/`), then in `~/.dsh/profiles/web/package.json`:

```jsonc
{
  "dependencies": {
    "dsh-trajectory-tools": "file:/absolute/path/dsh-trajectory-tools-0.3.6.tgz",
    "dsh-analysis-view": "file:/absolute/path/dsh-analysis-view-0.3.19.tgz",
    "dsh-conversation-search": "file:/absolute/path/dsh-conversation-search-0.2.1.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-trajectory-tools",
        "dsh-analysis-view",
        "dsh-conversation-search"
      ]
    }
  }
}
```

```bash
cd ~/.dsh/profiles/web && pnpm install
```

Restart `dsh web`. Host plugins do not hot-reload reliably; client-only changes need a page refresh.

## Features

### Trajectory query tools

Three entries grouped by the question, not by the data source:

| Tool | Purpose |
|---|---|
| `trajectory_search` | `view` required: `events` literal hits, `catalog` counts and ranges, `cost` token spend, `sessions` session list |
| `trajectory_read` | verbatim window by `seq` range, optionally `format: "json"` |
| `trajectory_graph` | replacement / reference / derivation relations, or session lineage |

Every result carries `(session, seq@logId)` and quotes the original text; an empty result is a verifiable "no such fact". The plugin also registers the `trajectory-query` skill.

**Post-compaction check-in** (on by default): after a successful compaction, one short line is injected at the end of the turn asking the model to state what it thinks the task is, where it is, and what comes next. Disable with `config.reconcile: false`.

### Analysis tab

A third tab next to "Chat" and "Trajectory":

| Section | Content |
| Path (separate tab) | the current turn's trunk and detours, turn strip, time axis; click a node for the real event; data is built live from /analysis-view/trace |
|---|---|
| KPI | turns, tool calls, failures, cache hit rate, events |
| Turns | a duration-proportional strip coloured by failures; a failing turn jumps to the trajectory |
| Spend | per-turn cache hit and miss drawn apart, output on its own bar, per-turn hit rate on the right; a row jumps to that turn in the chat. With the official API, each number carries its own cost |
| Tools | three rings: category → that category's tools → which turns used the tool; selecting only changes the last two |
| Incidents | evidence-backed chains: Cause / Runtime knew / Model received / Harness response / Impact, `seq` clickable |
| Interpretation | one model call on demand, every statement carries a citation |

Data comes from two read-only routes:

```text
GET /analysis-view/digest?session=<id>      # deterministic facts, 2s cache, &fresh=1 to bypass
GET /analysis-view/interpret?session=<id>   # on-demand interpretation, spends one model call
```

### Conversation search

A right-sidebar tab next to "Workspace files" and "Terminal". Searches the current conversation and groups hits by turn; chat-only by default, "also search tools" includes tool output. Clicking a hit scrolls the chat to that turn.

```text
GET /conversation-search/search?session=<id>&q=<term>&scope=chat|all
```

## Usage

```bash
trajectory_search(view="sessions")                    # what can be searched
trajectory_search(view="events", query="<literal>")   # hits carry seq / logId
trajectory_read(session=<id>, seq=<hit seq>)          # verbatim context
trajectory_graph(session=<id>, seq=<hit seq>)         # relations
trajectory_search(view="cost", session=<id>)          # tokens and cache

curl "http://127.0.0.1:3080/analysis-view/digest?session=<id>"
```

## Self-tests

```bash
node analyzers/self-test.mjs
node analyzers/host-self-test.mjs
node analyzers/shape-law.mjs
node plugin/trajectory-tools/self-test.mjs
node plugin/analysis-view/self-test.mjs
node plugin/conversation-search/self-test.mjs
```

## Layout

- `plugin/trajectory-tools/` — trajectory query tools (host)
- `plugin/analysis-view/` — analysis tab (host route + client)
- `plugin/conversation-search/` — conversation search (host route + client)
- `analyzers/` — deterministic analyzers, digest runner, self-tests
- `skill/` — `trajectory-query.md`, `analysis.md`
- `docs/` — design notes
- `experiments/` — corpus, probes, generated reports

## Versions

| Package | Version |
|---|---|
| dsh-trajectory-tools | 0.3.6 |
| dsh-analysis-view | 0.3.19 |
| dsh-conversation-search | 0.2.1 |

## License

MIT © 2026 goatliamia, see [LICENSE](LICENSE).
