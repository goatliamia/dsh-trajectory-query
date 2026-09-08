# dsh-trajectory-query

Make DSH's already-saved session trajectories **reachable again** — for agents when context is
gone, and for humans who want to see what actually happened.
把 DSH 已经保存的会话轨迹**重新可达**——给 context 丢失时的 Agent,也给想看"到底发生了什么"的人。

English · [中文](#中文)

---

## English

Not a memory system: no summaries, no embeddings, no vector DB, no "what is worth remembering".
The DSH event log is already the lossless source of truth — this project adds a thin read path over
it and changes no DSH core.

### Features

**Historical query tools (agent-facing)**
`trajectory_find` · `trajectory_window` · `trajectory_trace` · `trajectory_sessions`, built on
`ctx.sessionQuery`. Evidence-first: every answer carries `(session, seq)` and quotes the original
text verbatim — never a paraphrase. A search that returns nothing is a verifiable "no such fact".

**Resident Analysis tab (DSH Web GUI)**
A third tab beside *Conversation | Trajectory* that renders a **runtime incident view**:
incident cards (`Event / Cause / Runtime knew / Model knew / Harness response / Impact`), a per-turn
map (red = a turn with a failure, click to jump), and deterministic facts. It reuses the trajectory
projection and lists only evidence-backed incidents — no profiler counts.

**Mechanical analyzers**
Deterministic, versioned folds over typed events: `turns`, `tools`, `errors`, `retry`, `incidents`.
Same-argument repeats, failed calls and no-op turns are decided by code, not by a model.
`analyzers/self-test.mjs` pins the semantics.

**Analysis skill**
`skill/analysis.md` teaches how to turn a research question into a verifiable analysis — evidence
discipline, dimension discovery, analyzer contract. It defines entry points, not conclusions.

**Reports**
`analyzers/run-digest.mjs` turns one session into reproducible `*.facts.json` + `*.digest.md`.

### Design principles

1. Detection is deterministic; the model interprets, never invents.
2. Projection = selection + pointer, not rewriting. Quotes stay verbatim.
3. The panel renders evidence; surface patterns (tool-name counts, name-only repeats) are not incidents.
4. Nothing is stored as "memory": analyses are derived views, recomputable from the log.

### Quick start

```text
# analyzers — no DSH required
node analyzers/run-digest.mjs <session.jsonl.zstd>
node analyzers/self-test.mjs

# agent tools — mount plugin/trajectory-tools.js as a host Cordis plugin
# Analysis tab — install plugin/analysis-view into your web profile (see its README)
```

### Layout

| Path | What |
|---|---|
| `plugin/trajectory-tools.js` | host plugin: the four query tools |
| `plugin/analysis-view/` | resident Analysis tab (pure client plugin) |
| `analyzers/` | deterministic analyzers, digest runner, self-test |
| `skill/trajectory-query.md` | query discipline for agents |
| `skill/analysis.md` | analysis method (evidence-first, open dimensions) |
| `docs/` | design notes and the experiment protocol |
| `experiments/` | corpora, probes, manifests, generated reports |

---

<a id="中文"></a>
## 中文

**这不是 Memory。** 不做摘要记忆、embedding、向量库,也不回答"什么值得记"。
DSH 的事件日志已经是完整无损的事实源——本项目只在它之上加一条很薄的读取路径,**不改 DSH core**。

### 功能介绍

**历史查询工具(给 Agent)**
`trajectory_find` · `trajectory_window` · `trajectory_trace` · `trajectory_sessions`,基于
`ctx.sessionQuery`。证据优先:每个答案都带 `(session, seq)` 并**原样引用**原文,不做改写;
查询返回空 = 可核验的"没有这样的事实"。

**常驻「分析」标签(DSH Web GUI)**
在「对话 | 轨迹」旁边的第三个标签,渲染 **runtime incident view**:incident 卡片
(`Event / Cause / Runtime 知道 / Model 知道 / Harness 反应 / 影响`)、Turn 地图
(红 = 该 turn 有失败,可点击跳转)、确定性事实。复用轨迹投影,只列有证据的 incident,
不做 profiler 计数。

**机械分析器**
对类型化事件的确定性、可版本化 fold:`turns`、`tools`、`errors`、`retry`、`incidents`。
同参重复、调用失败、空转 turn 由代码判定,不由模型判断;`analyzers/self-test.mjs` 把语义钉进测试。

**分析 Skill**
`skill/analysis.md` 教"如何把研究问题变成可核验的分析"——证据纪律、维度发现、分析器契约;
规定入口,不规定结论。

**报告**
`analyzers/run-digest.mjs` 把一次会话变成可复现的 `*.facts.json` + `*.digest.md`。

### 设计原则

1. **检测是确定性的**;模型只解释,不发明。
2. **投影 = 选择 + 指针,不是改写**;引文保持原样。
3. **面板只渲染证据**;表面模式(工具名计数、仅同名的重复)不算 incident。
4. **不存"记忆"**;分析是派生视图,随时可从日志重算。

### 快速开始

```text
# 分析器(不需要 DSH)
node analyzers/run-digest.mjs <session.jsonl.zstd>
node analyzers/self-test.mjs

# 查询工具:把 plugin/trajectory-tools.js 作为 host Cordis 插件装载
# 分析标签:把 plugin/analysis-view 装进你的 web profile(见其 README)
```

### 目录

| 路径 | 内容 |
|---|---|
| `plugin/trajectory-tools.js` | host 插件:四个查询工具 |
| `plugin/analysis-view/` | 常驻「分析」标签(纯客户端插件) |
| `analyzers/` | 确定性分析器、digest 运行器、自检 |
| `skill/trajectory-query.md` | 给 Agent 的查询纪律 |
| `skill/analysis.md` | 分析方法(证据优先、维度开放) |
| `docs/` | 设计说明与实验协议 |
| `experiments/` | 语料、探针、manifest、生成的报告 |
