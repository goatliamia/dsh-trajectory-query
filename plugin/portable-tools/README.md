# Pi / Codex / Claude Code 只读分析工具

沿用四个入口：`trajectory_inspect`、`trajectory_search`、`trajectory_read`、`trajectory_graph`。支持过程诊断和当前可取得材料的静态剖面；分析方法由 `trace-analysis`、`context-profile` skill 提供。

需要 Node.js 20+，先在仓库根目录执行：

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
```

## Pi

从仓库根目录启动 Pi，并加载本地包：

```sh
pi -e ./plugin/portable-tools
```

扩展读取当前会话选中的分支、当前 SDK 工具清单与系统提示，并从加载之后记录工具开始/结束时间。不会补造加载前的时间，也不会替换工具、调用模型或写回历史。包内同时提供短 skill。

使用 `/trajectory` 直接生成并打开当前分支视图；`/trajectory --no-open` 只返回链接。过程诊断与静态配置方法分别由 Pi 版 `trace-analysis`、`context-profile` skill 提供，报告仍由模型撰写。

离线分析原生 Session v3 JSONL：

```sh
node scripts/trajectory-query.mjs --host pi --file /absolute/session.jsonl --request /absolute/query.json
```

`--leaf ID` 选择分支；`--capture file.jsonl` 读取配套事件捕获；模拟数据应显式加 `--synthetic`。单独的历史日志不包含当前 SDK 完整配置。

## Codex

也可在仓库根目录运行 `node scripts/package-trajectory.mjs --host codex`，从仓库的本地插件源安装 Trajectory Tree。插件内 `$trajectory-view` 生成视图，`$trace-analysis` 和 `$context-profile` 提供方法；未配置 MCP 时使用随包 CLI。

需要本机可用的官方 `codex app-server`。下面是 MCP 配置示例，将仓库路径替换为自己的绝对路径，按需要加入 Codex 的配置；本仓库不会自动修改全局配置：

```toml
[mcp_servers.trajectory]
command = "node"
args = ["D:/projects/sql event/plugin/portable-tools/mcp.mjs", "--host", "codex"]
```

未绑定线程时先用 `trajectory_search(view="sessions", cwd="项目绝对路径")` 找原生会话 ID，后续传 `session`。也可在启动参数中加 `--thread ID` 固定一个线程。已有同名工具时只启用一套，避免重复注册。

CLI 使用同一实现：

```sh
node scripts/trajectory-query.mjs --host codex --thread THREAD_ID --request /absolute/query.json
node scripts/trajectory-query.mjs --host codex --file /absolute/snapshot.json --request /absolute/query.json
```

只使用官方读取/列表接口；可选结合属于该线程、且不晚于快照的本地 rollout。`--api-only` 禁用本地补充。官方快照通过 `node scripts/export-codex-thread.mjs --thread THREAD_ID` 导出。

## Claude Code

```sh
node scripts/package-trajectory.mjs --host claude
claude --plugin-dir ./dist/trajectory-tree-claude
```

使用 `/trajectory-tree:trajectory-view` 生成视图，`/trajectory-tree:trace-analysis` 分析过程。插件在会话生命周期开始时绑定当前 transcript，查询 CLI 使用 `--host claude --file <transcript_path>`。它保留原生工具名、参数与结果，已有用量按消息 ID 去重；完整请求上下文与未记录的执行起止保持未知。见 [Claude 插件说明](../claude/README.md)。

## 查询与追查

`query.json` 的初次请求可以很短：

```json
{"view":"overview"}
```

已知问题直接选 `latency`、`cost`、`repeats`、`io`、`context`。工具配置剖面用 `{"view":"cost","groupBy":"definition"}`；先看返回的来源与覆盖范围，再结合调用和原文判断。

后续调用保留返回的 `snapshot`，可加 `turns: {"from": 5, "to": 12}` 或单个 `focus: {"tool": "原生工具名"}`。按返回的 `read`、`expand`、`nextRead` 继续；指针中的 `tool` 是下一次调用的工具名，其余字段作为参数。

CLI 用 `--tool schema` 查看当前四个工具声明，用 `--tool trajectory_read` 等选择入口。完整参数/结果超过单次返回时不会丢失，可按 `nextRead` 续读；定义可单独读 `parameters` 或 `description`。CLI 跨进程续读要求来源未变，持续变化的会话优先使用常驻 MCP / Pi 扩展。

## 验证与边界

```sh
npm test --prefix plugin/portable-tools
node analyzers/pi-adapter-test.mjs
node analyzers/codex-adapter-test.mjs
```

Pi 的 assistant cycle、Codex 的可见动作、响应计量分别统计。文本构成和定义体积是估算；没有记录的请求内容、工具清单、隐藏内容和时间保持未知。工具体积、近期低频不能单独作为删减能力或改写工具语义的依据。

更多来源、性能与验证说明见 [跨宿主适配](../../docs/portable-analysis.md)；模型使用入口见 [短 skill](../../.agents/skills/trace-analysis/SKILL.md)。
