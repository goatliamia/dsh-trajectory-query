# dsh-trajectory-query — make saved trajectories reachable again

[中文](./README.md) | English

> **DSH already records every fact; what is missing is the path to get it back when you need it.**
> So this is not a memory system: no summaries, no embeddings, no "what is worth remembering".

## Why it exists

A DSH session is an append-only event log: the near past is in context, the far past is condensed
by compaction or simply not loaded after a resume. Two concrete problems follow:

- **For agents** — once context is gone, the model can only guess from a summary ("what was that
  error code again?"), while the original events are still in the log; there is simply no tool to
  fetch them. That is a missing read path, not missing memory.
- **For researchers** — the built-in trajectory view is a horizontal timeline (input / model /
  tools). It shows how much and how long, but not **what actually happened and why the harness
  reacted the way it did** — events, causality and consequences are not organized.

So the project does two small things: give agents a way to **query back for evidence**, and turn a
trajectory into an **evidence-cited incident view**. No DSH core changes.

## What it looks like

One real query (this repository's own session):

```text
search(view="events", session="session-e0636aa9-…", query="FS_NOT_OBSERVED", filter={types:["tool/result"]})
→ seq=1248  tool/result  FsError:FS_NOT_OBSERVED
  log=2981dc3bba29

read(session="session-e0636aa9-…", seq=1248)
→ the verbatim text of seq 1243…1253 (tool call / error / assistant output)
```

The same session, organized into cards in the **Analysis** tab — this is real output:

```text
调用失败 ×15        Event    15 tool calls returned an error
                    Cause    a tool call returned an error result
                    Runtime  error code / failure state is already in the event
                    Model    received the tool result (may already carry the error)
                    Harness  part of it was intercepted by guards (FsError:FS_NOT_OBSERVED, WebError:WEB_BLOCKED_URL); the rest needs model self-correction
                    Impact   that part of the goal was not achieved
                    seq      251 · 351 · 357 · 1032 · 1248 · 1250 · …
```

The three parts are **facts** (verbatim events + location), **attribution** (what Runtime and the
Model each knew), and **consequences** (harness response and impact). Each `seq` chip jumps to the
trajectory view.

## Principles

1. **Detection is deterministic; interpretation belongs to the model.** What counts as an incident
   is decided by analyzers over typed events. The model explains, it does not invent.
2. **Projection = selection + pointer, not rewriting.** Retrieval returns a trimmed original and
   quotes it verbatim, each with `(session, seq@logId)`.
3. **The panel renders evidence only.** Surface patterns — tool-name counts, name-only repeats —
   are not incidents.
4. **Nothing is stored as "memory".** Analyses are derived views, recomputable from the log.

## Features

Three things: **fetch facts**, **organize facts**, **constrain the discipline**.

**1. Historical query tools (agent-facing)** — the resident host plugin `dsh-trajectory-tools`
registers three read-only entries split by question, not by data source: `trajectory_search` (`view` is
required: `events` literal hits / `catalog` counts and ranges / `cost` tokens / `sessions` list),
`trajectory_read` (verbatim text for a seq range) and `trajectory_graph` (replacement/source/derived
chains and lineage). They read the event
log DSH already keeps (preferred: `sessionQuery.observeSession`; compatible fallbacks: the in-memory
snapshot and a `sessionPersistence` handle). Evidence-first: every answer
carries `(session, seq@logId)` and quotes the original text verbatim, with a snippet centred on the
match; a search that returns nothing is a verifiable "no such fact". Without `session`,
`search(view="events")` covers the current session plus every live session by default, and drops
injected boilerplate and the tools' own calls (`filter.excludeInjected` / `filter.excludeSelf`);
matching is normalized (`filter.normalize`), so a single-backslash path finds the escaped form in the
log. Optional narrowing lives in one `filter` object whose keys depend on the view; `view="catalog"`
is the "see what is queryable before guessing a word" entry.

**Optional: reconcile after a compaction (on by default)** — built for one symptom: once the context
is compacted, the model tends to put its head down and keep working, without asking and without ever
saying what it now thinks the job is. The compacted part really is gone from its view, yet its tone is
indistinguishable from a model that lost nothing — and by the time you notice the direction is wrong,
it may have spent many steps on it. So after a **successful** `compaction/end` the plugin marks that
session, and at the turn's stop boundary (`agent/turn-stopping`) injects one sentence: in two lines,
say what you understand the job to be, where you are, and what comes next — re-query the log with
`trajectory_search` where you are unsure, ask the human where the log cannot answer. It arrives as a
`plugin` notice (`form: "notice"` plus a human-facing `summary`), so who is talking is declared rather
than inferred from the text, and it registers no tool schema — zero bytes added to the tool table. One
compaction earns one reconcile, subagent children are skipped; it is on by default, `config.reconcile: false`
turns it off, `config.reconcile.sentence` replaces the wording (see the
[plugin README](plugin/trajectory-tools/README.md#optional-reconcile-after-a-compaction-on-by-default)).

**2. Resident Analysis tab (Web GUI)** — a third tab beside *Conversation | Trajectory* that renders
a **runtime incident view**:

| Element | What it shows |
|---|---|
| Incident cards | `Event / Cause / Runtime knew / Model knew / Harness response / Impact`, with evidence `seq` chips that jump to the trajectory |
| Turn map | one cell per turn; red = that turn has a failure (clickable), grey = normal |
| Mechanical facts | deterministic numbers, plus explicit `needs host` markers |
| Open interpretation | collapsed; generated **only when expanded**, by the analysis skill over bounded evidence, every claim citing `(session, seq)` |

**Host routes** — `GET /analysis-view/digest?session=<id>` returns deterministic incidents (same-args repeat / failures / no-op turns); `GET /analysis-view/interpret?session=<id>` calls the model once, only when *Open interpretation* is expanded, and returns a cited interpretation. Both carry a **`log` identity** (`id` / `events` / `seq` range); citations read `(session, seq@logId)`, so a seq cannot be misread across log revisions.

**Mechanical analyzers** — six deterministic folds: `turns / tools / errors / retry / incidents / cost`.
Same-argument repeats, failed calls and no-op turns are decided by code, not by a model; tokens and
cache efficiency are folded straight out of `assistant/message.usage` with no new instrumentation.
Each analyzer owns a `summary(facts)`, so the runner renders the table directly (a missing summary shows
`(no summary)` instead of a silent blank cell); `analyzers/self-test.mjs` pins the semantics and
that contract.

**Reports** — `analyzers/run-digest.mjs` turns one session into reproducible `*.facts.json` +
`*.digest.md` (each table row comes from its analyzer's own `summary`, so adding an analyzer no
longer means editing the runner).

**3. Two skills** — `trajectory-query` (registered as a runtime skill by the query plugin): query
before answering, quote verbatim, cite `(session, seq@logId)`, and treat an empty result as
verifiable absence; `analysis.md`: how to turn a research question into a verifiable analysis
(evidence discipline, dimension discovery, analyzer contract) — it defines entry points, not
conclusions.

**One declaration for the shape** — the ten fields of the `incidents` fact are declared in
`plugin/analysis-view/lib/incident-shape.js` (it lives in the package, because the runtime cannot import
repo scripts, so `analyzers/` imports it *back*). Records can only be built through `incident()`, which
throws on a missing field, an undeclared field, a wrong type, or a chip-shaped `seqs`.
`analyzers/shape-law.mjs` turns that into laws: **claim** (every carrier the detector finds must be listed
with a role and a form — forgetting one is itself an error), **drift** (the client half, which cannot
import the declaration, is compared key-by-key in order), **differential** (byte-identical JSON against a
frozen baseline), **witness** (historical artifacts are read and validated, never rewritten). `--mutate`
proves the laws bite, with 13 reasonable mistakes.

## Usage

```text
# 1. let the agent query for itself (once the plugin is installed, the model calls these directly)
search(view="sessions")                                # which sessions are queryable
search(view="events", query="<literal>")               # hits with seq / logId / matchAt
read(session=<id>, seq=<hit seq>)                      # verbatim context
graph(session=<id>, seq=<hit seq>)                     # replacement / source / derived chain
search(view="cost", session=<id>)                      # tokens and cache efficiency

# 2. read the Analysis panel: the "Analysis" tab in the Web GUI (current session)
#    or hit the host route directly:
curl "http://127.0.0.1:3080/analysis-view/digest?session=<id>"

# 3. offline analyzers (no DSH required)
node analyzers/run-digest.mjs <session.v3.jsonl.zstd>   # for a migrated session use v3, not the stale v2 copy
node analyzers/self-test.mjs
```

## Layout

- `plugin/trajectory-tools/` — host plugin: three read-only entries (search/read/graph) + bundled runtime skill
- `plugin/analysis-view/` — resident Analysis tab (client + host routes)
- `analyzers/` — deterministic analyzers, digest runner, self-test
- `skill/` — `trajectory-query.md` (query discipline), `analysis.md` (analysis method)
- `docs/` — design notes and the experiment protocol
- `experiments/` — corpora, probes, manifests, generated reports

## Install (both resident plugins)

```text
pnpm pack                                  # in each plugin directory
# ~/.dsh/profiles/web/package.json:
#   dependencies: add
#     "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.3.1.tgz"
#     "dsh-analysis-view":    "file:<abs path>/dsh-analysis-view-0.1.3.tgz"
#   dsh.profile.bundles: append "dsh-trajectory-tools" and "dsh-analysis-view"
pnpm install            # in ~/.dsh/profiles/web
# restart `dsh web` (host plugins do not hot-reload reliably)
```

## Verify

```text
cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs   # ALL PASS (175 checks)
node analyzers/self-test.mjs        # analyzer semantics
node analyzers/host-self-test.mjs   # host-side incident detection
node analyzers/shape-law.mjs        # incident shape: claim / drift / differential / witness
node analyzers/shape-law.mjs --mutate   # 13 reasonable mistakes; escapes must be 0
```

After restarting `dsh web`, confirm that the model's tool list contains the three entries
`trajectory_search` / `trajectory_read` / `trajectory_graph` (no longer six), that the skill catalog
contains `trajectory-query`, that `search(view="events")` results carry `matchAt` / `filtered` /
`normalized`, that `graph` chains come back as `{count, head, tail}`, and that
`/analysis-view/digest` returns 200 for a settled session. The compaction reconcile only shows up once
a compaction actually happens (to see it right away, run `/compact` in a session and then send any
short message): that turn ends with one extra model message, and the host log gains a
`compaction reconcile` line at the same time.

## Known gaps

- The panel's incidents come from the host route `/analysis-view/digest` (same-args repeat, no-op turn and harness response are decided on the host); the panel renders evidence only.
- `Harness response` is derived from error codes (guard intercepted / no guard, model must self-correct), not a template.
- Host analysis and `analyzers/incidents.mjs` are two implementations (runtime cannot import repo scripts); each is pinned by its own self-test.
- Sessions are read via `sessionQuery.observeSession(id)` (DSH 0.1.6 deprecated the synchronous readers such as `snapshotEvents`; fallbacks: in-memory snapshot → `sessionPersistence.open(id, 'read')` → legacy `inspect()`).
- `seq` is only stable inside one log revision, so citations must carry `logId`; after a version rewrite an old `seq` may point at a different event.
- The query tools are a host plugin: `dsh web` must be restarted before they appear in the model's tool list; if a tool name is already taken the plugin fails loudly instead of half-registering. Its contract is pinned by `plugin/trajectory-tools/self-test.mjs` (175 checks).
- The compaction reconcile speaks only when a `compaction/end` succeeded *and* that turn reaches its stop boundary: failed compactions (no new projection) and subagent sessions are skipped, and a failed injection does not break the turn — it leaves one `warn` line in the host log. Whether to reconcile is decided by a session-scoped mark (one per compaction), not by the model's guess.
- Without `session`, `view="events"` scans the current session + every live session + a few persisted ones; persisted sessions are ranked by `createdAt` (there is no cheap last-activity signal), so pass `session` explicitly for a long-settled session.
- `trajectory_graph` is the only one of the three that depends on `ctx.sessionQuery`; search and read need only `sessions` / `sessionPersistence`.
- Every host/client API these plugins use was checked against DSH 0.1.6-alpha.2: the `defineTool` parameter DSL, the `sessionQuery` method set, `SessionHandle`, `skills.register`, `webServer.register`, `llm.stream`, `agent/turn-stopping` + `agent.steer`, the `conversation.view` slot and `uiConversation.views/binding` are unchanged; the only migration needed is the deprecated synchronous read above.
- Runtime: DSH 0.1.6-alpha.2, plugins 0.3.1 / 0.1.3. The three entries cost about 1.8 KB of tool table (down from 5.7 KB with six); the contract is covered by the 154-check self-test and an offline check on real data — the live check is the **Verify** section above.
- `trajectory_search(view="cost")` reads `assistant/message.usage` only — no new instrumentation. A request whose adapter reported no usage is `unknown` (never zero), and a single missing field is `null` and stays out of the sums. The DeepSeek adapter usually does not report `cacheWriteTokens`: that means "not reported", not "no cache write".
- Trap: after the format migration a session directory keeps **both `session.v3.jsonl.zstd` (current) and `session.v2.jsonl.zstd` (pre-migration copy)**. Pass the v3 file to the analyzers by hand, or you will read the stale copy as if it were the newest session. `experiments/corpus/scan-sessions.mjs` now picks the highest version per directory.

## License

MIT © 2026 goatliamia — see [LICENSE](./LICENSE)
