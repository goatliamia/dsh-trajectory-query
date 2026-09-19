# dsh-trajectory-tools

Model-facing, read-only tools over the session event log that DSH already keeps.
把 DSH 已经保存的会话事件日志变成**模型可查的事实源**(只读)。

English | [中文](#中文)

---

## English

### Why

DSH stores every session as an append-only event log, but a model normally only sees the projected
message history. Once content is compacted, or the thing you need happened long ago / in another
session / in a subagent, you are left guessing or asking the user to repeat themselves. These tools
read the log directly and answer with **verbatim text plus a pointer**, so the model interprets
facts instead of reconstructing them.

### Tools

Three entries, split by the question rather than by data source. `view` is required on
`trajectory_search` so a call never has to guess what you meant.

| Tool | Question it answers |
|---|---|
| `trajectory_search` | what is there / where was it said / how much did it cost. `view`: `events` literal hits with a snippet centred on the match · `catalog` per-session counts and seq/time ranges, no content · `cost` per-request tokens and cache efficiency · `sessions` which sessions are queryable |
| `trajectory_read` | give me the verbatim text of this `(session, seq range)` |
| `trajectory_graph` | how are these related: event replacement / source / derived chain, or session lineage |

Optional narrowing sits in one `filter` object whose keys depend on the view
(`events`: types, from, to, timeFrom, timeTo, sessionCount, normalize, excludeInjected, excludeSelf;
`catalog`: cwd, timeFrom, timeTo, type, tool; `cost`: from, to, groupBy; `sessions`: liveOnly). Pass a
key the view does not accept and the error names the keys that view does accept.

### Principles

1. **Read-only.** No event is written or rewritten; returned text is verbatim.
2. **Facts and interpretation stay apart.** Tools return facts and pointers; the model explains.
3. **Empty means absent.** A miss is a verifiable "it is not in the log" — not a reason to fill the gap with common sense.
4. **Citations carry a log identity.** `seq` is only stable inside one log revision, so results
   include `log.id` (append-stable hash of the first event); cite `(session, seq@logId)`.

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

`view="cost"` folds `assistant/message.usage` — no new instrumentation. The numbers only; whether
the spend was worth it stays the model's interpretation.

- `input` is the part of the context that missed the cache this request (the genuinely new tokens);
  `cacheRead` is the reused prefix. `cacheEfficiency` dropping below ~1.0 means the prefix was
  rewritten or the sequence changed.
- A request whose adapter reported no usage is `unknown`, never zero; a single missing field is
  `null` and stays out of the sums. `coverage` says how many requests reported each field — on the
  DeepSeek adapter `cacheWriteTokens` is usually absent, which means "not reported", not "no cache".

### Data source

Preferred: `ctx.sessionQuery.observeSession(id)` — the sanctioned path since DSH 0.1.6 deprecated the
synchronous Session readers (`snapshotEvents` / `eventAt` / `ownEvents`). It returns a live-preferred
immutable cut, caches cold reads, and the observation is disposed right after use.

```text
preferred → ctx.sessionQuery.observeSession(id)     live-preferred, cached, disposed after read
fallback  → ctx.sessions.get(id).snapshotEvents()   only when the deployment has no sessionQuery
fallback  → ctx.sessionPersistence.open(id,"read") → handle.read() → close()
fallback  → ctx.sessionPersistence.inspect(id)      legacy backends
```

`trajectory_graph` is the one tool that uses `sessionQuery` (`traceEvent` / `traceSession`).
A read of a non-live session uses a seq slice through the persistence handle instead of
materializing the whole log.

### Bundled skill

The plugin also registers one thin runtime skill, `trajectory-query` (`lib/skill.js`), so the
discipline travels with the tools and no agent preset has to be edited: query instead of guessing,
quote verbatim, cite `(session, seq@logId)`, treat an empty result as verifiable absence.

### Optional: reconcile after a compaction (on by default)

Compaction does not rewrite facts — it moves a span of history out of the model's view (it is
shadowed, not deleted), and the model is left with a summary it did not write. So after a **successful**
`compaction/end` this plugin leaves a per-session mark, and at the turn's stop boundary
(`agent/turn-stopping`) it injects one sentence:

> 上下文被压缩过一次,压掉的那段只剩日志里有。用不超过两行跟我说一句:你保留的理解是什么(目标/进度/下一步);不确定的先用 trajectory_search 回查,查不回来的直接问我。

The turn then runs exactly one more step: the model finishes what it was saying, and adds two lines
about what it kept — re-querying the log where it is unsure, asking the human where the log cannot
answer.

- **Why the stop boundary, not the compaction itself.** Compaction happens between steps; injecting
  there interrupts reasoning in flight. At the stop boundary the injection is data the loop re-reads,
  so it lands as its own step.
- **Once per compaction.** The mark is cleared before injecting, so the extra message is not repeated
  at every turn boundary, and a second compaction in the same turn earns a second reconcile.
- **Subagent children are skipped** (`origin: "subagent"` / `parentSession`): a child has nobody to
  report to. Failed compactions (those carrying `error`) are skipped too — the projection did not change.
- **Shape.** A `user`-role message whose source is `{ kind: "plugin", plugin: "dsh-trajectory-tools",
  form: "notice", summary: "…" }`: the model reads the body, the human reads the summary — who is
  talking is declared, not inferred from the text. It carries no tool schema, so it adds zero bytes
  to the tool table.
- **Off switch / own sentence.** `config.reconcile: false` disables it; `config.reconcile.sentence`
  replaces the sentence. Injection is wrapped in try/catch: throwing at the stop boundary would end
  the turn with `reason=error`, and this is a nicety, not a requirement.

### Install (permanent, not a dynamic plugin)

```text
1. pnpm pack                      # -> dsh-trajectory-tools-0.3.0.tgz
2. in ~/.dsh/profiles/web/package.json:
     dependencies:  "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.3.0.tgz"
     dsh.profile.bundles: append "dsh-trajectory-tools"
3. pnpm install                   # in ~/.dsh/profiles/web
4. restart `dsh web`              # host plugins do not hot-reload reliably
```

Options are set on the loader row (the plugin's own `cordis.patch.yml` inserts it, so add a **config
override by id** in `~/.dsh/profiles/web/cordis.patch.yml` — never a second `insert:`):

```yaml
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile:
      sentence: 上下文被压缩过,先说一句你保留的理解,不确定的用 trajectory_search 回查。
```

### Files

| File | Role |
|---|---|
| `lib/index.js` | host half: reads the log, registers the three tools, and wires the optional reconcile |
| `lib/skill.js` | the `trajectory-query` runtime skill body |
| `self-test.mjs` | 153 contract checks against a fake ctx + synthetic log (no real session) |
| `cordis.patch.yml` | bundle layer that inserts the plugin row |
| `package.json` | `dsh.bundle.patch` (host-only; no client half) |

### Verify

```text
node self-test.mjs                                       # from the installed package dir -> ALL PASS
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

### 为什么需要它

DSH 把每个会话都存成 append-only 事件日志,但模型平时只看到投影后的消息历史。一旦内容被
compaction 覆盖,或者事情发生在很久以前 / 别的会话 / 子代理里,就只能靠记忆或让用户复述。
这三个入口直接读日志,返回**逐字文本 + 指针**:模型解释事实,而不是凭印象重建事实。

### 工具

按**问题**分三个入口,不按数据源分。`trajectory_search` 的 `view` 必填,免得一次调用去猜你想干什么。

| 工具 | 回答什么 |
|---|---|
| `trajectory_search` | 有什么 / 在哪说过 / 花了多少。`view`:`events` 字面命中 + 以命中点为中心的片段 · `catalog` 会话级计数与 seq/时间范围(不含正文) · `cost` 逐请求 token 与 cache 效率 · `sessions` 哪些会话可查 |
| `trajectory_read` | 把 `(session, seq 区间)` 的原文逐字给我 |
| `trajectory_graph` | 这些东西什么关系:事件替换 / 引用 / 派生链,或会话谱系 |

可选维度收在一个 `filter` 对象里,键按 view 不同
(`events`:types, from, to, timeFrom, timeTo, sessionCount, normalize, excludeInjected, excludeSelf;
`catalog`:cwd, timeFrom, timeTo, type, tool;`cost`:from, to, groupBy;`sessions`:liveOnly)。
传了这个 view 不认的键,错误会告诉你它认哪些。

### 原则

1. **只读。** 不写入、不改写任何事件;返回文本逐字来自日志。
2. **事实与解释分离。** 工具给事实和指针,解释交给模型。
3. **空 = 没有。** 查不到就是"日志里确实没有",不是用常识补全的理由。
4. **引用带日志身份。** `seq` 只在同一份日志修订内稳定,所以结果里带 `log.id`(首事件的
   append-stable 哈希);引用写成 `(session, seq@logId)`。

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

- `input` 是本次**没命中缓存**的那部分上下文(真正新增的 token),`cacheRead` 是复用的前缀;`cacheEfficiency` 掉到 1.0 以下就说明前缀被改写或换了序列。
- usage 整个缺失的请求记 `unknown`,不按 0;单字段缺失记 `null`,不进求和。`coverage` 说明每个字段有多少请求报了 —— DeepSeek 适配器基本不报 `cacheWriteTokens`,那是"没上报",不是"没写缓存"。

### 数据来源

首选 `ctx.sessionQuery.observeSession(id)` —— DSH 0.1.6 起 Session 的同步读取
(`snapshotEvents` / `eventAt` / `ownEvents`)已弃用,这是官方推荐路径:返回 live 优先的不可变切片,
冷读可复用缓存,用完立即释放观察。

```text
首选   → ctx.sessionQuery.observeSession(id)     live 优先、可缓存,读完即 dispose
退路   → ctx.sessions.get(id).snapshotEvents()   仅当部署里没有 sessionQuery
退路   → ctx.sessionPersistence.open(id,"read") → handle.read() → close()
退路   → ctx.sessionPersistence.inspect(id)      旧版后端
```

`trajectory_graph` 是唯一用到 `sessionQuery`(`traceEvent` / `traceSession`)的工具。
非存活会话的读取走 persistence 句柄的切片,不整份物化。

### 自带 skill

插件同时注册一个薄的 runtime skill `trajectory-query`(`lib/skill.js`),让纪律跟着工具走、
不用改任何 agent preset:先查再答、逐字引用、引用写 `(session, seq@logId)`、空结果就是可验证的"没有"。

### 可选功能:压缩后对账(默认开)

压缩不改写事实 —— 它只是把一段历史从模型眼前移走(shadow,不是删除),模型手上只剩一份**不是自己写的**摘要。
所以在一次**成功**的 `compaction/end` 之后,插件给这个会话留一个记号,等这一轮走到收尾点
(`agent/turn-stopping`)注入一句话:

> 上下文被压缩过一次,压掉的那段只剩日志里有。用不超过两行跟我说一句:你保留的理解是什么(目标/进度/下一步);不确定的先用 trajectory_search 回查,查不回来的直接问我。

这一轮于是多走一步:模型先把手上那句话说完,再补两行"我保留的理解是什么" —— 不确定的自己回查日志,
日志回答不了的来问人。

- **为什么挂收尾点而不是压缩点。** 压缩发生在 step 之间,那一刻注入等于插进正在进行的推理;
  收尾点的注入是 loop 会重新读的数据,自然落成单独的一步。
- **一次压缩只对一次账。** 注入前先清记号,所以不会每轮收尾都重复打扰;同一轮里第二次压缩会再对一次。
- **子会话跳过**(`origin: "subagent"` / `parentSession`):子代理没有"跟我说一句"的对象。
  失败的压缩(带 `error` 字段)也跳过 —— 投影没换,模型眼前的上下文没变。
- **形态。** 一条 `user` 角色消息,来源是 `{ kind: "plugin", plugin: "dsh-trajectory-tools",
  form: "notice", summary: "…" }`:模型读正文,人读 summary —— "这句话是谁说的"是声明出来的,不靠正文猜。
  它不带任何工具 schema,所以工具表一个字节都不涨。
- **关掉 / 换句子。** `config.reconcile: false` 关掉;`config.reconcile.sentence` 换掉那句话。
  注入整体包在 try/catch 里:收尾点抛错会让这一轮以 `reason=error` 收场,而这是锦上添花,不是必需品。

### 安装(常驻,非动态插件)

```text
1. pnpm pack                      # 生成 dsh-trajectory-tools-0.3.0.tgz
2. 在 ~/.dsh/profiles/web/package.json 中:
     dependencies 增加 "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.3.0.tgz"
     dsh.profile.bundles 追加 "dsh-trajectory-tools"
3. 在 ~/.dsh/profiles/web 下执行 pnpm install
4. 重载/重启 `dsh web`             # host 插件不会可靠热更新
```

配置写在 loader 行上(插件自带的 `cordis.patch.yml` 已经插入这一行,所以要在
`~/.dsh/profiles/web/cordis.patch.yml` 里写一条**按 id 的 config 覆盖行**,不能再写一次 `insert:`):

```yaml
- id: dsh-trajectory-tools
  name: dsh-trajectory-tools
  config:
    reconcile:
      sentence: 上下文被压缩过,先说一句你保留的理解,不确定的用 trajectory_search 回查。
```

### 文件

| 文件 | 作用 |
|---|---|
| `lib/index.js` | host 半边:读日志、注册三个入口,并挂上可选的对账 |
| `lib/skill.js` | `trajectory-query` runtime skill 正文 |
| `self-test.mjs` | 153 项契约检查(假 ctx + 合成日志,不连真实会话) |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `package.json` | `dsh.bundle.patch`(纯 host,无客户端半边) |

### 验证

```text
node self-test.mjs                                       # 在安装后的包目录里运行 → ALL PASS
trajectory_search(view="sessions")                       # 哪些会话可查
trajectory_search(view="catalog", session=<id>)          # 计数与范围,不含正文
trajectory_search(view="events", query="<字面词>")       # 命中带 matchAt 与 logId
trajectory_read(session=<id>, seq=<命中 seq>)            # 逐字上下文
trajectory_graph(session=<id>, seq=<命中 seq>)           # 有界关系链
trajectory_search(view="cost", session=<id>)             # token 与 cache 效率
```
