# 封装与整理文件清单

共 130 个相关文件。综合诊断位于 skill 正文；方法由 sync-host-skills.mjs 下发，共享视图由 sync-view-assets.mjs 下发。

## 本轮 skill 与工具整理

| 文件 | 内容 |
| --- | --- |
| [plugin/trajectory-tools/lib/diagnostic-prompts.js](../plugin/trajectory-tools/lib/diagnostic-prompts.js) | 只保留一键调用 skill 的请求 |
| [plugin/trajectory-tools/lib/index.js](../plugin/trajectory-tools/lib/index.js) | 注册四个工具和 DSH skill |
| [plugin/trajectory-tools/package.json](../plugin/trajectory-tools/package.json) | DSH 工具包 0.6.0 与资源清单 |
| [plugin/portable-tools/package.json](../plugin/portable-tools/package.json) | 便携工具包 0.2.1 |
| [plugin/codex/plugin.json](../plugin/codex/plugin.json) | Codex 插件 0.2.1 |
| [scripts/package-trajectory.mjs](../scripts/package-trajectory.mjs) | 复制引用资源并以干净目录构建 |
| [scripts/test-trajectory-packages.mjs](../scripts/test-trajectory-packages.mjs) | 三宿主解包、引用与独立运行检查 |
| [plugin/trajectory-tools/self-test.mjs](../plugin/trajectory-tools/self-test.mjs) | DSH 注册及查询 skill 检查 |
| [docs/host-entrypoints.md](../docs/host-entrypoints.md) | 宿主入口、元数据与方法分发说明 |
| [plugin/trajectory-tools/lib/skill.js](../plugin/trajectory-tools/lib/skill.js) | 从包内读取 skill 与目录基址 |
| [plugin/trajectory-tools/lib/inspect.js](../plugin/trajectory-tools/lib/inspect.js) | 统计结果去掉方法与报告规则 |
| [plugin/trajectory-tools/lib/inspect-service.js](../plugin/trajectory-tools/lib/inspect-service.js) | 移除方法发送状态，保留查询快照 |
| [plugin/portable-tools/service.mjs](../plugin/portable-tools/service.mjs) | 去掉方法注入；修复数字 tool 字段的绑定报错 |
| [plugin/portable-tools/tools.mjs](../plugin/portable-tools/tools.mjs) | 工具行为及参数说明 |
| [plugin/portable-tools/package-lock.json](../plugin/portable-tools/package-lock.json) | 同步便携包版本 |
| [scripts/sync-diagnostic-prompts.mjs](../scripts/sync-diagnostic-prompts.mjs) | 生成入口与方法链接索引 |
| [scripts/diagnostic-fixture-host.mjs](../scripts/diagnostic-fixture-host.mjs) | 实验记录包含方法资源哈希 |
| [plugin/trajectory-tools/inspect-test.mjs](../plugin/trajectory-tools/inspect-test.mjs) | 六个主题均只返回证据 |
| [plugin/trajectory-tools/diagnosis-test.mjs](../plugin/trajectory-tools/diagnosis-test.mjs) | 真实注册执行路径回归 |
| [plugin/portable-tools/test.mjs](../plugin/portable-tools/test.mjs) | 六主题与正文续读回归 |
| [plugin/portable-tools/mcp.mjs](../plugin/portable-tools/mcp.mjs) | MCP 服务版本同步 |
| [docs/diagnostic-prompts.md](../docs/diagnostic-prompts.md) | 分析方法的链接索引 |

## 本轮适配与检查

| 文件 | 内容 |
| --- | --- |
| [scripts/sync-host-skills.mjs](../scripts/sync-host-skills.mjs) | 生成 Codex、Pi、Claude 和 DSH 的宿主资源 |
| [docs/skill-tool-review.md](../docs/skill-tool-review.md) | 方法去重、宿主适配与安装检查记录 |
| [analyzers/claude-reader.mjs](../analyzers/claude-reader.mjs) | 显式读取 Claude transcript，验证会话身份与完整行 |
| [analyzers/claude-adapter.mjs](../analyzers/claude-adapter.mjs) | 原生参数、结果与去重用量适配 |
| [analyzers/claude-adapter-test.mjs](../analyzers/claude-adapter-test.mjs) | 完整参数、续读、重复记录及身份检查 |
| [analyzers/claude-hook-test.mjs](../analyzers/claude-hook-test.mjs) | SessionStart 绑定契约检查 |
| [view/assets/claude-host.js](../view/assets/claude-host.js) | Claude 来源、用量与覆盖展示 |
| [plugin/portable-tools/sources.mjs](../plugin/portable-tools/sources.mjs) | 三宿主数据源接线 |
| [plugin/portable-tools/runtime.mjs](../plugin/portable-tools/runtime.mjs) | 显式 Claude 来源与只读服务 |
| [plugin/portable-tools/analysis.mjs](../plugin/portable-tools/analysis.mjs) | 按宿主解释单位与用量 |
| [plugin/portable-tools/report-data.mjs](../plugin/portable-tools/report-data.mjs) | 报告数据保留宿主语义 |
| [scripts/trajectory-query.mjs](../scripts/trajectory-query.mjs) | 共享 CLI 与工具声明发现 |
| [docs/diagnostic-methods-draft.md](../docs/diagnostic-methods-draft.md) | 评审稿转到正式方法与编写依据 |

## 各宿主生成资源

| 文件 | 内容 |
| --- | --- |
| [.agents/skills/trace-analysis/SKILL.md](../.agents/skills/trace-analysis/SKILL.md) | 由方法源文件生成 |
| [.agents/skills/context-profile/SKILL.md](../.agents/skills/context-profile/SKILL.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/SKILL.md](../plugin/codex/skills/trace-analysis/SKILL.md) | 由方法源文件生成 |
| [plugin/codex/skills/context-profile/SKILL.md](../plugin/codex/skills/context-profile/SKILL.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/SKILL.md](../plugin/portable-tools/skills/trace-analysis/SKILL.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/context-profile/SKILL.md](../plugin/portable-tools/skills/context-profile/SKILL.md) | 由方法源文件生成 |
| [.agents/skills/trace-analysis/references/context.md](../.agents/skills/trace-analysis/references/context.md) | 由方法源文件生成 |
| [.agents/skills/trace-analysis/references/cost.md](../.agents/skills/trace-analysis/references/cost.md) | 由方法源文件生成 |
| [.agents/skills/trace-analysis/references/io.md](../.agents/skills/trace-analysis/references/io.md) | 由方法源文件生成 |
| [.agents/skills/trace-analysis/references/latency.md](../.agents/skills/trace-analysis/references/latency.md) | 由方法源文件生成 |
| [.agents/skills/trace-analysis/references/repeats.md](../.agents/skills/trace-analysis/references/repeats.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/references/context.md](../plugin/codex/skills/trace-analysis/references/context.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/references/cost.md](../plugin/codex/skills/trace-analysis/references/cost.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/references/io.md](../plugin/codex/skills/trace-analysis/references/io.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/references/latency.md](../plugin/codex/skills/trace-analysis/references/latency.md) | 由方法源文件生成 |
| [plugin/codex/skills/trace-analysis/references/repeats.md](../plugin/codex/skills/trace-analysis/references/repeats.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/references/context.md](../plugin/portable-tools/skills/trace-analysis/references/context.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/references/cost.md](../plugin/portable-tools/skills/trace-analysis/references/cost.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/references/io.md](../plugin/portable-tools/skills/trace-analysis/references/io.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/references/latency.md](../plugin/portable-tools/skills/trace-analysis/references/latency.md) | 由方法源文件生成 |
| [plugin/portable-tools/skills/trace-analysis/references/repeats.md](../plugin/portable-tools/skills/trace-analysis/references/repeats.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/references/context.md](../plugin/trajectory-tools/skills/trace-analysis/references/context.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/references/cost.md](../plugin/trajectory-tools/skills/trace-analysis/references/cost.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/references/io.md](../plugin/trajectory-tools/skills/trace-analysis/references/io.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/references/latency.md](../plugin/trajectory-tools/skills/trace-analysis/references/latency.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/references/repeats.md](../plugin/trajectory-tools/skills/trace-analysis/references/repeats.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trace-analysis/SKILL.md](../plugin/trajectory-tools/skills/trace-analysis/SKILL.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/context-profile/SKILL.md](../plugin/trajectory-tools/skills/context-profile/SKILL.md) | 由方法源文件生成 |
| [plugin/trajectory-tools/skills/trajectory-query/SKILL.md](../plugin/trajectory-tools/skills/trajectory-query/SKILL.md) | DSH 历史查证正文 |
| [plugin/trajectory-tools/skills/catalog.json](../plugin/trajectory-tools/skills/catalog.json) | DSH runtime 注册元数据 |
| [plugin/trajectory-tools/report/WRITING.md](../plugin/trajectory-tools/report/WRITING.md) | DSH 包内的共享写作资源 |

## 宿主、视图与报告封装

| 文件 | 内容 |
| --- | --- |
| [plugin/codex/skills/trajectory-view/SKILL.md](../plugin/codex/skills/trajectory-view/SKILL.md) | Codex 生成视图入口 |
| [plugin/analysis-view/lib/client.js](../plugin/analysis-view/lib/client.js) | DSH /trajectory 客户端命令 |
| [plugin/analysis-view/package.json](../plugin/analysis-view/package.json) | DSH 视图包版本 0.10.32 与 commands 依赖 |
| [plugin/portable-tools/pi.mjs](../plugin/portable-tools/pi.mjs) | Pi /trajectory，复用 SDK 当前分支与作用域 |
| [.agents/plugins/marketplace.json](../.agents/plugins/marketplace.json) | Codex 本地插件源，指向安全构建目录 |
| [scripts/trajectory-view.mjs](../scripts/trajectory-view.mjs) | 视图命令行入口 |
| [view/generate.mjs](../view/generate.mjs) | 读取原生会话并调用宿主适配器 |
| [view/render.mjs](../view/render.mjs) | 正式网页装配，独立定位资源并内嵌字体 |
| [view/serve.mjs](../view/serve.mjs) | 单文件 localhost 预览、复用与生命周期 |
| [scripts/host-trace-page.mjs](../scripts/host-trace-page.mjs) | 兼容之前构建脚本的转发入口 |
| [view/assets/geist.css](../view/assets/geist.css) | 沿用的视图主题资源 |
| [view/assets/context-observation.css](../view/assets/context-observation.css) | 上下文与趋势图样式 |
| [view/assets/context-observation.js](../view/assets/context-observation.js) | 上下文与趋势交互 |
| [view/assets/pi-host.js](../view/assets/pi-host.js) | Pi 宿主视图适配 |
| [view/assets/codex-host.js](../view/assets/codex-host.js) | Codex 宿主视图适配 |
| [scripts/trajectory-report.mjs](../scripts/trajectory-report.mjs) | 报告工具增加本机 Codex / Pi 数据连接 |
| [report/AUTHORING.md](../report/AUTHORING.md) | 报告组件使用说明，仍由 AI 写作 |
| [view/test.mjs](../view/test.mjs) | 原始数据、资源与单文件服务验证 |
| [plugin/portable-tools/transports-test.mjs](../plugin/portable-tools/transports-test.mjs) | Pi 命令注册及现有工具传输验证 |
| [plugin/analysis-view/self-test.mjs](../plugin/analysis-view/self-test.mjs) | DSH 客户端命令注册验证 |
| [README.md](../README.md) | 中文使用与安装入口；无设计说明 |
| [README.en.md](../README.en.md) | 英文使用入口 |
| [plugin/portable-tools/README.md](../plugin/portable-tools/README.md) | Pi / Codex 使用说明 |
| [docs/host-integration-files.md](../docs/host-integration-files.md) | 本清单 |
| [plugin/trajectory-tools/README.md](../plugin/trajectory-tools/README.md) | DSH 方法 skill 与版本说明 |
| [plugin/analysis-view/README.md](../plugin/analysis-view/README.md) | DSH 命令与版本说明 |

## 方法源文件

| 文件 | 内容 |
| --- | --- |
| [skill/trace-analysis/references/context.md](../skill/trace-analysis/references/context.md) | 过程诊断方法源文件 |
| [skill/trace-analysis/references/cost.md](../skill/trace-analysis/references/cost.md) | 过程诊断方法源文件 |
| [skill/trace-analysis/references/io.md](../skill/trace-analysis/references/io.md) | 过程诊断方法源文件 |
| [skill/trace-analysis/references/latency.md](../skill/trace-analysis/references/latency.md) | 过程诊断方法源文件 |
| [skill/trace-analysis/references/repeats.md](../skill/trace-analysis/references/repeats.md) | 过程诊断方法源文件 |
| [skill/trace-analysis/SKILL.md](../skill/trace-analysis/SKILL.md) | 综合诊断正文与五个专项引用 |
| [skill/context-profile/SKILL.md](../skill/context-profile/SKILL.md) | 静态剖面源文件 |
| [skill/trajectory-query/SKILL.md](../skill/trajectory-query/SKILL.md) | 历史查证源文件 |
| [skill/catalog.mjs](../skill/catalog.mjs) | 宿主注册目录元数据 |
| [skill/trajectory-query.md](../skill/trajectory-query.md) | 旧地址转到当前 skill |
| [report/WRITING.md](../report/WRITING.md) | 共享报告写作正文 |

## Claude Code

| 文件 | 内容 |
| --- | --- |
| [plugin/claude/.claude-plugin/plugin.json](../plugin/claude/.claude-plugin/plugin.json) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/hooks/hooks.json](../plugin/claude/hooks/hooks.json) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/README.md](../plugin/claude/README.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/scripts/bind-session.mjs](../plugin/claude/scripts/bind-session.mjs) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/context-profile/SKILL.md](../plugin/claude/skills/context-profile/SKILL.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/references/context.md](../plugin/claude/skills/trace-analysis/references/context.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/references/cost.md](../plugin/claude/skills/trace-analysis/references/cost.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/references/io.md](../plugin/claude/skills/trace-analysis/references/io.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/references/latency.md](../plugin/claude/skills/trace-analysis/references/latency.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/references/repeats.md](../plugin/claude/skills/trace-analysis/references/repeats.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trace-analysis/SKILL.md](../plugin/claude/skills/trace-analysis/SKILL.md) | Claude 原生插件、会话绑定与宿主 skills |
| [plugin/claude/skills/trajectory-view/SKILL.md](../plugin/claude/skills/trajectory-view/SKILL.md) | Claude 原生插件、会话绑定与宿主 skills |

## 共享视图与 README 展示

| 文件 | 内容 |
| --- | --- |
| [scripts/sync-view-assets.mjs](../scripts/sync-view-assets.mjs) | 共享视图资源的同步与打包检查 |
| [plugin/analysis-view/presentation-test.mjs](../plugin/analysis-view/presentation-test.mjs) | 原生装配、默认关闭与关闭态无趋势计算的回归检查 |
| [scripts/build-readme-media.mjs](../scripts/build-readme-media.mjs) | 只用合成数据生成公开展示与本地 README 预览 |
| [docs/demo/layout-review/context-observation.js](../docs/demo/layout-review/context-observation.js) | 共享视图的历史路径兼容副本，由同步脚本生成 |
| [docs/demo/layout-review/context-observation.css](../docs/demo/layout-review/context-observation.css) | 共享样式的历史路径兼容副本，由同步脚本生成 |
| [scripts/serve-context-trend-study.mjs](../scripts/serve-context-trend-study.mjs) | 趋势 demo 使用正式共享样式 |
| [plugin/analysis-view/lib/trace/shared/context-observation.css](../plugin/analysis-view/lib/trace/shared/context-observation.css) | DSH 原生包的生成资源，与其他宿主保持一致 |
| [plugin/analysis-view/lib/trace/shared/context-observation.js](../plugin/analysis-view/lib/trace/shared/context-observation.js) | DSH 原生包的生成资源，与其他宿主保持一致 |
| [plugin/analysis-view/lib/trace/shared/context-trend-geometry.js](../plugin/analysis-view/lib/trace/shared/context-trend-geometry.js) | DSH 原生包的生成资源，与其他宿主保持一致 |
| [plugin/analysis-view/lib/trace/shared/visual-tokens.css](../plugin/analysis-view/lib/trace/shared/visual-tokens.css) | DSH 原生包的生成资源，与其他宿主保持一致 |
| [docs/media/context-assembly.gif](../docs/media/context-assembly.gif) | README 公共素材与来源说明 |
| [docs/media/context-trend.jpg](../docs/media/context-trend.jpg) | README 公共素材与来源说明 |
| [docs/media/diagnostic-report.jpg](../docs/media/diagnostic-report.jpg) | README 公共素材与来源说明 |
| [docs/media/README.md](../docs/media/README.md) | README 公共素材与来源说明 |
| [docs/media/trajectory-overview.jpg](../docs/media/trajectory-overview.jpg) | README 公共素材与来源说明 |

## 已删除

- `plugin/trajectory-tools/lib/inspect-methods.js`
- `skill/trace-analysis/references/overview.md`
- `.agents/skills/trace-analysis/references/overview.md`
- `plugin/codex/skills/trace-analysis/references/overview.md`
- `plugin/portable-tools/skills/trace-analysis/references/overview.md`
- `plugin/trajectory-tools/skills/trace-analysis/references/overview.md`

## 当前本地安装包

- `.dsh/releases/trajectory-tree-codex-0.2.1.tgz`
- `.dsh/releases/trajectory-tree-pi-0.2.1.tgz`
- `.dsh/releases/trajectory-tree-claude-0.2.1.tgz`
- `.dsh/releases/dsh-trajectory-tools-0.6.0.tgz`
- `.dsh/releases/dsh-analysis-view-0.10.32.tgz`

DSH web profile 已安装工具包和 0.10.32 视图。其余三宿主分发包已重建并检查共享视图一致性。原始会话与私有截图不进入安装包；README 图像使用合成数据。
