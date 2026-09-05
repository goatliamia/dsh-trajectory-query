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
| `trajectory_find` | searchEvents / searchSessions(结构化过滤:type / seq / time + FTS query,返回 hit:{session, seq, type, time, snippet}) |
| `trajectory_window` | readEvent / readSession + seq 切片;输出 **verbatim** 原文 |
| `trajectory_trace` | traceSession / traceEvent(祖先链、子代理关系、事件间引用) |

## 风险清单(交给实验回答)

1. **find 召回**:query 由模型措辞 → FTS literal phrase;model recall 可能远低于 oracle。需要猜词纪律或"免 query 的 seq/type 浏览"回退。
2. **采纳**:模型会不会主动查而不是猜——需要"纯工具 vs 工具+skill"两臂隔离。
3. **实验假阳性**:摘要泄漏 / 参数记忆污染 → 探针事实必须唯一化。
4. **成本**:按需查询的边际 token 是否随会话长度持平(携带成本线性涨)。

验证协议见 `docs/experiments/protocol.md`。
