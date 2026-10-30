# Trajectory Tree

[English](README.en.md)

Trajectory Tree（轨迹树）用于查看和分析 Agent 会话：追踪执行过程、上下文构成、工具与文件使用，按原文取证并给出可验证的改进建议。支持 DSH，另提供 Pi / Codex 分析工具和独立会话视图。

| 组件 | 入口 | 用途 |
|---|---|---|
| `dsh-trajectory-tools` | DSH 模型工具 | 四个只读入口：查历史、读原文、看关系、诊断取证 |
| `dsh-analysis-view` | DSH「分析」与「路径」 | 轮次、用量、工具、异常事件及按需解读；执行路径、上下文、文件、Skill 与子代理 |
| `dsh-conversation-search` | DSH 右侧栏 | 搜索当前对话，跳到对应轮次 |
| `trajectory-portable-tools` | Pi 扩展 / Codex MCP / CLI | 同一组四工具，分析耗时、用量、反复尝试、工具文件及上下文 |

查询工具只读，完整参数与结果可继续追查。DSH 的按需解读会调用模型；可选的压缩后对账默认开启，见下方说明。

## 环境

- DSH：验证环境为 SDK 0.2.2-alpha.2、Web GUI，Node.js 18+；profile 默认在 `~/.dsh/profiles/web`。
- Pi / Codex 工具：Node.js 20+。Pi 原生扩展需要 Pi；Codex 在线读取需要官方 `codex app-server`。离线文件分析无需启动模型。

## 安装 DSH 插件

三个 DSH 包都是本地文件依赖，不发布 npm。在各自目录打包：

```sh
cd plugin/trajectory-tools && pnpm pack
cd ../analysis-view && pnpm pack
cd ../conversation-search && pnpm pack
```

将 `.tgz` 放到固定目录，然后在 `~/.dsh/profiles/web/package.json` 中添加依赖与 bundle：

```json
{
  "dependencies": {
    "dsh-trajectory-tools": "file:/绝对路径/dsh-trajectory-tools-0.5.1.tgz",
    "dsh-analysis-view": "file:/绝对路径/dsh-analysis-view-0.10.30.tgz",
    "dsh-conversation-search": "file:/绝对路径/dsh-conversation-search-0.2.1.tgz"
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

重启 `dsh web`。host 插件不会可靠热更新，客户端改动刷新页面即可。

## 四个取证工具

| 工具 | 用途 |
|---|---|
| `trajectory_inspect` | `overview` 总览、`latency` 耗时、`cost` 用量与定义、`repeats` 反复尝试、`io` 工具文件、`context` 上下文 |
| `trajectory_search` | `events` 字面搜索、`catalog` 计数与范围、`cost` 用量、`sessions` 会话列表 |
| `trajectory_read` | 原文、关联动作与反馈；完整参数、返回和差异可分段续读 |
| `trajectory_graph` | 事件关系与会话谱系 |

DSH 模型侧调用示例：

```js
trajectory_inspect({ view: "overview" })
trajectory_search({ view: "sessions" })
trajectory_search({ view: "events", query: "关键词" })
trajectory_read({ session: "会话 ID", seq: 123 })
trajectory_graph({ session: "会话 ID", seq: 123 })
```

沿用返回的 `snapshot`，可切换范围或聚焦工具、文件，并按阅读指针追查。证据保留原生身份与 `seq@logId`；未命中仅表示在本次范围和过滤下未找到。

DSH 附带 `trajectory-query` skill，Pi / Codex 附带简短的 [trace-analysis skill](.agents/skills/trace-analysis/SKILL.md)。各宿主的参数有差别，见 [DSH 工具说明](plugin/trajectory-tools/README.md) / [Pi 与 Codex 工具说明](plugin/portable-tools/README.md)。

**DSH 压缩后对账**：默认在成功压缩后的当轮收尾点，要求模型简述当前任务、进度与下一步，可能增加一个模型步骤。设 `config.reconcile: false` 可关闭。

## DSH 分析与路径

- **分析**：轮次、工具调用、失败、缓存、逐轮用量、工具分布和有证据的异常事件；按需解读按钮使用当前模型调用一次。
- **路径**：全程概览与逐轮主线、支路、时间轴；可查看上下文构成、文件变化、工具参数与返回、Skill 和子代理。
- **长会话**：先显示实际主线，再逐步补齐详情和图层；选中轮次优先加载，较早的上下文增量可继续取回。
- **对话搜索**：右侧栏按关键词搜索，默认只搜用户和助手消息，可包含工具结果，点击跳到相应轮次。

```text
GET /analysis-view/digest?session=<id>          # 统计；&fresh=1 刷新缓存
GET /analysis-view/interpret?session=<id>       # 按需解读，会消耗模型调用
GET /analysis-view/trace?session=<id>           # 独立路径快照
GET /analysis-view/trace?staged=1&session=<id>  # 分阶段路径页
GET /analysis-view/trace-data?session=<id>&stage=core
GET /conversation-search/search?session=<id>&q=<词>&scope=chat|all
```

详细使用见 [分析面板](plugin/analysis-view/README.md) / [对话搜索](plugin/conversation-search/README.md)。

## Pi / Codex

从仓库根目录安装工具依赖：

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
```

Pi 可加载原生扩展，读取当前分支和 SDK 工具清单，也可离线分析 Session v3 JSONL：

```sh
pi -e ./plugin/portable-tools
# 或离线分析
node scripts/trajectory-query.mjs --host pi --file /absolute/session.jsonl --request query.json
```

Codex 可接入 MCP，或用 CLI 分析指定线程 / 官方快照：

```sh
node scripts/trajectory-query.mjs --host codex --thread THREAD_ID --request query.json
node scripts/trajectory-query.mjs --host codex --file /absolute/snapshot.json --request query.json
```

`query.json` 示例：

```json
{"view":"overview"}
```

MCP 配置、范围选择、正文续读与工具定义查询见 [安装与参数](plugin/portable-tools/README.md)。

Pi 原生扩展可取得当前配置，离线历史不等同于当前配置；Codex 分析已记录的工具声明。文本构成与定义体积是估算，实际用量单独统计。Codex 已用真实会话验证；Pi 已验证原生日志与扩展接口，尚未完成真实 Pi 进程验证。

## 独立会话视图

Pi / Codex 可生成独立网页，使用项目原有配色和执行路径。上方构成支持点选多类，下方增量与总趋势可同时显示。

```sh
# Pi 原生日志
node scripts/build-pi-demo.mjs --session /absolute/session.jsonl
# Codex：只读导出并生成视图
node scripts/export-codex-thread.mjs --thread THREAD_ID
# 启动本地预览
node scripts/serve-layout-review.mjs 3086
```

访问 `http://127.0.0.1:3086/pi` 或 `http://127.0.0.1:3086/codex`。Pi 不传 `--session` 时生成明确标注的模拟示例，需要本地 Pi 源仓库。选项见 [Pi](docs/demo/layout-review/PI.md) / [Codex](docs/demo/layout-review/CODEX.md)。这些是独立预览，DSH 插件的既有视图入口不变。

会话导出、构建页面和截图保存在 Git 忽略的 `.dsh/`，不随仓库提交。

## 自检

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

## 目录与文档

- `plugin/`：三个 DSH 插件和 Pi / Codex 工具。
- `analyzers/`：确定性分析器、宿主适配与自检。
- `scripts/`：导出、查询 CLI 和独立视图构建。
- `skill/`、`.agents/skills/`：模型调用指引。
- `docs/`：使用文档、研究和实验记录；[诊断使用入口](docs/diagnostics.md)。
- `experiments/`：实验语料、探针与报告。

## 版本

| 包 | 版本 |
|---|---|
| dsh-trajectory-tools | 0.5.1 |
| dsh-analysis-view | 0.10.30 |
| dsh-conversation-search | 0.2.1 |
| trajectory-portable-tools | 0.1.0 |

## 许可证

MIT © 2026 goatliamia，见 [LICENSE](LICENSE)。
