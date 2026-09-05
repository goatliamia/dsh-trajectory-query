# dsh-trajectory-query

把 DSH 已经保存的会话轨迹**重新可达**——一个极薄的历史查询层实验。

> 近端(context 里)直接看;远端(被 compaction 盖住 / resume 之后)需要时**查询回源**,取原文局部证据,重新进入 context。

**这不是 Memory。** 不做摘要记忆、embedding、向量库或"什么值得记"。DSH 的日志已经是完整无损的事实源;我们只给 Agent 打开一扇门:**3 个查询工具 + 1 条纪律**。

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
| `docs/design.md` | 设计判断与收敛过程(为什么不是 Memory) |
| `docs/experiments/protocol.md` | 可证伪实验协议(Tier 0 / 1 / 2) |
| `plugin/` | 动态 Cordis 插件源码镜像(host-only,装载方式见其 README) |
| `skill/` | Skill 纪律文本 v0 |
| `experiments/` | 实验流水线约定(语料/探针/盲评) |

## 状态

- [x] 设计收敛 & 实验协议
- [x] Tier 0:合成信息体制(5/5 远端取回、2/2 阴性无证据、H1/H2 ✅、H3 弱 ✅、H4 软 ✅;报告 `experiments/reports/tier0-results.md`)
- [ ] Tier 1:真实长会话(旧持久化会话 24,208 事件)+ 双盲探针 + 成本对比(进行中)
  - 附带发现:FTS 索引本部署被禁(`openAt:"never"`);51 个持久化会话中未观测到 compaction(surfaceReplace=0)

> 注:本地目录名为历史遗留的 `sql event`,与仓库名无关。
