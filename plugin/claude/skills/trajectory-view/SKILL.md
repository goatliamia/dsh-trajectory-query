---
name: trajectory-view
description: 生成并打开当前或指定 Claude Code 会话的轨迹树视图。
---

用 Node 运行本目录相对路径 `../../../../scripts/trajectory-view.mjs --host claude --file <transcript_path> --serve`，将返回的 `url` 打开到浏览器。当前会话使用 SessionStart 绑定提供的 transcript_path；分析其他会话时使用明确指定的文件。
