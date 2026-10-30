# 上下文构成与投递证据接口：第一阶段

日期：2026-10-30。当前为可执行的只读适配器与独立可视化试作，尚未注册到 DSH 的 HTTP 路由或模型工具。依据本机 SDK `0.2.2-alpha.2`；机制复核见 [注入来源研究](injection-provenance-research.md)。设计说明独立保存，不放入 README。

## 1. 先约束能证明的事情

构成回答「在这个切点，已有统计如何分解内容」；投递回答「哪些内容有来源记录，如何进入逻辑历史，当前是否还保留」。二者共用切点，但不互相推导。未来诊断模型仍应读取全部相关统计，不能只凭这两张视图下结论。

- `source.kind` 是记录中的生产者声明，`source.form` 是内容形态；不自动等于某个插件包名或原始调用 API。
- 入队、领取、正式提交、当前保留是四个不同事实；取消的内容没有正式消息落点。
- 后续同源快照出现，不等于旧节点已从逻辑历史移除。`laterSnapshotSeq` 和 `shadowedAt` 分开保存。
- 逻辑消息顺序由官方 SurfaceManager 决定。替换后不能按事件 seq 排序，也不能用节点数判断压缩是否发生。
- 逻辑消息位置不等于 provider 序列化后的块位置、token 偏移或模型注意力；本阶段不提供这些结论。
- `request/context` 是元数据变更记录，不能当成每次模型请求或工具定义的计费曝光次数。

## 2. 已找到的现有接口

| 读取面 | 已安装接口或字段 | 使用方式 |
|---|---|---|
| 一致的会话观察 | `sessionQuery.observeSession(id, {projectionMode:'none', signal})` | 返回 header、cursor、连续 events、inheritedEventCount、可用的 projections；读取完释放 `[Symbol.dispose]()` |
| 同切点统计 | 观察自带的 `projections`，或 `sessionProjections.restore(checkpoint, events, baseSeq, header, inheritedEventCount)` | 仅接受 `asOfSeq` 与目标切点一致的结果；restore 只在局部状态重放，不 hydrate 活跃会话，不写 checkpoint |
| 官方构成 | `@deepseek-ai/dsh-token-meter` 的 `contextBreakdown` | systemTokens、toolsTokens、messageTokens 三类估算 |
| 官方占用 | 同包 `contextPressure` | pressureTokens、projectedTokens、contextWindow 分列保留 |
| 已有细分类 | 独立社区插件 `dsh-context` 的 `contextTimeline` | 可选七分类与 node 的 cat；当前安装版本 0.77.0，单独标注来源，不称为官方统计 |
| 逻辑历史 | `@deepseek-ai/dsh-session/surface` 导出的 `SurfaceManager` | 使用 nodes 和 deriveEventMessage；空系统节点不算实际消息 |
| 投递生命周期 | `agent/inbox/spliced` | target、start、removedCount、inserted、outcome；重建 next-step/next-turn 队列 |
| 正式来源与落点 | `system/message`、`developer/message`、`user/message`，及替换型 `tool/result` | 消息 ID、source、surfaceOp、sourceEventSeqs、正式提交轮步 |
| 工具声明变化 | developer 消息的 tool-addition/tool-removal 与 `data.headerSeq` | 保存工具名及历史 request/header 指针；工具定义仍归原 header 所有，不从文本推测 |

SDK 文件定位（均在 `@deepseek-ai` 安装目录下）：

- `dsh-session-query/lib/types/observation.d.ts`：精确观察、投影模式与租约契约。
- `dsh-session-projection/lib/types/index.d.ts`：ProjectionSnapshot、restore、checkpoint 契约。
- `dsh-session/lib/types/surface.js`：替换、系统节点及 developer header 校验。
- `dsh-session/lib/types/types.d.ts`：正式消息事件、headerSeq、surfaceOp。
- `dsh-llm/lib/types/message.d.ts`：source.kind/form、snapshot sections、消息身份。
- `dsh-token-meter/lib/types/breakdown-projection.js`、`usage-projection.js`：现有数值投影定义。

## 3. 本次封装

实现：[analyzers/context-evidence.mjs](../analyzers/context-evidence.mjs)。先提供主机内部的纯读取函数，外部工具名称与 HTTP 契约另行评审。

```js
evidenceCut(session, events, asOfSeq)
readCompositionEvidence({cut, projections, sources})
buildInjectionIndex({session, events, SurfaceManager, asOfSeq, nodeCategories})
readInjectionEvidence(index, {producer, presence, offset, limit})
observeContextEvidence(ctx, session, {
  asOfSeq, signal, SurfaceManager, sources,
  parts: ['composition', 'injections']
})
```

### 统一切点

```js
{ session, asOfSeq, eventCount }
```

输入必须是从 seq 0 开始的完整连续前缀。缺前缀、越界或投影切点不一致时拒绝重建，不把局部日志冒充完整证据。

`observeContextEvidence` 在同一观察租约里完成读取。优先复用该观察中同切点的统计；需要历史重放时每 1,000 个事件让出事件循环，使用独立 checkpoint，设 8 秒协作式预算。单个同步投影调用无法硬中断，预算不是单次调用的超时保证。取消和异常均释放租约。只请求 injections 时不重放数值投影。

### 构成结果

- `categories`：七分类完整可用时透传已有插件结果，否则使用完整的官方三分类。两者都不完整则 `available:false`、`estimate.total:null`，不会造出零或把部分和当总量。
- `estimate`：来源、版本（调用方可提供）、原始统计、估算合计。合计只做展示，不另写 tokenizer，也不按实测输入缩放分类。
- `occupancy`：此前实测输入、官方预计输入、路由窗口。它们有各自的统计基础，不代表同一次请求的原子观测。
- `nodeCategories`：仅透传已有 contextTimeline 的节点分类；它不是逐消息的实际计费归因。
- `coverage`：数值切点、细分类可用性、时间线最早保留轮次、投影异常和限制。

### 投递与保留结果

`buildInjectionIndex` 返回紧凑 records、当前 slots、summary、coverage。主机内部才持有完整索引；模型/接口消费者使用分页读取，默认 30 条、上限 200 条。

| 字段 | 含义 |
|---|---|
| id / messageId | 本次索引的稳定记录键 / 原始消息身份 |
| producer / form / role | 原始来源声明、形态和逻辑角色 |
| queued | 入队 seq、队列目标、领取/取消 seq 与结果 |
| admitted | 正式提交 seq、turn/step、append/replace 操作 |
| queueCorrelation | 唯一已领取消息 ID 匹配、无匹配、或多候选歧义 |
| payloadHash / queuedPayloadHash | 对完整 role/source/content 做规范化 SHA-256；正文相同前缀或长度不足以证明内容相同 |
| payloadChangedOnAdmission | 同一身份的正式内容是否与入队内容不同 |
| replacement | 官方替换范围、sourceEventSeqs；紧邻的 compaction 计量事件指针（如有） |
| declarationHeader / toolChanges | developer 的历史定义指针与明确的增删工具名 |
| sections / instructionChanges | 结构化 snapshot 部分和已记录的指令变化；不做正文语义解析 |
| presence / ordinal / shadowedAt | 当前存续、零起点逻辑序号、移除该节点的替换事件 |
| laterSnapshotSeq | 同生产者已有后续 snapshot；不据此自动改写保留状态 |
| callerApi | 统一为 null：现有投递事件不足以还原 steer/inject 等原始入口 |
| evidence | 可跳转核验的持久事件 seq；原文另取 |

`presence` 区分 pending、claimed-uncommitted、canceled、retained、shadowed、empty-surface-node。同 ID 存在多个已领取候选时不猜中哪条，保留歧义。没有队列关联不等于丢失。

普通 assistant 消息和普通工具返回提供 slots 位置与事件指针，不自动计为注入。slot 的 `categoryBasis` 区分已有投影分类与仅用于展示的角色配色；后者不能用于数值分类归因。文本字符数不包含图片等非文本负载，也不是 token 数。

## 4. 可视化试作

实现：[docs/demo/injection-study](demo/injection-study)。使用这条长对话的本地持久事件，生成六个真实切点：最终历史、后台通知、运行时快照、取消投递、一次工具结果替换前后。

- 左侧显示声明来源，中间显示已记录的队列或直接提交，右侧显示该切点的逻辑消息序列。
- 每个来源仅画一条代表链；选择记录后高亮其真实路径。避免把数百条投递一起铺开。
- 取消链停在逻辑上下文之外；已移除的链没有当前落点。
- 点击消息位置或记录，查看生命周期、快照具名部分和 seq 原始证据。
- 消息等距排列；线宽、位置间距不编码 token 数、耗时或影响强度。
- 七种颜色沿用已有页面。构成、预计输入和实测输入分列。

此长对话里后续运行时快照出现时，旧快照已被更早的替换移除。因此真实 demo 不伪造「两张快照并存」；并存机制由合成契约测试覆盖，历史记录可查看实际移除事件。

运行（在仓库根目录，用本机实际日志路径替换参数）：

```powershell
node scripts/build-injection-study.mjs --source '<session.v4.jsonl.zstd>'
node scripts/serve-injection-study.mjs 3087
```

数据写入 Git 忽略的 `.dsh/injection-study/`。服务器只监听 127.0.0.1，仅读取生成快照和证据白名单；不连接 DSH、调用模型、注册循环监听或后台扫描其他会话。浏览器最多缓存两个案例；正文证据按 seq 读取，节选带省略标记。该快照服务器不是生产接口实现。

性能计量分别报告结构索引 `structureMs` 与包括序列化/压缩/写文件的 `snapshotMs`。整体构建时间还包含读日志、解码、多切点数值重放及证据文件生成，不能拿其中一个数字当成实际 DSH 冷启动或首屏加载耗时。

## 5. 核验与接入前剩余工作

`node analyzers/context-evidence-test.mjs` 使用已安装官方消息构造器与 SurfaceManager，通过队列/领取/取消、同 ID 歧义、完整 payload 变化、快照并存与替换、实际顺序、工具定义 header 关联、数值缺失、切点一致、只读重放、异常降级与租约释放检查。

生产接入仍需明确：观察结果的有界复用、原文分页/体积限制、调用取消、外部 schema 版本、状态变更后的索引失效，以及真实挂载服务的集成测试。当前没有新增模型工具名，不要求模型调用尚未发布的 view。未来如需原始插件注册来源或 provider 实际块位置，需要新增对应的确定性取证，不能在此适配层猜测。

## 6. 请求缓存回执与图内信息（后续试作）

新增 [analyzers/request-context-evidence.mjs](../analyzers/request-context-evidence.mjs)：

```js
requestUsageEvidence(usage)
buildRequestContextIndex({session, events, SurfaceManager, lastAssistantStreamChunk, asOfSeq})
readRequestContextEvidence(index, {contextCut, surfaceSeq, excluded})
```

使用已安装 SDK 的 `lastAssistantStreamChunk` 取最终 usage，优先正式 `assistant/message.data.usage`，同时支持 `assistant/attempt` 内嵌 usage。相同 turn/step 的重复结算沿用同一槽；`llm/retry-started` 后才形成新的尝试组，与官方 tokenUsage 的替换口径一致。该索引用于关联请求回执，不宣称它是额外的权威请求次数统计。

SDK 的输入桶互斥：inputTokens 是未命中输入，cacheReadTokens 是缓存读取，cacheWriteTokens 是缓存写入。完整输入分母优先使用合规的 totalTokens 减 outputTokens，否则在三个桶都上报时相加；矛盾或缺失时不制造完整命中率。未知桶不变成零。

每次首次结算前，用官方 SurfaceManager 读取逻辑消息序列，比较相邻输入的共同 seq 前缀、首处历史变化、期间 replacement 及工具声明变化。它只证明逻辑历史结构，不模拟 provider 的缓存切块、token 偏移、缓存过期或节点路由。

通过正式消息的 surface seq，查询第一次在请求前逻辑历史中出现的位置。结果分别携带当前图的 `contextCut`、取证范围 `observedThrough`、请求的 `inputCut`、结算 seq，以及 `receiptAfterContextCut`。demo 是回顾性取证：后续请求回执会明确标“后续首次请求”，不会冒充原切点已有的实测结果。取消/尚未提交的条目不关联未来请求，旁边只展示该切点之前的最近回执。

DeepSeek 的缓存确实依赖完整匹配已落盘的前缀单元，且属于尽力而为；规则见 [官方缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)。逻辑前缀未变不保证命中，缓存下降也不能仅凭邻接就归因于一条注入。图中缓存条独立编码整次请求用量，不把其中某段消息标成精确命中区域。

右侧按记录分成系统基线、工具声明、对话历史。系统基线取当前第一个实际 system 节点；历史中途的系统更新仍留在原位置。工具区读取当前 request/header 的声明计数和名称，并提供 header 证据，不伪造一个 tools-role 消息。数值为既有来源估算，不是 provider wire 的字节/块布局。

来源旁增加当前保留内容的估算量；本条注入展示已有节点估算。单独的缓存回执列出当前及上一次命中率、命中和未命中输入，以及相邻输入间的历史替换数量。以长对话两个真实案例核对：后台通知后首次请求为 74,752 / 79,309，约 94.3%；历史替换案例为 19,968 / 628,318，约 3.18%，与上次 99.97% 对照，期间共 14 处替换。这里只报告伴随变化。

动效展开当前保留历史，单轮按 step、多轮按 turn 连续分组，长对话合并为至多 12 个主要阶段。它不是完整历史回放，不复现已移除节点；系统与工具区域先显现，消息条带和选中连线随后展开，约 1.5 秒后静止。CSS 仅运行一轮，可手动重播，遵循 prefers-reduced-motion；数据和点击交互不等待动画结束。没有新增轮询、帧循环或常驻计时器。

demo 的 `/receipt?seq=` 仅读取离线白名单文件；浏览器最多缓存 4 个单条回执。snapshot 仍最多保留 2 个。原始事件即使截断正文，也会把可核对的 usage 字段单列在前面。

新增测试 `node analyzers/request-context-evidence-test.mjs` 覆盖完整/缺失/矛盾计数、真正的历史前缀变化、首次关联、取消排除、重试槽、重复结算、内嵌流用量，以及回顾性切点边界。
