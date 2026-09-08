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

## Principles

1. **Detection is deterministic; interpretation belongs to the model.** What counts as an incident
   is decided by analyzers over typed events. The model explains, it does not invent.
2. **Projection = selection + pointer, not rewriting.** Retrieval returns a trimmed original and
   quotes it verbatim, each with `(session, seq@logId)`.
3. **The panel renders evidence only.** Surface patterns — tool-name counts, name-only repeats —
   are not incidents.
4. **Nothing is stored as "memory".** Analyses are derived views, recomputable from the log.

## Features

**Historical query tools (agent-facing)** — the resident host plugin `dsh-trajectory-tools`
registers four read-only tools (`trajectory_sessions / find / window / trace`) that read the event
log DSH already keeps (live sessions from an in-memory snapshot, settled sessions through a
`sessionPersistence` handle) without depending on `ctx.sessionQuery`. Evidence-first: every answer
carries `(session, seq@logId)` and quotes the original text verbatim; a search that returns nothing
is a verifiable "no such fact". The plugin also registers the `trajectory-query` runtime skill, so
the discipline travels with the tools and no agent preset has to be edited.

**Resident Analysis tab (Web GUI)** — a third tab beside *Conversation | Trajectory* that renders a
**runtime incident view**:

| Element | What it shows |
|---|---|
| Incident cards | `Event / Cause / Runtime knew / Model knew / Harness response / Impact`, with evidence `seq` chips that jump to the trajectory |
| Turn map | one cell per turn; red = that turn has a failure (clickable), grey = normal |
| Mechanical facts | deterministic numbers, plus explicit `needs host` markers |
| Open interpretation | collapsed; generated **only when expanded**, by the analysis skill over bounded evidence, every claim citing `(session, seq)` |

**Host routes** — `GET /analysis-view/digest?session=<id>` returns deterministic incidents (same-args repeat / failures / no-op turns); `GET /analysis-view/interpret?session=<id>` calls the model once, only when *Open interpretation* is expanded, and returns a cited interpretation. Both carry a **`log` identity** (`id` / `events` / `seq` range); citations read `(session, seq@logId)`, so a seq cannot be misread across log revisions.

**Mechanical analyzers** — five deterministic folds: `turns / tools / errors / retry / incidents`.
Same-argument repeats, failed calls and no-op turns are decided by code, not by a model.
`analyzers/self-test.mjs` pins the semantics.

**Analysis skill** — `skill/analysis.md`: how to turn a research question into a verifiable
analysis (evidence discipline, dimension discovery, analyzer contract). It defines entry points,
not conclusions.

**Query skill** — `skill/trajectory-query.md` (registered as a runtime skill by the plugin):
query before answering, quote verbatim, cite `(session, seq@logId)`, and treat an empty result as
verifiable absence.

**Reports** — `analyzers/run-digest.mjs` turns one session into reproducible `*.facts.json` +
`*.digest.md`.

## Usage

```text
# analyzers — no DSH required
node analyzers/run-digest.mjs <session.jsonl.zstd>
node analyzers/self-test.mjs

# two resident plugins — install into your web profile (see each README)
#   plugin/trajectory-tools  — four query tools + the trajectory-query skill
#   plugin/analysis-view     — resident Analysis tab + digest/interpret routes
```

## Layout

- `plugin/trajectory-tools/` — host plugin: four read-only query tools + bundled runtime skill
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
#     "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.1.3.tgz"
#     "dsh-analysis-view":    "file:<abs path>/dsh-analysis-view-0.1.0.tgz"
#   dsh.profile.bundles: append "dsh-trajectory-tools" and "dsh-analysis-view"
pnpm install            # in ~/.dsh/profiles/web
# reload / restart `dsh web` (host plugins do not hot-reload reliably)
```

## Known gaps

- The panel's incidents come from the host route `/analysis-view/digest` (same-args repeat, no-op turn and harness response are decided on the host); the panel renders evidence only.
- `Harness response` is derived from error codes (guard intercepted / no guard, model must self-correct), not a template.
- Host analysis and `analyzers/incidents.mjs` are two implementations (runtime cannot import repo scripts); each is pinned by its own self-test.
- Settled sessions are read via `sessionPersistence.open(id, 'read')` (v0.1.3+); a legacy `inspect()` fallback remains.
- `seq` is only stable inside one log revision, so citations must carry `logId`; after a version rewrite an old `seq` may point at a different event.
- The query tools are a host plugin: after installing them, `dsh web` must be reloaded before they appear in the model's tool list. Their contract is pinned by `plugin/trajectory-tools/self-test.mjs` (40 checks).

## License

MIT © 2026 goatliamia — see [LICENSE](./LICENSE)
