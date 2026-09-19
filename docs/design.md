# 设计:Historical Query Layer(不是 Memory)

## 问题

模型没有"过去"。所谓记忆 = 每次请求由 harness 从事件日志**派生**出来的 message 列表(`deriveMessages()`),而不是可随机访问的数据库:

- **近端**:最近几轮原文完整在 context 里。
- **远端**:compaction 之后只剩一条**带损摘要**(`dsh-compaction-basic` 用一条模型写的 summary 顶替旧 span);原始事件仍在日志(只 shadow,不删除),但模型没有通道回去。

结果:模型要么凭摘要猜、要么承认"我不记得";被 shadow 的细节对模型不可达——尽管 GUI 用户仍能浏览全量事件。

## 为什么不是 Memory

传统 Memory(embedding / 向量 / 自动总结 / promotion / 语义图 / AI 分类"什么值得记")想解决"怎么记住"。
但 DSH 已经把**所有事实无损记下来了**(append-only 事件日志,message history 是派生视图,replay 可完整重现)。

缺的不是记忆,是**读取协议**。给已保存的过去补一条可达路径,比再造一套记忆便宜一个量级,并且不引入"摘要 → 幻觉"链条。

## 复用的现成件(已在运行进程逐一确认)

| 需求 | DSH 现成件 |
|---|---|
| 事实存储 | `dsh-session`(事件溯源日志)+ `dsh-session-persistence-jsonl`(每会话 append-only 日志) |
| 派生读模型 | `dsh-session-query-sqlite`:SQLite FTS5,`persisted_docs(session_id, seq, type, time, surface)` + 会话头表 |
| 查询 API | `ctx.sessionQuery`:searchSessions / searchEvents、filterEvents、readEvent(±窗口)、readSurface、traceSession / traceEvent |
| 引用 / 跨会话 | `dsh-session-reference`(`@会话` 提及 → 有界只读快照注入,不可信标记) |
| 压缩 | `dsh-compaction-basic`:shadow 旧 span,事件不删 |

## 缺口(本项目的全部增量)

模型侧没有任何工具调用上述查询;`sessionQuery` 只被 host 侧消费(API controller → GUI 搜索 / turn rail、`@会话` 引用、子代理簿记)。

**要补的:3 个 agent-facing tools + 1 个极薄 skill**,把既有能力接到 agent 循环上。DSH core 一行不改。

## 工具 → API 映射(草案)

| Tool | `ctx.sessionQuery` |
|---|---|
| `trajectory_search(view="events")` | searchEvents / searchSessions(结构化过滤:type / seq / time,返回 hit:{session, seq, type, time, snippet}) |
| `trajectory_read` | readEvent / readSession + seq 切片;输出 **verbatim** 原文 |
| `trajectory_graph` | traceSession / traceEvent(祖先链、子代理关系、事件间引用) |

(工具面在 0.2.0 收敛为三个入口;上表按当时草案的名字记录映射关系。)

## 风险清单(交给实验回答)

1. **find 召回**:query 由模型措辞 → FTS literal phrase;model recall 可能远低于 oracle。需要猜词纪律或"免 query 的 seq/type 浏览"回退。
2. **采纳**:模型会不会主动查而不是猜——需要"纯工具 vs 工具+skill"两臂隔离。
3. **实验假阳性**:摘要泄漏 / 参数记忆污染 → 探针事实必须唯一化。
4. **成本**:按需查询的边际 token 是否随会话长度持平(携带成本线性涨)。

验证协议见 `docs/experiments/protocol.md`。

## 插件解剖:单一插件,三面按需(2026-09 定稿)

trajectory 收敛为**一个插件**,内部三个 facet,全部惰性——不用 = 不调用/不渲染/不注册效果:

```text
trajectory 插件
├─ 查询面(host 工具):trajectory_search / read / graph —— 人和 AI 共用
├─ 分析面:
│    ├─ 分析管线(host,按需):确定性分析器(fold → 事实)→ digest(md/json)→ 对比表
│    ├─ 可选面板(client,占位):纯模板渲染分析结果,零 token(UI 待与用户探讨,未实现)
│    └─ 分析 Skill(skill/analysis.md):教方法、不锁死维度;维度从现象/假设/对比长出来
└─ 与查询面的结合:分析器复用同一 read model(ctx.sessionQuery / 事件日志);
     查询面已验证(证据纪律:H2 verbatim+指针);分析面把同一纪律形式化为分析器契约。
```

- 触发规则:agent 想查才调查询工具;你要研究才跑管线;面板挂上且打开才渲染。
- 分析器是纯 fold、带 version、可丢弃重算——分析产物永不当记忆持久化。
- UI(可选面板)是最后一个 facet:先定槽位契约与"常驻 or 打开才渲染"再实现(见 goal 的 UI 探讨点)。

## 第四个 facet:压缩后对账(2026-09 定稿,可选、默认开)

压缩(shadow)不是删除:事实仍在日志里,变的是**模型眼前**。所以这里不补摘要(补摘要就是让模型
替事实做减法),只加一次提醒——让模型自己说清"我保留的理解是什么",不确定的自己回查。

机制(全在 `dsh-trajectory-tools` 里,不新增插件):

```text
compaction/end(成功)  →  这个会话留一个记号(会话级,一次压缩一个)
agent/turn-stopping   →  有记号 → agent.steer(一条 plugin notice)→ 同轮多走一步
                       →  先清记号,所以一次压缩只对一次账
```

- **为什么是收尾点,不是压缩点**:压缩发生在 step 之间。那一刻注入是插进正在进行的推理;
  收尾点的注入是 loop 会重新读的数据(`turnEnds && this.inbox.nextStep.length === 0` 那两行),
  自然落成单独一步。代价:每次压缩多一个 step。
- **为什么是 notice 形态**:`{ kind: "plugin", plugin, form: "notice", summary }` 是 DSH 自己的
  写法(`model-selection` 的模型切换提示同款)。"这句话是谁说的"由 source 声明,不靠正文猜;
  人读 summary,模型读正文。
- **它是事实的一部分,不是事实**:注入的 notice 默认被 `filter.excludeInjected` 排除
  (`isPluginContext` 认 `source.kind === "plugin"`)—— 机器说的话不进"人说过什么"的检索结果,
  要核实是哪一轮用 `filter.excludeInjected: false`。
- **判据是机械的**:有没有记号由事件决定,不由模型判断该不该对账;`agent.steer` 抛错只吞掉并
  `warn`,不在收尾点中断这一轮。
