# 宿主入口与分发

视图生成是确定性代码，不调用模型；报告由模型使用取证方法撰写，再交给组件渲染。

| 宿主 | 查看会话 | 过程诊断 | 静态剖面 |
| --- | --- | --- | --- |
| Codex | 插件 skill `$trajectory-view` | `$trace-analysis` | `$context-profile` |
| Pi | 原生命令 `/trajectory` | Pi 版 `trace-analysis` skill | Pi 版 `context-profile` skill |
| Claude Code | `/trajectory-tree:trajectory-view` | `/trajectory-tree:trace-analysis` | `/trajectory-tree:context-profile` |
| DSH Web | 客户端命令 `/trajectory` | runtime skill `trace-analysis` | runtime skill `context-profile` |

Codex 使用官方推荐的 skills 入口，不新增已弃用的 custom prompt slash 文件。插件包使用根 `plugin.json`，从根 `skills/` 发现 skill；本地 marketplace 指向生成后的 Codex 包，不指向含私有日志的整个工作目录。它是本地可安装包，尚未提交公共插件目录。

## 方法来源

过程诊断和静态剖面的源文件在 `skill/trace-analysis` 和 `skill/context-profile`。综合诊断直接放在 `trace-analysis/SKILL.md`，五类专项方法按问题引用；工具返回统计、记录与原文位置。`ENTRY_PROMPTS.process/profile` 仅保留调用相应 skill 的请求文本。

`node scripts/sync-host-skills.mjs` 生成各宿主方法 skill；`--check` 检查同步状态。Codex 和 Claude Code 只补充各自 CLI 路径与会话来源，Pi 使用已注册的工具；工具声明由 CLI 的 `--tool schema` 读取。项目自身的 `.agents/skills` 保留通用分析方法。

DSH 不套用 Codex 的文件元数据。它通过当前 SDK 的 `ctx.skills.register` 注册 `name`、`description`、`whenToUse`、`source: "runtime"`、`content` 和方法引用所在的 `resourceBase`；调用策略省略时由 SDK 默认同时开放用户与模型调用。Codex/Pi 分别使用普通 `SKILL.md` 的 name、description 和正文。正文写作共用 `report/WRITING.md`；HTML 组件绑定见 `report/AUTHORING.md`。

## 构建

```sh
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex
node scripts/package-trajectory.mjs --host pi
node scripts/package-trajectory.mjs --host claude
```

包分别位于 `dist/trajectory-tree-codex`、`dist/trajectory-tree-pi` 和 `dist/trajectory-tree-claude`，包含脚本、字体、组件与所需的 TypeBox 依赖。来源清单及内容哈希在各包的 `bundle-manifest.json`。

Codex：构建后刷新或重启客户端，在 Plugins Directory 选择 `Trajectory Tree 本地插件` 源并安装。缺少当前会话 ID 时生成器要求明确的 `--thread`，不改选最近会话。

Pi：`pi -e ./dist/trajectory-tree-pi`。`/trajectory` 从 SessionManager 读取选定分支及当前作用域，生成后打开系统浏览器；`--no-open` 返回链接。没有向会话发送额外分析提示词。

Claude Code：`claude --plugin-dir ./dist/trajectory-tree-claude`。原生 `SessionStart` hook 在启动、恢复、清空、压缩或 fork 时提供当前 `session_id` 与 `transcript_path`，不在每轮提示重复注入；CLI 显式读取该文件。支持可见消息、工具参数与结果及已记录用量，详情见 [Claude 插件](../plugin/claude/README.md)。

DSH：`dsh-analysis-view` 0.10.32 的 `/trajectory` 打开当前会话 staged trace 路由，带来源多选和默认关闭的总趋势。其共享资源由 `node scripts/sync-view-assets.mjs` 生成，打包前自动同步。`dsh-trajectory-tools` 0.6.0 附带两项方法 skill 及其引用资源。

## 运行与资源

```sh
node scripts/trajectory-view.mjs --host codex --serve
node scripts/trajectory-view.mjs --host pi --file session.jsonl --open
```

独立视图文件包含字体；本地服务只绑定 127.0.0.1，只暴露随机路径对应的一个生成文件，不监听历史变化。同一输出文件复用服务，闲置 15 分钟或总运行 1 小时后关闭。生成器不会调用模型或修改原会话。

报告核心一同封装。`trajectory-report` 的 query/prepare 可使用 `--host codex` 或 `--host pi --file ...`；DSH 沿用宿主连接。AI 选证据、写 Markdown、声明组件，渲染器装配 HTML。

参考：OpenAI [插件打包](https://developers.openai.com/plugins/build/plugins)、[Skills](https://learn.chatgpt.com/docs/build-skills)；Pi [扩展命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。DSH 使用本机 0.2.2-alpha.2 的 commandUi 与 SkillRegistry 类型定义核对。
