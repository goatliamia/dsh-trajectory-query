# dsh-trajectory-query

[中文](README.md)

Explore and diagnose Agent conversations: execution paths, context composition, tool and file use, original evidence, and improvements you can verify. Includes DSH plugins plus Pi / Codex analysis tools and standalone conversation views.

| Component | Entry point | Purpose |
|---|---|---|
| `dsh-trajectory-tools` | DSH model tools | Four read-only entries: search history, read originals, inspect relations, collect diagnostic evidence |
| `dsh-analysis-view` | DSH Analysis / Path tabs | Turns, usage, tools, incidents and on-demand interpretation; execution paths, context, files, Skills and subagents |
| `dsh-conversation-search` | DSH right sidebar | Search the current conversation and jump to a turn |
| `trajectory-portable-tools` | Pi extension / Codex MCP / CLI | The same four tools for latency, usage, repeated attempts, tool/file access and context |

Query tools are read-only, with continued access to full arguments and results. DSH interpretation makes a model call; its optional post-compaction check-in is enabled by default, as described below.

## Requirements

- DSH: verified with SDK 0.2.2-alpha.2 and Web GUI; Node.js 18+. Default profile: `~/.dsh/profiles/web`.
- Pi / Codex tools: Node.js 20+. The native Pi extension requires Pi; online Codex reads require the official `codex app-server`. Offline file analysis does not start a model.

## Install the DSH plugins

The three DSH packages are local file dependencies, not published to npm. Pack each directory:

```sh
cd plugin/trajectory-tools && pnpm pack
cd ../analysis-view && pnpm pack
cd ../conversation-search && pnpm pack
```

Place the `.tgz` files in a stable location and add dependencies and bundles to `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": {
    "dsh-trajectory-tools": "file:/absolute/path/dsh-trajectory-tools-0.5.1.tgz",
    "dsh-analysis-view": "file:/absolute/path/dsh-analysis-view-0.10.30.tgz",
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

```sh
cd ~/.dsh/profiles/web && pnpm install
```

Restart `dsh web`. Host plugins do not hot-reload reliably; client-only changes need a page refresh.

## Four evidence tools

| Tool | Purpose |
|---|---|
| `trajectory_inspect` | `overview`, `latency`, `cost` (usage and declarations), `repeats`, `io` (tools/files), `context` |
| `trajectory_search` | `events` literal search, `catalog` counts and ranges, `cost` usage, `sessions` list |
| `trajectory_read` | Original records, connected actions and feedback; continue through full arguments, results and diffs |
| `trajectory_graph` | Event relations and session lineage |

Example model-side DSH calls:

```js
trajectory_inspect({ view: "overview" })
trajectory_search({ view: "sessions" })
trajectory_search({ view: "events", query: "keyword" })
trajectory_read({ session: "SESSION_ID", seq: 123 })
trajectory_graph({ session: "SESSION_ID", seq: 123 })
```

Reuse the returned `snapshot` to change ranges or focus on a tool or file, then follow read pointers. Evidence retains native identities and `seq@logId`; an empty result is limited to the selected scope and filters.

DSH includes the `trajectory-query` skill; Pi / Codex include a short [trace-analysis skill](.agents/skills/trace-analysis/SKILL.md). Host parameters differ; see [DSH tools](plugin/trajectory-tools/README.md) and [Pi / Codex tools](plugin/portable-tools/README.md).

**DSH post-compaction check-in:** enabled by default. After successful compaction, the model is asked at the end of the turn to state its task, progress and next action. This can add a model step. Disable with `config.reconcile: false`.

## DSH Analysis and Path

- **Analysis:** turns, tool calls, failures, cache, per-turn usage, tool distribution and evidence-backed incidents. On-demand interpretation makes one call using the current model.
- **Path:** session overview and individual turns, trunk, branches and time axis; context composition, file changes, tool arguments/results, Skills and subagents.
- **Long conversations:** the actual trunk appears first, followed by details and other layers. Selected turns get priority; earlier context increments can be loaded separately.
- **Conversation search:** keyword search in the sidebar, chat messages by default with optional tool output; click a hit to jump to its turn.

```text
GET /analysis-view/digest?session=<id>          # statistics; &fresh=1 bypasses cache
GET /analysis-view/interpret?session=<id>       # on-demand interpretation; uses a model call
GET /analysis-view/trace?session=<id>           # standalone Path snapshot
GET /analysis-view/trace?staged=1&session=<id>  # staged Path page
GET /analysis-view/trace-data?session=<id>&stage=core
GET /conversation-search/search?session=<id>&q=<term>&scope=chat|all
```

See [Analysis](plugin/analysis-view/README.md) and [Conversation search](plugin/conversation-search/README.md).

## Pi / Codex

Install the tool dependencies from the repository root:

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
```

Pi can load the native extension to inspect the current branch and SDK tool inventory, or analyze a Session v3 JSONL file offline:

```sh
pi -e ./plugin/portable-tools
# Or analyze offline
node scripts/trajectory-query.mjs --host pi --file /absolute/session.jsonl --request query.json
```

Codex supports MCP integration or CLI analysis of a thread / official snapshot:

```sh
node scripts/trajectory-query.mjs --host codex --thread THREAD_ID --request query.json
node scripts/trajectory-query.mjs --host codex --file /absolute/snapshot.json --request query.json
```

Example `query.json`:

```json
{"view":"overview"}
```

See [setup and parameters](plugin/portable-tools/README.md) for MCP configuration, scope selection, full-body continuation and tool-definition queries.

The native Pi extension can read current configuration; historical files are not a current inventory. Codex analyzes recorded tool declarations. Text composition and definition sizes are estimates; recorded usage is reported separately. Codex was verified with a real conversation. Pi native logs and extension interfaces were tested; a real Pi process has not been verified here.

## Standalone conversation views

Pi / Codex can generate standalone pages using the project's palette and execution path. Select multiple context sources above the graph; delta and total trends can be shown together.

```sh
# Native Pi session
node scripts/build-pi-demo.mjs --session /absolute/session.jsonl
# Codex: read-only export and view generation
node scripts/export-codex-thread.mjs --thread THREAD_ID
# Start local previews
node scripts/serve-layout-review.mjs 3086
```

Open `http://127.0.0.1:3086/pi` or `http://127.0.0.1:3086/codex`. Without `--session`, the Pi builder creates a clearly labeled synthetic example and requires a local Pi source repository. See [Pi](docs/demo/layout-review/PI.md) / [Codex](docs/demo/layout-review/CODEX.md) for options. These are independent previews; existing DSH view routes stay the same.

Exports, generated pages and screenshots are kept in Git-ignored `.dsh/`, outside repository commits.

## Self-tests

```sh
node analyzers/self-test.mjs
node analyzers/host-self-test.mjs
node analyzers/shape-law.mjs
npm test --prefix plugin/trajectory-tools
node plugin/analysis-view/self-test.mjs
node plugin/conversation-search/self-test.mjs
npm test --prefix plugin/portable-tools
node analyzers/pi-adapter-test.mjs
node analyzers/codex-adapter-test.mjs
```

## Files and documentation

- `plugin/`: three DSH plugins and portable Pi / Codex tools.
- `analyzers/`: deterministic analyzers, host adapters and self-tests.
- `scripts/`: export, query CLI and standalone view builders.
- `skill/`, `.agents/skills/`: model usage instructions.
- `docs/`: usage, research and experiment records; [diagnostic entry points](docs/diagnostics.md).
- `experiments/`: test corpora, probes and reports.

## Versions

| Package | Version |
|---|---|
| dsh-trajectory-tools | 0.5.1 |
| dsh-analysis-view | 0.10.30 |
| dsh-conversation-search | 0.2.1 |
| trajectory-portable-tools | 0.1.0 |

## License

MIT © 2026 goatliamia, see [LICENSE](LICENSE).
