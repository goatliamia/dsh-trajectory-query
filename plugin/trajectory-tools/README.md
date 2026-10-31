# dsh-trajectory-tools

Model-facing, read-only tools over the session event log that DSH already keeps.
把 DSH 已经保存的会话事件日志变成**模型可查的事实源**(只读)。

除 `trajectory-query` 外，插件注册 `trace-analysis`（过程诊断）和 `context-profile`（上下文与工具配置剖面）。0.6.0 将细分方法放入 skill 引用资源，以 DSH runtime skill 的元数据注册；报告由模型撰写。

English | [中文](#中文)

---

## English

### What it does

Read stored history, retrieve original records, inspect relationships, and collect diagnostic evidence for a DSH session.

### Tools

Four entries, split by the question rather than by data source. `view` is required on
`trajectory_search` so a call never has to guess what you meant.

| Tool | Question it answers |
|---|---|
| `trajectory_search` | what is there / where was it said / how much did it cost. `view`: `events` literal hits with a snippet centred on the match · `catalog` per-session counts and seq/time ranges, no content · `cost` recorded reply usage and cache efficiency · `sessions` which sessions are queryable |
| `trajectory_read` | give me the verbatim text of this `(session, seq range)` |
| `trajectory_graph` | how are these related: event replacement / source / derived chain, or session lineage |
| `trajectory_inspect` | collect official runtime statistics, representative evidence and ready-to-call original-record pointers; views: overview, latency, cost, repeats, io, context |

Optional narrowing sits in one `filter` object whose keys depend on the view
(`events`: types, from, to, timeFrom, timeTo, sessionCount, normalize, excludeInjected, excludeSelf;
`catalog`: cwd, timeFrom, timeTo, type, tool, breakdown; `cost`: from, to, groupBy; `sessions`: liveOnly). Pass a
key the view does not accept and the error names the keys that view does accept.

`trajectory_read` and `trajectory_graph` declare `isConcurrencySafe`, so one step may run several of
them in parallel; `trajectory_search` stays exclusive because its default scan reads several sessions.

`view="events"` pages with `offset` and returns `nextOffset` (`null` on the last page).
`view="sessions"` carries each session's title when the host can fold one.
`trajectory_read` takes `format: "json"` for the complete event objects — envelopes, sources and
stream records included — and still returns the same `log` identity, so `(session, seq@logId)`
citations keep working.

### Connected and full-body reads

Use `trajectory_read({session,seq,format:"linked",snapshot})` to read a bounded set of connected calls, statuses, formal results and subsequent messages. Copy `body`, `more` or `nextRead` to retrieve details. `field:"data.arguments"` reads one event field; `offset` continues in 12,000-character pages. Text and JSON window reads remain available.

### Results

Results include original text and `(session, seq@logId)` pointers. The tools are read-only. Missing records or unavailable statistics are reported explicitly.

### Default scope and filtering

Without `session`, `view="events"` scans **the current session + every live session + a few
persisted sessions** (persisted sessions are ranked by `createdAt` — there is no cheap "last
activity" signal for them). The current session is resolved from the tool execution context, so a
long session whose `createdAt` is ancient is still searched.

Two filters are on by default, because the naive result set is mostly noise:

- `filter.excludeInjected` — drops injected boilerplate (the `<system-reminder>` workspace instructions)
  and machine-injected plugin notices (`source.kind === "plugin"`: the model-switch notice, this
  plugin's own reconcile request). A plugin notice is not something the human said.
- `filter.excludeSelf` — drops `trajectory_*`'s own calls and results, so searching for a word does not
  return the search itself.

Both can be turned off; the response reports `filtered: { injected, self }` either way. `cost` ignores
both on purpose: accounting counts everything.

Matching is also normalized by default (`filter.normalize: false` turns it off): runs of backslashes
collapse and ASCII/typographic quotes are interchangeable, so a query written the human way
(`C:\Users\14100\.dsh`) finds the escaped form in the log (`C:\\Users\\14100\\.dsh`). Only matching
is normalized — quoted evidence stays verbatim — and the response reports `normalized`.

### Cost

`view="cost"` folds append-origin `assistant/message.usage` records — no new instrumentation. The numbers only; whether
the spend was worth it stays the model's interpretation.

- `input` is uncached input; `cacheRead` is cache-read input. A cache miss alone does not establish
  that the prefix changed: investigate the request/model history before assigning a cause.
- A request whose adapter reported no usage is `unknown`, never zero; a single missing field is
  `null` and stays out of the sums. `coverage` says how many requests reported each field — on the
  DeepSeek adapter `cacheWriteTokens` is usually absent, which means "not reported", not "no cache".

### Inspection

`trajectory_inspect` accepts:

| Parameter | Usage |
|---|---|
| `view` | `overview` (default), `latency`, `cost`, `repeats`, `io`, `context` |
| `session` | Session ID; defaults to the current session |
| `turns` | Inclusive `{from,to}`; may change while reusing a snapshot |
| `focus` | `{tool: exactName}` or `{file: exactReturnedPath}` |
| `groupBy` | overview: turn/tool/file; latency/cost: turn; io: tool/file |
| `sort` | Time or a supported metric; see the tool parameter description |
| `limit` | 1–10 entries; overview defaults to 6, other views to 3 |
| `snapshot` | Reuse a returned snapshot across queries |
| `cursor` | Copy `nextCursor` to continue the same view |

Results contain statistics, evidence excerpts and ready-to-call `trajectory_read` arguments.
The cost view includes large tool declarations and declarations not called in the selected scope.
Estimates are labeled separately from reported usage; missing ownership or historical data stays unknown.
If a snapshot expires, start a new inspection.



### Prompt entries

```js
import { ENTRY_PROMPTS } from 'dsh-trajectory-tools/prompts';
const processPrompt = ENTRY_PROMPTS.process;
const profilePrompt = ENTRY_PROMPTS.profile;
```

Choose one entry and supply the target session and question. These entries request the corresponding skill. Analysis methods live in the bundled skill resources; inspection results contain evidence only.

### Bundled skill

The plugin registers `trajectory-query` for historical fact checks, `trace-analysis` for question-specific diagnosis, and `context-profile` for the current context and capability configuration. Runtime skills load their packaged resources through `lib/skill.js` and declare a directory base for relative references.

### Optional: reconcile after compaction

Enabled by default. After a successful compaction, the model is asked at the end of the turn to briefly
state its current understanding and next action. Failed compactions and subagent sessions are skipped.
This may add a model step after compaction.

#### Turning it on and off

It is **on by default** and uses the built-in prompt when no override is supplied.

| Config (on the plugin's loader row) | Default | Effect |
|---|---|---|
| *(absent)* | — | enabled, built-in sentence |
| `reconcile: false` | — | disabled |
| `reconcile.enabled` | `true` | `false` disables while keeping your own `sentence` written down |
| `reconcile.sentence` | built-in | replaces the injected text |

The plugin's own `cordis.patch.yml` already inserts the row, so options go in the **profile's** patch
file as an override **by id** — writing a second `insert:` there fails boot with
`duplicate loader entry id`. In `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
# turn it off
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile: false

# or keep it, with your own sentence
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile:
      sentence: 上下文被压缩过,先用两行说明你理解的任务和下一步,不确定的用 trajectory_search 回查。
```

**Restart `dsh web`** after changing these options.

#### Seeing it work

It only speaks when a compaction actually happened, so silence is the normal case. To see it today,
do not wait for real pressure: run `/compact` in a session, then send any short message — that turn's
reply should end with the two lines, and the host log gains one `compaction reconcile` line.

### Install (permanent, not a dynamic plugin)

```text
1. pnpm pack                      # -> dsh-trajectory-tools-0.6.0.tgz
2. in ~/.dsh/profiles/web/package.json:
     dependencies:  "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.6.0.tgz"
     dsh.profile.bundles: append "dsh-trajectory-tools"
3. pnpm install                   # in ~/.dsh/profiles/web
4. restart `dsh web`              # host plugins do not hot-reload reliably
```

Use a new package version and tarball path when updating, then run `pnpm install` and restart DSH.

Options are set on the loader row (the plugin's own `cordis.patch.yml` inserts it, so add a **config
override by id** in `~/.dsh/profiles/web/cordis.patch.yml` — never a second `insert:`):

```yaml
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile:
      sentence: 上下文被压缩过,先说一句你保留的理解,不确定的用 trajectory_search 回查。
```



### Verify

```text
node self-test.mjs                                       # from the installed package dir -> ALL PASS
node inspect-test.mjs                                    # diagnostic query checks
node diagnosis-test.mjs                                  # scope, connected reads and body continuation
trajectory_search(view="sessions")                       # which sessions are queryable
trajectory_search(view="catalog", session=<id>)          # counts + ranges, no content
trajectory_search(view="events", query="<literal>")      # hits with matchAt + logId
trajectory_read(session=<id>, seq=<hit seq>)             # verbatim context
trajectory_graph(session=<id>, seq=<hit seq>)            # bounded chain
trajectory_search(view="cost", session=<id>)             # tokens + cache efficiency
```

---

<a id="中文"></a>
## 中文

### 功能

查询历史、读取原始记录、查看关系链，并为当前会话收集诊断证据。

### 工具

按**问题**分四个入口。`trajectory_search` 的 `view` 必填。

| 工具 | 回答什么 |
|---|---|
| `trajectory_search` | 有什么 / 在哪说过 / 花了多少。`view`:`events` 字面命中 + 以命中点为中心的片段 · `catalog` 会话级计数与 seq/时间范围(不含正文) · `cost` 逐请求 token 与 cache 效率 · `sessions` 哪些会话可查 |
| `trajectory_read` | 把 `(session, seq 区间)` 的原文逐字给我 |
| `trajectory_graph` | 这些东西什么关系:事件替换 / 引用 / 派生链,或会话谱系 |
| `trajectory_inspect` | 诊断取证：总览、耗时、消耗与工具定义、重复候选、工具文件、上下文变化；返回关联原文与可继续读取的参数 |

可选维度收在一个 `filter` 对象里,键按 view 不同
(`events`:types, from, to, timeFrom, timeTo, sessionCount, normalize, excludeInjected, excludeSelf;
`catalog`:cwd, timeFrom, timeTo, type, tool, breakdown;`cost`:from, to, groupBy;`sessions`:liveOnly)。
传了这个 view 不认的键,错误会告诉你它认哪些。

`trajectory_read` 与 `trajectory_graph` 声明了 `isConcurrencySafe`,同一步里可以并行跑多个;
`trajectory_search` 保持独占——它的默认扫描要读多份会话。

### 返回结果

结果带逐字原文与 `(session, seq@logId)` 指针。工具只读；记录缺失或统计不可用会明确说明。

### 默认范围与过滤

不给 `session` 时,`view="events"` 扫描 **当前会话 + 所有 live 会话 + 最近若干已持久化会话**
(已持久化会话按 `createdAt` 排序——它们没有便宜的"最近活动"信号)。当前会话取自工具执行上下文,
所以一个 `createdAt` 很老的长会话依然会被搜到。

两个过滤器默认开启,因为不过滤的结果集大半是噪声:

- `filter.excludeInjected` — 丢掉注入样板(`<system-reminder>` 的 workspace 指令)与机器注入的
  plugin notice(`source.kind === "plugin"`:模型切换提示、本插件自己的对账请求)。plugin notice 不是人说的话。
- `filter.excludeSelf` — 丢掉 `trajectory_*` 自己的调用与结果,避免"查什么就命中这次查询本身"。

两者都可关闭;无论开关,返回里都带 `filtered: { injected, self }`。`cost` 刻意两个都不用:记账要记全量。

匹配默认归一化(`filter.normalize: false` 可关):连续反斜杠折叠为一个、中英文引号互认 —— 用人类习惯写的
`C:\Users\14100\.dsh` 能查到日志里转义过的 `C:\\Users\\14100\\.dsh`。归一化只作用于匹配,
引文仍是原文 verbatim,返回里带 `normalized`。

### 成本

`view="cost"` 只 fold `assistant/message.usage`,不新增埋点;只给数字,"这次花得值不值"仍是模型的解释。

- `input` 是未缓存输入，`cacheRead` 是缓存读取。未命中本身不能证明前缀被改写，也不等于本次新增内容。
- usage 整个缺失的请求记 `unknown`,不按 0;单字段缺失记 `null`,不进求和。`coverage` 说明每个字段有多少请求报了 —— DeepSeek 适配器基本不报 `cacheWriteTokens`,那是"没上报",不是"没写缓存"。

### 诊断查询

`trajectory_inspect` 支持：

| 参数 | 用法 |
|---|---|
| `view` | `overview` 总览（默认）、`latency` 耗时、`cost` 消耗与工具定义、`repeats` 重复候选、`io` 工具文件、`context` 上下文 |
| `session` | 会话 ID，省略为当前会话 |
| `turns` | 轮次闭区间 `{from,to}`；沿用 snapshot 时可更换范围 |
| `focus` | `{tool:精确工具名}` 或 `{file:返回过的完整路径}` |
| `groupBy` | overview 支持 turn/tool/file；latency、cost 支持 turn；io 支持 tool/file |
| `sort` | 时间或该主题支持的指标，具体取值见工具参数说明 |
| `limit` | 每页 1–10 项；overview 默认 6，其余默认 3 |
| `snapshot` | 沿用返回的快照，继续查询 |
| `cursor` | 照抄 `nextCursor`，继续同一主题 |

结果包含统计、证据片段和可直接调用的 `trajectory_read` 参数。
成本主题还提供大工具定义和选定范围内未调用的定义。估算与实测 usage 分别标注；
缺失的插件归属或历史记录保持未知。快照过期后重新发起查询。

关联阅读使用 `trajectory_read({session,seq,format:"linked",snapshot})`，返回调用、状态、正式结果及后续消息。
照抄 `body`、`more` 或 `nextRead` 可继续读取正文。`field:"data.arguments"` 按 seq 读取一个字段，
每页 12,000 字符，`offset` 续读；text/json 区间读取继续可用。


### 提示词入口

```js
import { ENTRY_PROMPTS } from 'dsh-trajectory-tools/prompts';
```

`process` 用于过程诊断，`profile` 用于静态剖面；选择一个入口，另附会话和用户问题。
入口请求使用对应的 skill，分析方法保存在随包的引用资源中。实时作用域工具/SDK 完整快照尚未接入；静态入口使用已确认的构成及历史证据。

### 自带 skill

插件注册历史查证 `trajectory-query`、按问题诊断 `trace-analysis` 和静态剖面 `context-profile`。`lib/skill.js` 加载随包正文，并为方法引用声明目录基址。

### 可选功能：压缩后对账

默认开启。成功压缩后，在当轮收尾时请模型简要说明当前理解和下一步；
失败的压缩与子代理会话跳过。发生压缩后可能额外增加一个模型步骤。

#### 怎么开、怎么关

默认开启；未自定义正文时使用内置提示。

| 配置(写在插件的 loader 行上) | 默认 | 作用 |
|---|---|---|
| *(不写)* | — | 开启,用内置提示 |
| `reconcile: false` | — | 关闭 |
| `reconcile.enabled` | `true` | 填 `false` 可以"先关掉、但把自己那句话留着" |
| `reconcile.sentence` | 内置那句 | 换掉注入的正文 |

插件自带的 `cordis.patch.yml` 已经插入了这一行,所以配置写在**profile 的** patch 文件里,写成**按 id 的覆盖行** —— 在那里再写一次 `insert:` 会在启动时报 `duplicate loader entry id`。也就是 `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
# 关掉
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile: false

# 或者留着,换成你自己的说法
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile:
      sentence: 上下文被压缩过,先用两行说明你理解的任务和下一步,不确定的用 trajectory_search 回查。
```

更改这些选项后，**重启 `dsh web`** 生效。

#### 怎么确认它在工作

只有真的发生过压缩它才说话,所以平时沉默是正常的。想马上看到,不用等真的压满:在会话里 `/compact`,然后随便回一句话 —— 那一轮的回复结尾应该多出那两行,host 日志里同时多一行 `compaction reconcile`。

### 安装(常驻,非动态插件)

```text
1. pnpm pack                      # 生成 dsh-trajectory-tools-0.6.0.tgz
2. 在 ~/.dsh/profiles/web/package.json 中:
     dependencies 增加 "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.6.0.tgz"
     dsh.profile.bundles 追加 "dsh-trajectory-tools"
3. 在 ~/.dsh/profiles/web 下执行 pnpm install
4. 重载/重启 `dsh web`             # host 插件不会可靠热更新
```

更新时使用新的包版本和 tgz 路径，再执行 `pnpm install` 并重启 DSH。



### 验证

```text
node self-test.mjs                                       # 在安装后的包目录里运行 → ALL PASS
node inspect-test.mjs                                    # 诊断查询自检
trajectory_search(view="sessions")                       # 哪些会话可查
trajectory_search(view="catalog", session=<id>)          # 计数与范围,不含正文
trajectory_search(view="events", query="<字面词>")       # 命中带 matchAt 与 logId
trajectory_read(session=<id>, seq=<命中 seq>)            # 逐字上下文
trajectory_graph(session=<id>, seq=<命中 seq>)           # 有界关系链
trajectory_search(view="cost", session=<id>)             # token 与 cache 效率
```

开发文档：[查询与诊断取证](https://github.com/goatliamia/trajectory-tree/blob/main/docs/trajectory-tools-design.md)。
