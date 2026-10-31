<h1 align="center">Trajectory Tree · 轨迹树</h1>

<p align="center"><strong>从对话日志，看见 Agent 怎样工作。</strong></p>
<p align="center">执行路径 · 上下文变化 · 工具证据 · 可视化诊断报告</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/host-entrypoints.md">宿主接入</a> ·
  <a href="LICENSE">MIT License</a>
</p>

<p align="center"><code>DSH</code> &nbsp; <code>Pi</code> &nbsp; <code>Codex</code> &nbsp; <code>Claude Code</code></p>

![执行路径：轮次主干、工具分支、文件变化与上下文增量](docs/media/trajectory-overview.jpg)

从全程主线进入某一轮，查看工具参数、返回、文件变化和反馈。长对话先显示实际主线，再逐步补齐详情。

> 以下图片和动图使用示例数据，由项目现有视图与报告组件渲染。

## 追踪上下文怎样变化

点选一种或多种来源，追踪它们的保留量和增减。路径页的增量与总趋势可以同时显示；**总趋势默认关闭，按需开启**。

![上下文趋势组件：按来源查看保留量与每轮增减](docs/media/context-trend.jpg)

## 看见上下文逐轮装配

保留的材料留在原位，新内容逐轮接入，历史改写时定位发生变化的片段。组件可嵌入报告，按已有结构记录回放。

![上下文装配概念序列：逐轮追加、保留与历史改写](docs/media/context-assembly.gif)

## 把诊断变成一篇可读的报告

把关键判断、证据和下一次行动放在一起，配合数值、分布、趋势及原文位置阅读。**报告由 AI 撰写**，Markdown 与图表组件装配为可交互 HTML。

![示例诊断报告：关键读数、阶段分布和输入构成](docs/media/diagnostic-report.jpg)

## 快速开始

从仓库根目录操作。DSH 插件需要 Node.js 18+；其他宿主的工具与独立视图需要 Node.js 20+。

<details>
<summary><strong>DSH · 原生插件与分析面板</strong></summary>

```sh
npm pack ./plugin/trajectory-tools
npm pack ./plugin/analysis-view
dsh plugin --profile web add ./dsh-trajectory-tools-0.6.0.tgz ./dsh-analysis-view-0.10.32.tgz
```

重启 `dsh web`，在「分析」中查看统计，或用 `/trajectory` 打开当前会话路径。已运行的实例先退出，避免端口冲突。

可另装 [对话搜索](plugin/conversation-search/README.md)，在右侧栏搜索并跳转到消息。DSH 的按需解读会调用当前模型；压缩后对账默认开启，可设 `config.reconcile: false` 关闭。

[分析面板](plugin/analysis-view/README.md) · [取证工具](plugin/trajectory-tools/README.md)

</details>

<details>
<summary><strong>Pi · 当前分支与原生命令</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
pi -e ./plugin/portable-tools
```

使用 `/trajectory` 打开当前选中分支。`trace-analysis` 分析会话过程，`context-profile` 查看当前上下文与工具配置。

[Pi 使用说明](plugin/portable-tools/README.md#pi)

</details>

<details>
<summary><strong>Codex · 插件、MCP 与独立视图</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex
```

从本地插件目录安装 `dist/trajectory-tree-codex`，使用 `$trajectory-view`、`$trace-analysis` 或 `$context-profile`。

也可以直接生成当前会话视图；读取本机会话需要官方 `codex app-server`：

```sh
node scripts/trajectory-view.mjs --host codex --serve
```

[插件入口](docs/host-entrypoints.md) · [Codex / MCP 配置](plugin/portable-tools/README.md#codex)

</details>

<details>
<summary><strong>Claude Code · 原生插件与 transcript</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host claude
claude --plugin-dir ./dist/trajectory-tree-claude
```

使用 `/trajectory-tree:trajectory-view`、`/trajectory-tree:trace-analysis` 或 `/trajectory-tree:context-profile`。插件在会话启动、恢复等时机提供当前 transcript 路径。

[Claude Code 使用说明](plugin/claude/README.md)

</details>

### 离线生成视图

```sh
node scripts/trajectory-view.mjs --host pi --file /absolute/session.jsonl --open
node scripts/trajectory-view.mjs --host claude --file /absolute/transcript.jsonl --open
```

生成过程不调用模型。命令返回独立 HTML 文件和本地预览地址；页面包含字体，可离线保存。

## 同一组取证工具

| 工具 | 用途 |
| --- | --- |
| `trajectory_inspect` | 查看过程、耗时、用量、反复尝试、工具文件和上下文统计 |
| `trajectory_search` | 定位会话、字面记录与统计范围 |
| `trajectory_read` | 查看原文、关联动作与反馈，分段追读完整参数和结果 |
| `trajectory_graph` | 查看记录关系与会话谱系 |

查询只读。各宿主按已有记录提供证据，不把未记录的内容补成事实。

| 宿主 | 主要数据来源 |
| --- | --- |
| DSH | 原生事件与官方统计投影、上下文构成、文件、Skill 和子代理记录 |
| Pi | 选中分支、当前 SDK 配置及采集到的工具执行时间 |
| Codex | 官方会话读取接口，以及对应线程的本地记录补充 |
| Claude Code | 明确选定的 transcript、原生工具参数与结果、已记录的消息用量 |

## 文档

- [宿主接入与命令](docs/host-entrypoints.md)
- [工具配置、查询与正文续读](plugin/portable-tools/README.md)
- [分析方法](skill/trace-analysis/SKILL.md) · [上下文与配置剖面](skill/context-profile/SKILL.md)
- [HTML 报告组件用法](report/AUTHORING.md)

<details>
<summary>开发与自检</summary>

```sh
node scripts/sync-host-skills.mjs --check
node scripts/sync-view-assets.mjs --check
npm test --prefix plugin/trajectory-tools
npm test --prefix plugin/portable-tools
node plugin/analysis-view/presentation-test.mjs
node plugin/analysis-view/perf-test.mjs
```

`plugin/` 提供宿主接入，`analyzers/` 处理原生记录，`view/` 与 `report/` 提供视图和报告组件。公开展示素材可由 `node scripts/build-readme-media.mjs --serve 3099` 重现。

</details>

## 许可证

[MIT](LICENSE) © 2026 goatliamia
