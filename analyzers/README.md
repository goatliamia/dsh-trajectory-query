# analyzers —— 分析器注册表(示例框架)

分析器 = 确定性 fold:`事件流 → 结构化事实`。纯函数、可版本化、可对任意会话重算。
**这里是"维度怎么来"的实现层;内置分析器只是示例,不是分析维度的清单。**
契约见 `skill/analysis.md` §4。所有分析器遵守:

```text
{ id, version, definition, events, run(events)->facts, misjudge }
```

## 内置示例(version 1,启发式均有误判面声明)

| id | 事实 | 规则(v1) | 误判面 |
|---|---|---|---|
| `turns` | turn 数/结束原因分布 | 数 `turn/start` 与 `turn/end` | 压缩/截断历史中 turn/end 可能缺失 |
| `tools` | 工具调用直方图 | 数 `tool/call` 按 name 分组 | chunk 打包只影响解析不完全的会话 |
| `errors` | 错误事件与首现位置 | `tool/result.data.error` 或 `turn/end{reason.kind:error}` | 同一错误可能多次出现,去重按 name+code |
| `retry` | 疑似无效重复调用(v1) | 相邻(seq 差<50)同 name 同 arguments 的 `tool/call` 配对 | 同参重复不一定是无效:可能是轮询/幂等探测;只报"疑似",需人工核对 |

## 事件加载

`load-session.mjs`:`loadSession(file) -> { id, events }`
解码复用 `experiments/corpus/decode-session.mjs`(多帧 zstd)。
注意:持久化 jsonl 会打包 chunk 等记录,`events` 是**已落盘的可解析事件子集**;
对 live 会话最准的方式仍是运行时 `ctx.sessionQuery`/`listEvents`(同一批分析器可原样复用)。

## 运行

```text
node analyzers/run-digest.mjs <session.zstd> [outPrefix]
```
输出:<prefix>.facts.json + <prefix>.digest.md(格式见 skill/analysis.md §7)。
