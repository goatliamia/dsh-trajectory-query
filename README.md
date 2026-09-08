# dsh-trajectory-query —— 让已保存的轨迹重新可达

中文 | [English](./README.en.md)

> **DSH 已经把事实全记下来了,缺的只是"需要时能取回"的那条路。**
> 所以这不是 Memory:不摘要、不 embedding、不判断"什么值得记"。

## 为什么需要它

DSH 的会话是一份 append-only 的事件日志:近端在 context 里,远端被 compaction 压成一段摘要、或 resume 之后不再加载。于是有两个具体问题:

- **对 Agent**:context 丢失后,模型只能凭摘要猜("上次那个错误码是多少?")——而原始事件一直躺在日志里,只是没有工具去取。这不是记忆不够,是**读取路径缺失**。
- **对研究者**:自带轨迹视图是横向时间线(输入 / 模型 / 工具三段色块),它告诉你"跑了多少、多长",但读不出**"到底发生了什么、为什么 Harness 这样反应"**——没有把事件、因果与后果组织起来。

所以这个项目只做两件小事:**给 Agent 一条回源取证的路径**,**把轨迹展开成一份带证据的 incident view**。都不改 DSH core。

## 核心原则

1. **检测确定性,解释归模型。** 什么算 incident 由分析器按类型化事件判定;模型只解释,不发明。
2. **投影 = 选择 + 指针,不是改写。** 取回的是原文裁剪,引用原样,附 `(session, seq)`。
3. **面板只渲染证据。** 工具名计数、仅同名的重复这类表面模式,不算 incident。
4. **不存"记忆"。** 分析是派生视图,随时可从日志重算。

## 功能

**历史查询工具(给 Agent)** —— `trajectory_find / window / trace / sessions`,基于 `ctx.sessionQuery`。证据优先:每个答案带 `(session, seq)`、原样引用原文;查询返回空 = 可核验的"没有这样的事实"。

**常驻「分析」标签(Web GUI)** —— 在「对话 | 轨迹」旁边的第三个标签,渲染 **runtime incident view**:

| 元素 | 说明 |
|---|---|
| Incident 卡片 | `Event / Cause / Runtime 知道 / Model 知道 / Harness 反应 / 影响`,带证据 `seq` 可点跳轨迹 |
| Turn 地图 | 一格一个 turn;红 = 该 turn 有失败(可点),灰 = 正常 |
| 机械层事实 | 确定性数字 + 明确标注"需 host"的项 |
| 开放解读 | 折叠区,由 analysis skill 在有限证据上生成,每条带引用 |

**机械分析器** —— `turns / tools / errors / retry / incidents` 五个确定性 fold:同参重复、调用失败、空转 turn 由代码判定,不由模型判断;`analyzers/self-test.mjs` 把语义钉进测试。

**分析 Skill** —— `skill/analysis.md`:把研究问题变成可核验分析(证据纪律、维度发现、分析器契约);规定入口,不规定结论。

**报告** —— `analyzers/run-digest.mjs` 把一次会话变成可复现的 `*.facts.json` + `*.digest.md`。

## 怎么用

```text
# 分析器(不需要 DSH)
node analyzers/run-digest.mjs <session.jsonl.zstd>
node analyzers/self-test.mjs

# 查询工具:把 plugin/trajectory-tools.js 作为 host Cordis 插件装载
# 分析标签:把 plugin/analysis-view 装进 web profile(见其 README)
```

## 目录

- `plugin/trajectory-tools.js` —— host 插件:四个查询工具
- `plugin/analysis-view/` —— 常驻「分析」标签(纯客户端插件)
- `analyzers/` —— 确定性分析器、digest 运行器、自检
- `skill/` —— `trajectory-query.md`(查询纪律)、`analysis.md`(分析方法)
- `docs/` —— 设计说明与实验协议
- `experiments/` —— 语料、探针、manifest、生成的报告

## 安装(分析标签)

```text
pnpm pack
# ~/.dsh/profiles/web/package.json:
#   dependencies: 增加 "dsh-analysis-view": "file:<绝对路径>/dsh-analysis-view-0.1.0.tgz"
#   dsh.profile.bundles: 追加 "dsh-analysis-view"
pnpm install            # 在 ~/.dsh/profiles/web
# 重建 / 重启 dsh web
```

## 已知缺口

- 面板的 retry 是**名字级**;**同参**检测在 host 分析器 `analyzers/incidents.mjs`。
- 卡片上的 `Harness 反应` 目前是模板文案,尚未由 guard / 干预事件推导。
- 客户端只看到轨迹投影;更丰富的 incident 需要 host 数据。

## 许可证

MIT © 2026 goatliamia —— 见 [LICENSE](./LICENSE)
