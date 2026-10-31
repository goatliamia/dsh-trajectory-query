# Claude Code host

Build with `node scripts/package-trajectory.mjs --host claude`, then load using `claude --plugin-dir ./dist/trajectory-tree-claude`. Commands are `/trajectory-tree:trajectory-view`, `/trajectory-tree:trace-analysis`, and `/trajectory-tree:context-profile`.

The SessionStart hook provides the current `session_id` and `transcript_path` to Claude at startup, resume, clear, compaction, or fork. Use the exact path with `--host claude --file <transcript>` in the Trajectory Tree CLI. Parallel sessions do not share a current-session file. The hook does not read the transcript or send it anywhere.

The reader opens only the explicit local file. It includes visible user and assistant text, tool calls/results, and recorded message usage. It does not reconstruct branches, subagent transcripts, complete model requests, or context composition. An incomplete final JSONL line is excluded. Use results as partial evidence.

The installed plugin must include the hook script and generated skills; see the repository packaging workflow. Claude Code needs Node.js on PATH to run the hook and CLI. No Claude model call is needed for reading a transcript.

The hook input contract is documented in the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks); plugin layout is documented in the [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference).
