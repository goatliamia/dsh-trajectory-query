# Pi source-format simulation

`/pi` reuses the same event graph, file objects, result branches, collision packing, actor layer and selection as the DSH and Codex demos. It is visibly labeled as a simulation. No Pi model was started, no credentials were used, and no extension was installed.

Source: local `D:/projects/new loop/pi`, origin `https://github.com/badlogic/pi-mono.git`, current package `@earendil-works/pi-coding-agent` **1.4.0**, fetched revision `ad702637fdf6fbd3f965c5dba0b14bae100b74eb` (2026-10-28). The checkout had three user-modified source files, so its HEAD and files were preserved. The demo reads the fetched revision with `git show`; source hashes and original worktree status are saved to `.dsh/pi-review/source-evidence.json`.

```powershell
node scripts/build-geist-demo.mjs
node scripts/build-pi-demo.mjs
node analyzers/pi-adapter-test.mjs
```

Native Session v3 JSONL and captured event samples are emitted separately as `synthetic-session.jsonl` and `synthetic-events.jsonl`. The outer sample/capture wrapper marks them synthetic. Capture timestamps are not added to native AgentEvent objects.

The sample covers file and skill reads; explicit skill-command expansion; skill catalogs; `edit.edits` and returned `details.diff/patch`; `write.content`; errors followed by exact same-operation success; system/tool declarations; extension custom messages; and compaction with `firstKeptEntryId` and `systemMessage`. The adapter follows the selected parentId path, replays section/tool changes and append-only context edits, and ignores plain custom extension state for context composition.

Each graph step is a Pi assistant response with its following tool results. Runtime tool starts/ends are joined by `toolCallId`; native `durationMs` remains separate. Without captured starts, history-only tool results do not become fabricated execution intervals. Source quantities are visible-text estimates (CJK characters plus other characters divided by four), excluding hidden thinking, images and provider serialization. Synthetic Usage values remain distinct from those estimates. Capacity is unknown and no invented capacity ratio is shown.

Pi's current README explicitly says sub-agents are omitted from defaults. An optional example extension exists; it is neither installed nor represented as native capability here. `agentBranches` remains empty.
