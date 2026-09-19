# dsh-trajectory-query —— 让已保存的轨迹重新可达

中文 | [English](./README.en.md)

> **DSH 已经把事实全记下来了,缺的只是"需要时能取回"的那条路。**
> 所以这不是 Memory:不摘要、不 embedding、不判断"什么值得记"。

## 为什么需要它

DSH 的会话是一份 append-only 的事件日志:近端在 context 里,远端被 compaction 压成一段摘要、或 resume 之后不再加载。于是有两个具体问题:

- **对 Agent**:context 丢失后,模型只能凭摘要猜("上次那个错误码是多少?")——而原始事件一直躺在日志里,只是没有工具去取。这不是记忆不够,是**读取路径缺失**。
- **对研究者**:自带轨迹视图是横向时间线(输入 / 模型 / 工具三段色块),它告诉你"跑了多少、多长",但读不出**"到底发生了什么、为什么 Harness 这样反应"**——没有把事件、因果与后果组织起来。

所以这个项目只做两件小事:**给 Agent 一条回源取证的路径**,**把轨迹展开成一份带证据的 incident view**。都不改 DSH core。

## 它长什么样

一次真实查询(本仓库自己的会话):

```text
search(view="events", session="session-e0636aa9-…", query="FS_NOT_OBSERVED", filter={types:["tool/result"]})
→ seq=1248  tool/result  FsError:FS_NOT_OBSERVED
  log=2981dc3bba29

read(session="session-e0636aa9-…", seq=1248)
→ seq 1243…1253 的逐字原文(工具调用 / 错误 / 助手输出)
```

同一个会话在「分析」标签里被组织成卡片 —— 下面是真实输出:

```text
调用失败 ×15        Event    15 个工具调用返回错误
                    Cause    工具调用返回了错误结果
                    Runtime  错误码 / 失败状态已在事件中
                    Model    收到 tool result(可能已含错误)
                    Harness  部分 guard 已拦截(FsError:FS_NOT_OBSERVED, WebError:WEB_BLOCKED_URL);其余需模型自纠
                    Impact   该部分目标未达成
                    seq      251 · 351 · 357 · 1032 · 1248 · 1250 · …
```

三段分别是:**事实**(逐字事件 + 位置)、**归因**(Runtime 与 Model 各自知道什么)、**后果**(Harness 反应与影响)。卡片上的 `seq` 可点击跳到轨迹视图。

## 核心原则

1. **检测确定性,解释归模型。** 什么算 incident 由分析器按类型化事件判定;模型只解释,不发明。
2. **投影 = 选择 + 指针,不是改写。** 取回的是原文裁剪,引用原样,附 `(session, seq@logId)`。
3. **面板只渲染证据。** 工具名计数、仅同名的重复这类表面模式,不算 incident。
4. **不存"记忆"。** 分析是派生视图,随时可从日志重算。

## 功能

三件事:**取回事实**、**组织事实**、**约束纪律**。

**1. 历史查询工具(给 Agent)** —— 常驻 host 插件 `dsh-trajectory-tools`:三个只读入口按**问题**分,不按数据源分 —— `trajectory_search`(`view` 必填:`events` 字面命中 / `catalog` 计数与范围 / `cost` token 成本 / `sessions` 会话列表)、`trajectory_read`(按 seq 区间逐字取原文)、`trajectory_graph`(替换/引用/派生链与会话谱系)。它们直接读 DSH 已有的事件日志(首选 `sessionQuery.observeSession`,兼容退路是内存快照与 `sessionPersistence` 句柄)。证据优先:每个答案带 `(session, seq@logId)`、原样引用原文,片段以命中点为中心;查询返回空 = 可核验的"没有这样的事实"。可选维度收在一个 `filter` 对象里(键按 view 不同,传错会告诉你这个 view 认哪些);`events` 默认搜「当前会话 + 所有 live 会话」、默认丢掉注入样板与工具自己的调用、匹配默认归一化,单反斜杠也能查到日志里转义过的路径。

**可选:压缩后对账(默认开)** —— 冲着这个现象:上下文一压缩,模型常常把头埋下去接着干,不问你、也不说自己现在以为这件事是要做什么;被压掉的那段它确实看不见了,可语气跟什么都没丢过一样,等你发现方向不对,它可能已经白干了很多步。做法是在一次**成功**的 `compaction/end` 之后给这个会话留一个记号,等这一轮走到收尾点(`agent/turn-stopping`)注入一句话:用不超过两行说明"你理解这件事要做什么、现在到哪了、下一步做什么",不确定的先 `trajectory_search` 回查、查不回来的直接问人。形态是 `plugin` notice(`form: "notice"` + 一句给人看的 `summary`)——"这句话是谁说的"是声明出来的,不靠正文猜;它不注册工具,工具表一个字节都不涨。一次压缩只对一次账,子会话跳过;默认开,`config.reconcile: false` 关、`config.reconcile.sentence` 换句子(写法见 [插件 README](plugin/trajectory-tools/README.md))。

**2. 常驻「分析」标签(Web GUI)** —— 在「对话 | 轨迹」旁边的第三个标签,渲染 **runtime incident view**:

| 元素 | 说明 |
|---|---|
| Incident 卡片 | `Event / Cause / Runtime 知道 / Model 知道 / Harness 反应 / 影响`,带证据 `seq` 可点跳轨迹 |
| Turn 地图 | 一格一个 turn;红 = 该 turn 有失败(可点),灰 = 正常 |
| 机械层事实 | 确定性数字 + 明确标注"需 host"的项 |
| 开放解读 | 折叠区;**展开时**由 analysis skill 基于 incident 证据生成,每条带 `(session, seq)` 引用 |

**Host 路由** —— `GET /analysis-view/digest?session=<id>` 返回确定性 incidents(同参重复 / 失败 / 空转 turn);`GET /analysis-view/interpret?session=<id>` 在展开「开放解读」时才调用一次模型,返回带引用的解读。两者都带 **`log` 身份**(`id` / `events` / `seq` 范围);引用格式为 `(session, seq@logId)`,避免跨日志修订误引。

**机械分析器** —— `turns / tools / errors / retry / incidents / cost` 六个确定性 fold:同参重复、调用失败、空转 turn 由代码判定,不由模型判断;token 与 cache 效率直接 fold `assistant/message.usage`,不新增埋点;每个分析器自带 `summary(facts)`,runner 直接渲染表格(漏写显示 `(no summary)`,不会静默留空);`analyzers/self-test.mjs` 把语义与这个契约一起钉进测试。

**报告** —— `analyzers/run-digest.mjs` 把一次会话变成可复现的 `*.facts.json` + `*.digest.md`(表格每行由对应分析器自己的 `summary` 产出,加分析器不必再改 runner)。

**形状只有一份声明** —— `incidents` 这条事实的十个字段声明在 `plugin/analysis-view/lib/incident-shape.js`(住在包里,由 `analyzers/` 反过来 import;运行期 import 不到仓库脚本),记录只能经 `incident()` 造出来:缺字段、多字段、类型不符、`seqs` 写成 chip 形态都当场抛。`analyzers/shape-law.mjs` 把这条性质钉成法则:认领(探测器找到的每个载体都要在声明里挂角色与形态,漏一个就是错)、漂移(自己写字面量的客户端半边按键按序比对)、差分(与冻结基准逐字节相同)、证人(历史产物只读校验)。`--mutate` 用 13 种合理错法证明法则会咬。

**3. 两份 Skill** —— `trajectory-query`(随查询插件注册为 runtime skill):先查再答、逐字引用、引用写 `(session, seq@logId)`、空结果就是可验证的"没有";`analysis.md`:把研究问题变成可核验分析(证据纪律、维度发现、分析器契约),规定入口,不规定结论。

## 怎么用

```text
# 1. 让 Agent 自己查(装好插件后,模型在对话里直接调)
search(view="sessions")                                # 先看有哪些会话可查
search(view="events", query="<字面词>")                # 命中带 seq / logId / matchAt
read(session=<id>, seq=<命中 seq>)                     # 逐字上下文
graph(session=<id>, seq=<命中 seq>)                    # 引用 / 替换 / 派生链
search(view="cost", session=<id>)                      # token 与 cache 效率

# 2. 人看分析面板:Web GUI 的「分析」标签(当前会话)
#   或直接取 host 路由:
curl "http://127.0.0.1:3080/analysis-view/digest?session=<id>"

# 3. 离线分析器(不需要 DSH)
node analyzers/run-digest.mjs <session.v3.jsonl.zstd>   # 迁移后的会话:取 v3,别读同目录里的 v2 旧副本
node analyzers/self-test.mjs
```

## 目录

- `plugin/trajectory-tools/` —— host 插件:三个只读入口(search/read/graph)+ 自带 runtime skill
- `plugin/analysis-view/` —— 常驻「分析」标签(客户端 + host 路由)
- `analyzers/` —— 确定性分析器、digest 运行器、自检
- `skill/` —— `trajectory-query.md`(查询纪律)、`analysis.md`(分析方法)
- `docs/` —— 设计说明与实验协议
- `experiments/` —— 语料、探针、manifest、生成的报告

## 安装(两个常驻插件)

```text
pnpm pack                                  # 在各自的 plugin 目录里执行
# ~/.dsh/profiles/web/package.json:
#   dependencies: 增加
#     "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.3.1.tgz"
#     "dsh-analysis-view":    "file:<绝对路径>/dsh-analysis-view-0.1.3.tgz"
#   dsh.profile.bundles: 追加 "dsh-trajectory-tools"、"dsh-analysis-view"
pnpm install            # 在 ~/.dsh/profiles/web
# 重启 dsh web(host 插件不会可靠热更新)
```

## 验证

```text
cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs   # ALL PASS (175 checks)
node analyzers/self-test.mjs        # 分析器语义
node analyzers/host-self-test.mjs   # host 侧 incident 判定
node analyzers/shape-law.mjs        # incident 形状:认领 / 漂移 / 差分 / 证人
node analyzers/shape-law.mjs --mutate   # 13 种合理错法,逃走必须为 0
```

装好后重启 `dsh web`,确认:模型工具表里出现 `trajectory_search` / `trajectory_read` / `trajectory_graph` 三个入口(不再是六个)、skill 目录里出现 `trajectory-query`、`search(view="events")` 的返回里带 `matchAt` / `filtered` / `normalized`、`graph` 的关系链是 `{count, head, tail}` 形态、`/analysis-view/digest` 对已结算会话返回 200。压缩后对账要等**真的发生一次压缩**才能看到(想马上看就在会话里 `/compact`,再随便回一句话):那一轮收尾时多一句模型回复,host 日志里同时多一行 `compaction reconcile`。

## 已知缺口

- 面板的 incident 来自 host 路由 `/analysis-view/digest`(同参重复、空转 turn、Harness 反应由 host 判定);面板自身只渲染证据。
- `Harness 反应` 由错误码推导(guard 已拦截 / 无 guard 需模型自纠),不是模板文案。
- host 分析与 `analyzers/incidents.mjs` 是两份实现(运行时无法 import 仓库脚本),语义分别由 `analyzers/host-self-test.mjs`、`analyzers/self-test.mjs` 钉住。
- 会话经 `sessionQuery.observeSession(id)` 读取(DSH 0.1.6 起 `snapshotEvents` 等同步读取已弃用;兼容退路依次是内存快照 → `sessionPersistence.open(id, 'read')` → 旧版 `inspect()`)。
- `seq` 只在同一份日志修订内稳定,所以引用必须带 `logId`;跨版本重写过的日志,旧 `seq` 可能指向别的事件。
- 查询工具是 host 插件:装好后必须重启 `dsh web` 才会出现在模型工具表里;若同名工具已被别的插件注册,插件会显式报错而不是静默注册一半。契约由 `plugin/trajectory-tools/self-test.mjs`(175 项)钉住。
- 压缩后对账只在 `compaction/end` 成功、且这一轮走到收尾点时说话:失败的压缩(投影没换)与子代理会话都跳过;注入本身失败不打断这一轮,只在 host 日志里留一行 `warn`。「是否该对账」由记号(会话级、一次压缩一个)判定,不由模型猜。
- 不给 `session` 时,`view="events"` 的默认扫描集是「当前会话 + 所有 live 会话 + 最近若干已持久化会话」;已持久化会话按 `createdAt` 排序(没有便宜的"最近活动"信号),很久以前的会话请显式传 session。
- `trajectory_graph` 是三个入口里唯一依赖 `ctx.sessionQuery` 的;search / read 只依赖 `sessions` / `sessionPersistence`。
- 面向 DSH 0.1.6-alpha.1 核对过全部用到的 host/客户端 API:`defineTool` 参数 DSL、`sessionQuery` 方法表、`SessionHandle`、`skills.register`、`webServer.register`、`llm.stream`、`conversation.view` slot 与 `uiConversation.views/binding` 均未变;唯一需要迁移的就是上面那条同步读取弃用。
- 运行环境:DSH 0.1.6-alpha.2,插件 0.3.1 / 0.1.3。三个入口的工具表占用约 1.8 KB(合并成三个之前是 5.7 KB);契约由自检(175 项)与真实语料离线核对覆盖,实机对照见上面「验证」。
- `trajectory_search(view="cost")` 只读 `assistant/message.usage`,不新增埋点:适配器没上报 usage 的请求记 `unknown`(不是 0),单字段缺失记 `null` 且不进求和。DeepSeek 适配器基本不报 `cacheWriteTokens`,那是"没上报",不是"没写缓存";
- 陷阱:会话格式迁移后,同一个会话目录里**同时留着 `session.v3.jsonl.zstd`(当前)与 `session.v2.jsonl.zstd`(迁移前旧副本)**。手动跑分析器要取 v3,否则会把旧副本当成"最近的会话"。`experiments/corpus/scan-sessions.mjs` 已按目录取版本号最高的一份。

## 许可证

MIT © 2026 goatliamia —— 见 [LICENSE](./LICENSE)
