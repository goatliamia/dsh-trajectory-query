# 实验协议:Session Query Skill 能否承担 Memory 的部分职责

> 目标不是"证明"设计,而是**可证伪**。每条假设都要能失败,失败信号要能定位到具体层
> (索引 / 工具界面 / skill 协议 / 采纳激励),而不是一句"方向不对"。
> 全程不改 DSH core,只吃 `ctx.sessionQuery` 与 compaction 现有行为。

---

## 1. 被测物(最小闭环)

只补三样,其余全部复用 DSH 现成服务:

1. **3 个 agent-facing tools**(host-only,薄封装 `ctx.sessionQuery`):
   - `trajectory_find(query?, type?, session?, seqRange?, timeRange?, limit)` → `searchEvents` / `searchSessions`
     - 返回 hit:`{ session, seq, type, time, surface, snippet }`
   - `trajectory_window(session, fromSeq, toSeq, maxEvents, mode=surface|raw)` → 原文,**verbatim**
   - `trajectory_trace(session | event)` → `traceEvent` / `traceSession`:祖先链、子代理关系、事件间引用
2. **skill 文本(≤10 行)**,只教一条纪律:
   > 历史缺失时不要猜,先查。`find → window →` 引用结论时带 `(session, seq)`,引文必须原样。
3. **投影红线**(实现约束):任何返回给模型的内容 = **原文的选择/截断**;
   改写/总结即视为 bug。模型负责解释,不负责压缩事实。

## 2. 可证伪假设与判据

信息体制统一为:**压缩摘要 + 近期尾部**(目标事实只存在于日志)。

| # | 假设 | 判据(工具臂) | 若失败,指向哪一层 |
|---|---|---|---|
| H1 | 回源召回:远端事实可找回 | 正确率 ≥ 8/10;且显著高于无工具臂(无工具臂预期 ≤ 3/10) | find recall(索引/找词)或窗口工具 |
| H2 | 证据保真:verbatim + 指针抑制幻觉 | 事实断言 100% 可由 `(session,seq)` 支撑;带引号引文 100% 逐字命中 window;阴性探针"无证据" ≥ 8/10 | 投影层被加工 / skill 未教原样引述 |
| H3 | 经济性(Q1 修正版):按需查询成本可负担 | 每探针边际 token ≤ 持续携带该事实的 token 成本的合理比例;或"查询成本不随会话长度增长(斜率平),携带成本线性涨" | 工具返回过长 / 设计本身不值 |
| H4 | 采纳(Q3):模型会主动查而不是猜 | 目标不在 context 时 find 使用率 ≥ 7/10(且 **纯工具无 skill** 臂显著更低 → 纪律必要);目标在近端时两臂都不乱查 | 工具不够便宜/结果不够干净/纪律不够显眼 |

## 3. 为什么不用"2000 turns + 自然等 compaction"

那个场景直觉上最像现实,但作为**实验**有两个隐蔽失效点:

1. **摘要泄漏**:compaction 摘要是模型写的,可能恰好保留了探针事实 → 无工具臂也能答对,
   "工具臂赢了"但结论无效。必须在压缩后**先读摘要确认事实不在其中**,在则换事实。
2. **参数记忆污染**:真实世界的常见事实(常见错误、通用结论)模型本来就知道,答对与工具无关。
   探针事实必须**唯一**(伪造错误码 / 文件名 / 版本号 / 决策理由),参数记忆给不出。

修正:**信息体制受控**——"context 丢失"用任意手段制造(手工 `compactRegion`、resume 新 agent、
或模拟摘要+尾部),验证对象是"日志可回源 + 模型会去取",compaction 只是制造丢失的装置,
不是被测物本身。

### 3.1 探针三类(缺一不可)
- **P_near 近端阳性对照**:事实在尾部 context → 两臂都应答对。证明探针可答、模型有能力。
- **P_far 远端目标**:事实只在日志 → 工具臂应找回;无工具臂预期猜 / 幻觉。
- **P_absent 远端阴性**:从未发生过的事 → 工具臂应借 `find` 空结果答"无证据"。
  这是防幻觉最强的探针:`find` 返回空 = 可核验的"确实没有"。

### 3.2 事实构造规则
- 唯一性:罕见 token(见上),语义多样:错误文本 / 参数值 / 文件路径 / 决策理由 / 子代理结论。
- 答案键从日志 **verbatim 提取**,不是人写的 paraphrase。
- 问题措辞不得与日志原句雷同(转述式问法),否则无工具臂也能从摘要猜出。
- 同体制下选 5–8 个不同深度的事实,每臂每探针重复 ≥ 3 次(模型采样变异)。

## 4. 隐藏瓶颈:find 的召回(先于一切测)

`find` 是模型自己措辞 → FTS literal phrase。两个数字决定设计成败:

- **oracle recall**:query 取日志原文片段 → FTS 层本身的天花板
- **model recall**:模型自然语言问法 → 真实可用率

若 model recall ≪ oracle(预期是主要风险):
skill 必须教"先用表面词猜词 → 命中不足就换词 / 放宽 / 按 type·seq·time 过滤",
或 `trajectory_find` 增加**免 query 的浏览回退**(纯 seq/type 过滤)。

## 5. 场景分层

### Tier 0 — 合成信息体制(半天,第一优先)
不需要真实长会话。构造"摘要 + 尾部"信息体制 + 可查询日志(合成或真实旧会话摘录)。
隔离干净,先回答:H1 / H2 / H4 / find recall。

### Tier 1 — 端到端真实 compaction(1–2 天)
1. **burner 会话**:驱动一个子代理做多步任务(建项目 → 改文件 → 测试失败 → 修 → 成功),
   植入唯一事实(伪造错误码等),自然生成数百事件。
2. `compactRegion`(或 `/compact`)压掉前 ~80%,**读摘要确认无探针事实**。
3. 让全新 agent(resume / fork)面对该体制,跑完整探针组。
4. 顺带验证前提:compaction 后原始事件仍在、seq 稳定(回源假设的地基)。
生态效度最高:查询与压缩都走真实 DSH 路径,非 mock。

### Tier 2 — 采纳度观测(可选,数周,不做"实验")
真实使用里统计 query 工具调用率与触发场景(compaction 后 / resume 后 / 跨会话),
回答"长期是否真的被用"。实验只能证"能用、好用",证不了"长期有人用"。

## 6. 实验控制
- 自变量:工具/纪律 → 3 臂:**无工具 / 纯工具(无 skill)/ 工具 + skill**
- 因变量:正确率、幻觉率、引用有效性、verbatim 命中、每探针 token、find 使用率
- 控制:同模型同配置;臂间顺序轮换;答案由**不知臂别**的第三方子代理按 rubric 盲评;
  verbatim 与指针做**自动校验**(引文字符串逐字查 window 原文;指针 decode 后查事件)
- 防污染清单:摘要泄漏 / 参数记忆 / 问题措辞泄漏 / 过度依赖工具 / 评分主观 / 会话间污染

## 7. 判读矩阵(失败也是结论)
| 观测 | 判读 | 下一步 |
|---|---|---|
| H1 败 且 model recall 低 | find 找词层问题,非概念失败 | 修 find 或 skill 猜词协议,重测 |
| H1 败 且 recall 高 | 模型不把 snippet 当证据 / 不会 window | skill 协议问题,改示例 |
| H2 败(verbatim 破) | 投影被加工或模型改写 | 查投影 bug / 协议加"原样引述" |
| H4 败 | 采纳问题:成本或可见性 | 结果更短 / 触发时注入 / 改激励 |
| 全绿 | 可查询轨迹承担 Memory 的"精确取回 + 可核验"职责成立;Memory summary 退位为"概况" | 决定是否做成正式 skill 并默认挂载 |

## 8. 实施清单
1. dynamic cordis plugin(host):3 tools 映射 `ctx.sessionQuery`(`find`→searchEvents/filterEvents;
   `window`→readEvent + 切片;`trace`→traceEvent/traceSession)+ 定位当前 session
2. skill 文本 ≤10 行
3. 语料:Tier 0 合成 或 Tier 1 burner
4. driver:压缩 → 摘要校验 → 探针组 → 收集回答与 token(tokenMeter)
5. 评分:rubric + verbatim/指针自动校验 + 盲评
6. 报告:H1–H4 判据表 + 定位结论

## 9. 状态
- Tier 0 结果与原始数据 → `experiments/reports/tier0-results.md`
