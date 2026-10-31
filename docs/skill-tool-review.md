# Skill 与工具整理 review

保留四个工具及其参数。综合诊断直接写在 [trace-analysis](../skill/trace-analysis/SKILL.md)，耗时、用量、反复尝试、工具文件、上下文五类专项按需引用；[context-profile](../skill/context-profile/SKILL.md) 处理静态剖面。

## 发现与修正

- 首次 inspect 响应附带方法和报告规则，查询快照还记录哪些规则已发送。已移除这些字段和状态；首查、换主题、续页都只提供统计与证据。
- 旧测试要求历史查询 skill 罗列四个工具、重复引用约定。改为检查查证流程；参数与结果语义保留在工具中。
- Pi/Codex 的上下文查询会把数值字段 tool 当成工具名，在 startsWith 处报错。已增加类型判断，六主题查询回归覆盖到该路径。
- 旧构建目录可能保留被删除的模块或旧 skill 资源。改为校验目标后整包替换，复制完整方法目录，解包检查无旧 inspect-methods.js。
- DSH runtime skill 补充 resourceBase，按当前 SDK 的相对路径约定定位引用；三个宿主的包内引用全部可达。
- 综合诊断补充阶段投入、反馈利用、可调整原因及验证方法；删除工具使用章节和主题参数表。专项的能力取舍、组装与恢复通过交叉引用维护。
- Claude Code 复用四工具与报告数据接口，保留原生工具名、参数、可续读的结果和消息身份；用量按消息 ID 去重。SessionStart hook 提供当前 transcript，不在每轮提示重复注入。

正文写作只维护 [WRITING.md](../report/WRITING.md) 一份；组件和 HTML 装配另在 [AUTHORING.md](../report/AUTHORING.md)。DSH 的包内副本由同步脚本生成。原工具方法模块已删除，一键提示词只请求加载相应 skill。

## 验证

通过 DSH 注册测试 191 项、官方统计一致性和取证测试、Pi/Codex 取证及 MCP/Pi 传输测试、skill 同步检查。六个主题的结果和续页均检查不含 method、methodRef、outputRule、reportRule。Codex/Pi 包在仓库外解包执行查询、生成视图和渲染报告；DSH 包独立加载 runtime skill，核对元数据与资源链接。

工具定义体积对比：DSH 官方 standalone 定义估算 831 → 828 token；便携四工具声明 4324 → 4422 UTF-8 字节。这里仅计工具声明，不是实际整轮提示词或模型费用。主要变化是查询结果不再重复携带教学正文；分析时按问题读取方法。

新增检查通过 Claude 原文、长结果续读、重复用量、混合会话与不完整尾行测试，以及生命周期绑定契约。Codex/Pi/Claude 三套包在仓库外解包执行查询、生成视图和渲染报告，四宿主的资源引用可达。

DSH 工具 0.6.0、视图 0.10.32 已通过原生 `dsh plugin --profile web add` 安装；安装目录的注册与取证自检通过，新启动的 3080 实例通过认证后的页面与路径路由检查。Codex/Pi/Claude 本地包为 0.2.1。Claude 本机 transcript 已做只读验证；未找到 Claude Code CLI，未验证实际 CLI 插件发现，也未更新本体。完整相关文件见 [封装文件清单](host-integration-files.md)。

共享视图回归修复：DSH 页面装配接入与其他宿主相同的来源多选、总趋势及折线压缩资源。总趋势默认关闭，关闭态在数据投影和 SVG 构建之前返回。455 轮会话已核对七类来源、多选及关闭态零面积路径。Codex、Pi、Claude 与 DSH 共享脚本内容一致。
