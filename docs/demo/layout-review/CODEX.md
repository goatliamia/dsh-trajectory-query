# Codex host adapter

`/codex` uses the same event graph, file objects, result branches, branch collision layout, selection and navigation as `/geist`. Build `/geist` first. Codex-specific explanations and measurement semantics live in `codex-host.js`; no DSH plugin installation is involved.

```powershell
node scripts/build-geist-demo.mjs
node scripts/export-codex-thread.mjs --thread <thread-id>
node analyzers/codex-adapter-test.mjs
```

To rebuild an existing snapshot without another official read:

```powershell
node scripts/build-codex-demo.mjs
node scripts/build-codex-demo.mjs --api-only --out .dsh/codex-review/api-only.html
```

The official reader uses only `initialize`, `thread/read` and `thread/turns/list`. The adapter optionally reads the thread's own local rollout file, bounded by the API snapshot capture timestamp and checked against its thread ID. That file format is a local, unstable source, not a stable public API.

The payload preserves `official-api`, `local-rollout` and `estimate` evidence. An action node represents an observed reply or operation, not a model request. Native API item order is preserved. Local `item_completed` records match on item ID to provide actual start/end times; absent times remain unmeasured. Native command duration is retained separately. No equal division of a turn's time is presented as measured timing.

Commands are independently classified using their parameters, literal read primitives, output and exit state even when `commandActions` says `unknown`. Dynamic/glob paths stay unasserted. Literal reads in scripts remain intentions inside a process, not proof that every conditional branch ran. Failed process reads are not counted as successful reads. File changes keep their native path, kind and diff. Same-operation recovery requires full matching parameters in the same turn and a later successful result.

Actual last-request input and context-window telemetry are separate from source estimates. Visible retained text is estimated by CJK characters plus other characters divided by four; compaction resets the visible projection from `replacement_history`. Hidden reasoning, encrypted compaction summaries, media tokens and unrecorded definitions are excluded, never treated as known zero. Mixed tool output is classified as skill content only for exact matching source text, or an unambiguous exclusive skill read. Candidate current skill files are used only if their bytes match the historical returned text. Skill path references in catalogs do not imply activation, compliance or causal influence.

Native `collabAgentToolCall` supports receiver thread IDs and states. A local `collaboration.spawn_agent` call can also supply an observed launch and returned task path. When it lacks a receiver thread ID, the graph shows the launch point through the existing branch packer; it does not fabricate a child execution interval or internal history. That linkage is an outstanding host capability.
