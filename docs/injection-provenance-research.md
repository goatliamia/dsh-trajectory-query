# 上下文注入来源与位置：旧研究的新版本复核

复核日期：2026-10-30。范围为本机安装的 DSH `0.2.2-alpha.2`，不是对上游最新版本或正在运行进程的版本判断。本次只读源码与已有日志，执行离线合成探针，不向真实会话注入内容，也未调用模型。

## 结论

来源、组装与存续是各类诊断共享的解释剖面，当前实现状态见 [诊断入口](diagnostics.md)。可复用持久记录和官方 SurfaceManager；原始调用 API、插件注册来源和 provider 实际 token 位置有另外的数据缺口。

旧研究中 system section、runtime-context 和 user-role 投递的核心区分仍有意义，但不能把当时的三类列举当成当前所有内容来源。当前还有独立的 system/developer 消息、工具结果，以及工具执行后产生的 additionalContexts。

## 1. 对照依据

本地 runtime 研究副本，HEAD `5eabd7b`（2026-09-19）。主要阅读：

- `docs/23-loop-insertion-map.md`：按 `0.1.6-alpha.2` 复核的插点清单。
- `docs/21-turn-continuation-and-injection.md`：原 `0.1.5`～`0.1.6` 续跑机制与成本实验。
- `experiments/placement/REPORT.md`：2026-09-01 的 section/context/pre-step 对照，N=3/有效臂。

当前安装的 `dsh-agent-loop`、`dsh-system-prompt`、`dsh-session`、`dsh-llm`、`dsh-agent-instructions` 均为 `0.2.2-alpha.2`。

`dsh-agent-loop/lib/index.js` SHA-256：

```text
a6fa8e0c7c90191caf5f4a3bb5c624a86e9845cf3c79d020b71420d0e20ae4c1
```

## 2. 哪些仍成立，哪些要修正

| 旧研究的认识 | 当前复核 |
|---|---|
| systemPrompt.section 与 context 是不同通道 | 仍成立。section 形成 system 文本；context 形成动态 user-role 快照 |
| pre-step 可以调整当前步的消息 | 仍成立。waterfall 的 enter 决策由 loop 在请求准入阶段写入 user/message |
| steer/inject 进入 next-step，followup 进入 next-turn | 核心映射仍成立。steer/followup 会唤醒，inject 不唤醒；中止后的唤醒投递还可能改投 next-turn |
| turn-stopping 内 steer 能让同轮继续 | 仍有同样机制：收尾回调后重新检查 nextStep；消息被接纳时可继续模型步骤 |
| 只从 user-role 或 plugin 前缀识别注入 | 不够。source.kind 是生产者声明，form 是信息形态；当前官方生产者包括 agent-instructions、runtime-context、skill-catalog、tool-jobs 等 |
| 系统提示主要看 request/header.system | 已改变。该字段已退役，当前正文位于 system/message，追加/替换由 surfaceOp 表达 |
| system section 的转录可见性有盲区 | 系统正文现在有持久记录；但合并后的 system 文本通常没有逐 section 的历史归属表 |
| agent/request 可作为自由改输入的挂点 | 不能沿用。当前仅用于调用配置，不能改 messages，且标记 deprecated，不应新增此类监听 |
| request/context 可当作每次请求记录 | 不成立。当前只在 provider/model/contextWindow/systemPromptUpdate 等元数据变化时追加，不能按条数统计模型请求 |

旧实验的 1.04×、1.54× 等成本比例以及位置对采纳的结果不迁移为当前结论。源码复核与本次探针只验证机制；新模型、适配器与任务的行为收益需要重新对照。

## 3. 当前的实际落点

### system section

`SystemPrompt.assemble()` 对注册项排序、运行 presentation waterfall 并处理 complete section，`renderPrompt()` 合并最终文本。loop 使用 `SystemPromptProjection.project()` 决定如何提交：

- 首次提示保留在 surface 的第一个系统节点；surface 顺序不是事件 seq 顺序的简单复制。
- 支持 in-history 更新的继续序列，可以在已有历史后追加变化后的非空 system/message。
- 不支持的路由、清空提示或需要重新基线化的新序列，会通过逐节点 replacement 清掉后续系统节点，并在需要时替换首节点。
- 最新有效文本未变时可以不产生新事件，即使开始新请求序列。

所以不能概括为“系统提示永远只在头部被改写”，也不能断言它总是尾部追加。需要看实际 surfaceOp、sourceEventSeqs、序列和路由能力。

### runtime-context snapshot

`SystemPrompt.context()` 的内容形成具名的 sections。请求准入时会重新刷新已接受的动态事实，再决定是否提交快照；不能只观察较早的 assemble 结果就认为它一定进入了请求。

- 文本变化时，提交新的 user/message，source.kind 为 runtime-context，form 为 snapshot，sections 保存顺序和原文。
- 保留文本相同时不重复提交。注册名变化但合并文本相同，也不会仅为更新名称再提交一条快照。
- 新快照通常追加，语义上取代旧快照；旧事件不会仅因新快照出现就被自动 shadow 掉。
- 内容清空时追加明确的清空提示；快照被压缩替换后，未变化的当前事实可能再次发布。

这里要分开显示“最新状态”“仍在历史中”和“已被替换移除”。三者不能合成一个影响范围。

### inbox 与 pre-step 消息

`agent/inbox/spliced` 是持久记录，包含 next-step/next-turn、规范化插入/移除以及消息 ID。正式 user/message 保留消息身份，因此可以关联队列与提交。

- 入队不等于进入模型可见 surface。
- 领取会产生出队记录，但 pre-step 拒绝、取消或准备失败仍可能阻止正式消息提交。
- outcome 为 canceled 的移除不能算作已经送达模型的内容。
- pre-step 直接组成的消息可能没有对应入队事件；没有匹配不能据此判成丢失或伪造。
- 队列目标和实际提交轮次应分别显示：next-step 也可能在后续新轮被领取。
- durable 队列记录没有统一保存 wakeup 或原始 API 名；仅凭 next-step 无法严格区分 steer、inject、直接操作 inbox 或部分 additionalContexts。

### developer、工具结果与附加上下文

新版本用 developer/message 记录工具增加/移除等增量，并可通过 headerSeq 关联声明。工具执行结果可以另行提供 additionalContexts，由 loop 入 next-step；这与工具正文是不同记录。

原生 PTC dispatch 记录也不自动等于模型历史中的独立消息。需要确认内容经何种 tool/result 或其他正式 surface 消息对模型可见。

## 4. 私有长会话的结构核对

对一份冻结长会话做聚合，并用当前官方 SurfaceManager 重放最终 surface。原始会话仅保留本地，以下为结构汇总：

| 记录 | 数量或结果 |
|---|---|
| 总事件 | 24,226 |
| agent/inbox/spliced | 1,632 |
| 入队条目 | 851 |
| 被取消移除的入队条目 | 89 |
| 出队且正式 user/message 可按身份关联 | 762 |
| user/message 总量 | 814，全部含消息 ID |
| 无匹配收件箱出队身份的 user/message | 52；只表示未找到这条收件箱关联 |
| runtime-context 快照 | 12，均有具名 sections |
| 这些快照的 section 名 | sandbox:policy、approval:policy |
| 最终 cut 中仍保留的 runtime-context 快照 | 1 |
| request/context | 1；显然不能把它当 2,241 步的逐请求计数 |

这组数量统计的是事件和条目，不是去重后的语义通知、价值或 token 成本。

一个无需正文语义判断的实际关联：

```text
source=tool-jobs, form=notice
seq 198：进入 next-step 队列
seq 209：从队列移除以领取
seq 211：正式 user/message，第 1 轮第 15 步
```

它能够证明队列到正式记录的路径，不能仅由这三个事件证明调用方具体使用了 steer 还是 inject，也不证明模型随后采纳了通知。

## 5. 第一版建议

先增加只读的来源与位置取证，挂在现有诊断入口；目前该主题尚未实现，不应在提示词中调用虚构 view。

每个对象展示五项相互独立的信息：

1. **来源**：记录的 source.kind/form、具名 section、消息或声明的证据位置。
2. **投递**：已知的队列目标、入队/领取/取消；原始 API 未记录时标未知。
3. **落点**：system/user/developer/tool、选定 cut 中的顺序、append 或 replace 及替换范围。
4. **时机**：在哪个 turn/step 正式提交；有足够请求证据时再关联请求边界。
5. **存续**：待领取、取消、已提交、保留或被 shadow；快照的语义过期与物理移除分开。

在此基础上才分析重复目录、动态事实反复变化、压缩后重新发布、被取消的通知，以及收尾投递后是否增加了模型步骤。内容位置作为解释变量；不把“位置靠前/靠后”直接判为问题。

数据复用同一会话观察与 cut，按需建立紧凑索引；surface 使用官方实现，避免按 seq 自行猜消息位置。先支持结构化的新记录，旧日志缺字段就标缺口，不建立庞大的兼容解析器。

第二阶段如确有需求，再考虑给未来记录补充原始入口、插件注册来源和原始 section 清单。捕获必须与实际请求准入结果绑定；不新增 deprecated agent/request 监听，不再复制整份提示词或全部请求正文。

## 6. 位置的边界

第一版可以说明 Harness 逻辑历史中的消息与 section 位置。provider 序列化还可能改写角色、合并相邻消息和调整块顺序。例如当前 DeepSeek Messages 路线把工具结果放入 user 的 tool_result 块，并处理历史中的 system 更新。

因此不把 Harness 的消息索引冒充 provider wire 的块索引，也不报告精确 token 偏移或“注意力比例”。证明模型使用了内容仍需要执行结果、明确引用或受控对照，不能由注入位置推出。

## 7. 核验与源码定位

离线探针执行已安装官方 bundle 中未改动的 Inbox、SystemPromptProjection、RuntimeContextProjection，配合官方消息构造器和 SurfaceManager。14 个机制案例通过，涵盖系统追加/替换/清空、快照去重/更新/压缩后重新发布、入队/领取/取消及消息身份关联。这不是完整 AgentLoop 到 provider 的端到端实验。

本地结果：`.dsh/injection-audit/results.json`、`long-session-inventory.json`、`long-lineage.json`；合成探针与日志仅留在 Git 忽略目录。

当前安装包的关键位置：

| 包内文件 | 行 | 内容 |
|---|---|---|
| dsh-agent-loop/lib/index.js | 103、198 | claim 与 durable inbox splice |
| 同上 | 236、263、333 | system 节点投影与 runtime 快照投影 |
| 同上 | 564、570 | send 与 followup/steer/inject |
| 同上 | 666、791、833 | pre-step、收尾复查与请求准入 |
| 同上 | 972、1018、1075 | additionalContexts、请求构建与元数据变更记录 |
| dsh-system-prompt/lib/index.js | 117、136、151、324、356 | prompt/section 渲染、动态刷新与组装 |
| dsh-session/lib/types/types.d.ts | 218、294、309、448 | header、消息与 surface 定义 |
| dsh-llm/lib/types/message.d.ts | 33、60、92 | source.kind/form、具名 section 与来源类型 |
| dsh-agent/lib/types/runtime-types.d.ts | 341、402 | agent/request 限制与 turn-stopping 语义 |
| dsh-agent-instructions/lib/index.js | 1376、1480 | workspace 指令来源与 pre-step 安排 |
| dsh-llm-deepseek/lib/index.js | 1603、1644、1695 | DeepSeek Messages 的角色与块转换 |
