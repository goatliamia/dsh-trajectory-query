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
trajectory_find(session="session-e0636aa9-…", query="FS_NOT_OBSERVED", types=["tool/result"])
→ seq=1248  tool/result  FsError:FS_NOT_OBSERVED
  log=2981dc3bba29

trajectory_window(session="session-e0636aa9-…", seq=1248)
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

**1. 历史查询工具(给 Agent)** —— 常驻 host 插件 `dsh-trajectory-tools`:注册 `trajectory_sessions / find / window / trace` 四个只读工具,直接读 DSH 已有的事件日志(存活会话走内存快照,已结算会话走 `sessionPersistence` 句柄),不依赖 `ctx.sessionQuery`。证据优先:每个答案带 `(session, seq@logId)`、原样引用原文,片段以命中点为中心;查询返回空 = 可核验的"没有这样的事实"。不给 `session` 时默认搜「当前会话 + 所有 live 会话」,并默认丢掉注入样板与工具自己的调用(`excludeInjected` / `excludeSelf`),不会"查什么就命中这次查询"。

**2. 常驻「分析」标签(Web GUI)** —— 在「对话 | 轨迹」旁边的第三个标签,渲染 **runtime incident view**:

| 元素 | 说明 |
|---|---|
| Incident 卡片 | `Event / Cause / Runtime 知道 / Model 知道 / Harness 反应 / 影响`,带证据 `seq` 可点跳轨迹 |
| Turn 地图 | 一格一个 turn;红 = 该 turn 有失败(可点),灰 = 正常 |
| 机械层事实 | 确定性数字 + 明确标注"需 host"的项 |
| 开放解读 | 折叠区;**展开时**由 analysis skill 基于 incident 证据生成,每条带 `(session, seq)` 引用 |

**Host 路由** —— `GET /analysis-view/digest?session=<id>` 返回确定性 incidents(同参重复 / 失败 / 空转 turn);`GET /analysis-view/interpret?session=<id>` 在展开「开放解读」时才调用一次模型,返回带引用的解读。两者都带 **`log` 身份**(`id` / `events` / `seq` 范围);引用格式为 `(session, seq@logId)`,避免跨日志修订误引。

**机械分析器** —— `turns / tools / errors / retry / incidents` 五个确定性 fold:同参重复、调用失败、空转 turn 由代码判定,不由模型判断;`analyzers/self-test.mjs` 把语义钉进测试。

**报告** —— `analyzers/run-digest.mjs` 把一次会话变成可复现的 `*.facts.json` + `*.digest.md`。

**3. 两份 Skill** —— `trajectory-query`(随查询插件注册为 runtime skill):先查再答、逐字引用、引用写 `(session, seq@logId)`、空结果就是可验证的"没有";`analysis.md`:把研究问题变成可核验分析(证据纪律、维度发现、分析器契约),规定入口,不规定结论。

## 怎么用

```text
# 1. 让 Agent 自己查(装好插件后,模型在对话里直接调)
trajectory_sessions(limit=10)                          # 先拿 session id
trajectory_find(session=<id>, query="<字面词>")         # 命中带 seq 与 logId
trajectory_window(session=<id>, seq=<命中 seq>)         # 逐字上下文
trajectory_trace(session=<id>, seq=<命中 seq>)          # 引用 / 替换 / 派生链

# 2. 人看分析面板:Web GUI 的「分析」标签(当前会话)
#   或直接取 host 路由:
curl "http://127.0.0.1:3080/analysis-view/digest?session=<id>"

# 3. 离线分析器(不需要 DSH)
node analyzers/run-digest.mjs <session.jsonl.zstd>
node analyzers/self-test.mjs
```

## 目录

- `plugin/trajectory-tools/` —— host 插件:四个只读查询工具 + 自带 runtime skill
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
#     "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.1.4.tgz"
#     "dsh-analysis-view":    "file:<绝对路径>/dsh-analysis-view-0.1.0.tgz"
#   dsh.profile.bundles: 追加 "dsh-trajectory-tools"、"dsh-analysis-view"
pnpm install            # 在 ~/.dsh/profiles/web
# 重启 dsh web(host 插件不会可靠热更新)
```

## 验证

```text
cd ~/.dsh/profiles/web/node_modules/dsh-trajectory-tools && node self-test.mjs   # ALL PASS (75 checks)
node analyzers/self-test.mjs        # 分析器语义
node analyzers/host-self-test.mjs   # host 侧 incident 判定
```

装好后重启 `dsh web`,确认:模型工具表里出现 `trajectory_*`、skill 目录里出现 `trajectory-query`、`trajectory_find` 的返回里带 `matchAt` 与 `filtered`(0.1.4 起的标志)、`/analysis-view/digest` 对已结算会话返回 200。

## 已知缺口

- 面板的 incident 来自 host 路由 `/analysis-view/digest`(同参重复、空转 turn、Harness 反应由 host 判定);面板自身只渲染证据。
- `Harness 反应` 由错误码推导(guard 已拦截 / 无 guard 需模型自纠),不是模板文案。
- host 分析与 `analyzers/incidents.mjs` 是两份实现(运行时无法 import 仓库脚本),语义分别由 `analyzers/host-self-test.mjs`、`analyzers/self-test.mjs` 钉住。
- 已结算会话经 `sessionPersistence.open(id, 'read')` 读取(DSH v0.1.3 起;旧版 `inspect()` 仍兜底)。
- `seq` 只在同一份日志修订内稳定,所以引用必须带 `logId`;跨版本重写过的日志,旧 `seq` 可能指向别的事件。
- 查询工具是 host 插件:装好后必须重启 `dsh web` 才会出现在模型工具表里;若同名工具已被别的插件注册,插件会显式报错而不是静默注册一半。契约由 `plugin/trajectory-tools/self-test.mjs`(75 项)钉住。
- 不给 `session` 时,`find` 的默认扫描集是「当前会话 + 所有 live 会话 + 最近若干已持久化会话」;已持久化会话按 `createdAt` 排序(没有便宜的"最近活动"信号),很久以前的会话请显式传 session。
- `trajectory_trace` 是四个工具里唯一仍依赖 `ctx.sessionQuery` 的;其余三个只依赖 `sessions` / `sessionPersistence`。

## 许可证

MIT © 2026 goatliamia —— 见 [LICENSE](./LICENSE)
