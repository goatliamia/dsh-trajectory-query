# dsh-trajectory-query

把 DSH 已经保存的会话轨迹**重新可达**——一个极薄的历史查询层实验。

> 近端(context 里)直接看;远端(被 compaction 盖住 / resume 之后)需要时**查询回源**,取原文局部证据,重新进入 context。

**这不是 Memory。** 不做摘要记忆、embedding、向量库或"什么值得记"。DSH 的日志已经是完整无损的事实源;我们只给 Agent 打开一扇门:**3 个查询工具 + 1 条纪律**。

## English

**Make DSH's already-saved session trajectories reachable again** — a minimal historical-query
layer, not a memory system.

- Near context: read directly. Far past (compacted, or after resume): query back and pull
  verbatim local evidence into context.
- No summaries, no embeddings, no vector DB, no "what is worth remembering": the DSH event log is
  already the lossless source of truth. We add **3 query tools + 1 rule** — when history is
  missing, look it up instead of guessing.
- Validated: Tier 0 (controlled) and Tier 1 (a real 24k-event session with real two-level
  compaction; 6/6 verbatim retrieval, 2/2 verifiable absence). Reports: `experiments/reports/`.
- Analysis side: `plugin/analysis-view/` — a resident **Analysis** tab in the DSH Web GUI that
  renders a deterministic, evidence-cited **runtime incident view**; `analyzers/` holds the
  mechanical incident detection and `self-test.mjs` (semantics pinned by tests).
- No DSH core changes: the agent-facing tools are host-only plugins over `ctx.sessionQuery`.

## 为什么值得做

- DSH 事实层全有:事件日志(`dsh-session`)、JSONL 持久化、SQLite FTS5 派生读模型、`ctx.sessionQuery` 查询 API、trace、compaction——全部在运行进程里。
- 缺的只有:**模型侧没有任何查历史的工具**。`sessionQuery` 目前只被 host 侧消费(UI、`@会话` 引用、子代理簿记)。
- 后果:compaction 之后模型只剩一段带损摘要,而原始事件仍在日志里(只 shadow 不删除)——补齐"重新可达"这一层,成本极小。

## 三条铁律(详见 `docs/design.md`)

1. **投影 = 选择 + 指针,不是改写**。返回给模型的内容必须是原文的裁剪;改写或总结 = bug。模型负责解释事实,不负责压缩事实。
2. 模型不写 SQL。工具是闭集动词:`find / window / trace`。
3. 引用纪律:结论带 `(session, seq)`,引文原样。

## 目录

| 路径 | 内容 |
|---|---|
| `docs/design.md` | 设计判断与收敛过程(为什么不是 Memory)+ 单插件三面解剖 |
| `docs/experiments/protocol.md` | 可证伪实验协议(Tier 0 / 1 / 2) |
| `plugin/` | 动态 Cordis 插件源码镜像(装载方式见其 README) |
| `skill/trajectory-query.md` | 历史查询纪律(agent 自服务) |
| `skill/analysis.md` | 分析 Skill:把研究问题变成可核验分析(不锁死维度) |
| `analyzers/` | 分析器注册表:契约 + 事件加载 + 内置示例(turns/tools/errors/retry)+ digest 运行器 |
| `experiments/` | 实验流水线(语料/探针/盲评/manifest/digest 产物) |

## 状态

- [x] 设计收敛 & 实验协议
- [x] Tier 0:合成信息体制(5/5 远端取回、2/2 阴性无证据、H1/H2 ✅、H3 弱 ✅、H4 软 ✅;报告 `experiments/reports/tier0-results.md`)
- [x] Tier 1:真实长会话双盲探针(6/6 存在 verbatim 取回、2/2 阴性;真实两级 compaction 影子事件可查;报告 `experiments/reports/tier1-results.md`)
- [x] 查询面插件(tqry-1)+ 分析面非 UI 部分(分析器框架 + digest + 分析 Skill + manifest 骨架)
- [ ] UI:可选面板(待与用户探讨:槽位/常驻形态/是否必要)

> 注:本地目录名为历史遗留的 `sql event`,与仓库名无关。
