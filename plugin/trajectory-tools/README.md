# dsh-trajectory-tools

Model-facing, read-only tools over the session event log that DSH already keeps.
把 DSH 已经保存的会话事件日志变成**模型可查的事实源**(只读)。

English | [中文](#中文)

---

## English

### Why

DSH stores every session as an append-only event log, but a model normally only sees the
projected message history. Once content is compacted, or the thing you need happened long ago /
in another session / in a subagent, you are left guessing or asking the user to repeat themselves.
These tools read the log directly and answer with **verbatim text plus a pointer**, so the model
interprets facts instead of reconstructing them.

### Tools

| Tool | What it returns |
|---|---|
| `trajectory_sessions` | queryable sessions, ordered current → live → persisted: id, createdAt, cwd, parent, preset, `current` |
| `trajectory_index` | **catalog, not search**: per-session counts (`events`, `semanticEvents`, `byType`, `byTool`) plus `seqRange` / `timeRange` — no content |
| `trajectory_find` | literal substring search → `(session, seq, type, time)` + a snippet centred on the match (`matchAt`), always containing the matched text; normalization on by default |
| `trajectory_window` | verbatim window by `(session, seq range)`, max 60 events |
| `trajectory_trace` | event replacement / source / derived chain, or session lineage; chains are bounded by default (`full: true` returns the complete array) |

### Default scope, filtering, normalization

Without `session`, `trajectory_find` / `trajectory_index` scan **the current session + every live
session + a few persisted sessions** (persisted sessions are ranked by `createdAt` — there is no
cheap "last activity" signal for them). The current session is resolved from the tool execution
context, so a long session whose `createdAt` is ancient is still searched.

Two filters are on by default, because the naive result set is mostly noise:

- `excludeInjected` — drops injected boilerplate (the `<system-reminder>` workspace instructions).
- `excludeSelf` — drops `trajectory_*`'s own calls and results, so searching for a word does not
  return the search itself.

Both can be turned off; the response reports `filtered: { injected, self }` either way.

Matching is also normalized by default (`normalize: true`): runs of backslashes collapse and
ASCII/typographic quotes are interchangeable, so a query written the human way
(`C:\Users\14100\.dsh`) finds the escaped form in the log (`C:\\Users\\14100\\.dsh`). Only matching
is normalized — quoted evidence stays verbatim — and the response reports `normalized`.

### Principles

1. **Read-only.** No event is written or rewritten; returned text is verbatim.
2. **Facts and interpretation stay apart.** Tools return facts and pointers; the model explains.
3. **Empty means absent.** A miss is a verifiable "it is not in the log" — not a reason to fill the gap with common sense.
4. **Citations carry a log identity.** `seq` is only stable inside one log revision, so results
   include `log.id` (append-stable hash of the first event); cite `(session, seq@logId)`.

### Bundled skill

The plugin also registers one thin runtime skill, `trajectory-query` (`lib/skill.js`), so the
discipline travels with the tools and no agent preset has to be edited: query instead of guessing,
quote verbatim, cite `(session, seq@logId)`, and treat an empty result as verifiable absence.

### Data source

No dependency on `sessionQuery` (whose `readSession` replay-validates the whole log):

```text
live session      → ctx.sessions.get(id).snapshotEvents()
persisted session → ctx.sessionPersistence.open(id, "read") → handle.read() → close()
legacy fallback   → ctx.sessionPersistence.inspect(id)
```

`trajectory_trace` is the one tool that uses `sessionQuery` (`traceEvent` / `traceSession`).

### Install (permanent, not a dynamic plugin)

```text
1. pnpm pack                      # -> dsh-trajectory-tools-0.1.5.tgz
2. in ~/.dsh/profiles/web/package.json:
     dependencies:  "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.1.5.tgz"
     dsh.profile.bundles: append "dsh-trajectory-tools"
3. pnpm install                   # in ~/.dsh/profiles/web
4. reload/restart `dsh web`       # host plugins do not hot-reload reliably
```

### Files

| File | Role |
|---|---|
| `lib/index.js` | host half: reads the log and registers every tool |
| `lib/skill.js` | the `trajectory-query` runtime skill body |
| `self-test.mjs` | 107 contract checks against a fake ctx + synthetic log (no real session) |
| `cordis.patch.yml` | bundle layer that inserts the plugin row |
| `package.json` | `dsh.bundle.patch` (host-only; no client half) |

### Verify

```text
node self-test.mjs                                 # from the installed package dir -> ALL PASS
trajectory_sessions(limit=5)                       # ids + live/persisted
trajectory_find(session=<id>, query="<literal>")   # hits with seq + logId
trajectory_window(session=<id>, seq=<hit seq>)     # verbatim context
```

---

<a id="中文"></a>
## 中文

### 为什么需要它

DSH 把每个会话都存成 append-only 事件日志,但模型平时只看到投影后的消息历史。一旦内容被
compaction 覆盖,或者事情发生在很久以前 / 别的会话 / 子代理里,就只能靠记忆或让用户复述。
这些工具直接读日志,返回**逐字文本 + 指针**:模型解释事实,而不是凭印象重建事实。

### 工具

| 工具 | 返回 |
|---|---|
| `trajectory_sessions` | 可查询的会话,排序:当前 → live → 已持久化:id、创建时间、cwd、父会话、preset、`current` |
| `trajectory_index` | **目录,不是搜索**:每个会话的计数(`events`、`semanticEvents`、`byType`、`byTool`)与 `seqRange` / `timeRange`,不含内容 |
| `trajectory_find` | 事件字面量子串检索 → `(session, seq, type, time)` + 以命中点为中心的片段(`matchAt`),必定包含命中文本;默认归一化 |
| `trajectory_window` | 按 `(session, seq 区间)` 取原文窗口,上限 60 个事件 |
| `trajectory_trace` | 事件替换 / 引用 / 派生链,或会话谱系;关系链默认有界(`full: true` 才给完整数组) |

### 默认范围、过滤与归一化

不给 `session` 时,`trajectory_find` / `trajectory_index` 扫描 **当前会话 + 所有 live 会话 + 最近若干已持久化会话**
(已持久化会话按 `createdAt` 排序——它们没有便宜的"最近活动"信号)。当前会话取自工具执行上下文,
所以一个 `createdAt` 很老的长会话依然会被搜到。

两个过滤器默认开启,因为不过滤的结果集大半是噪声:

- `excludeInjected` — 丢掉注入样板(`<system-reminder>` 的 workspace 指令)。
- `excludeSelf` — 丢掉 `trajectory_*` 自己的调用与结果,避免"查什么就命中这次查询本身"。

两者都可关闭;无论开关,返回里都带 `filtered: { injected, self }`。

匹配默认归一化(`normalize: true`):连续反斜杠折叠为一个、中英文引号互认 —— 用人类习惯写的
`C:\Users\14100\.dsh` 能查到日志里转义过的 `C:\\Users\\14100\\.dsh`。归一化只作用于匹配,
引文仍是原文 verbatim,返回里带 `normalized`。

### 原则

1. **只读。** 不写入、不改写任何事件;返回文本逐字来自日志。
2. **事实与解释分离。** 工具给事实和指针,解释交给模型。
3. **空 = 没有。** 查不到就是"日志里确实没有",不是用常识补全的理由。
4. **引用带日志身份。** `seq` 只在同一份日志修订内稳定,所以结果里带 `log.id`(首事件的
   append-stable 哈希);引用写成 `(session, seq@logId)`。

### 自带 skill

插件同时注册一个薄的 runtime skill `trajectory-query`(`lib/skill.js`),让纪律跟着工具走、
不用改任何 agent preset:先查再答、逐字引用、引用写 `(session, seq@logId)`、空结果就是可验证的"没有"。

### 数据来源

不依赖 `sessionQuery`(`readSession` 会 replay 校验整份日志):

```text
存活会话   → ctx.sessions.get(id).snapshotEvents()
已持久化   → ctx.sessionPersistence.open(id, "read") → handle.read() → close()
旧版兜底   → ctx.sessionPersistence.inspect(id)
```

`trajectory_trace` 是唯一用到 `sessionQuery`(`traceEvent` / `traceSession`)的工具。

### 安装(常驻,非动态插件)

```text
1. pnpm pack                      # 生成 dsh-trajectory-tools-0.1.5.tgz
2. 在 ~/.dsh/profiles/web/package.json 中:
     dependencies 增加 "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.1.5.tgz"
     dsh.profile.bundles 追加 "dsh-trajectory-tools"
3. 在 ~/.dsh/profiles/web 下执行 pnpm install
4. 重载/重启 `dsh web`             # host 插件不会可靠热更新
```

### 文件

| 文件 | 作用 |
|---|---|
| `lib/index.js` | host 半边:读日志并注册全部工具 |
| `lib/skill.js` | `trajectory-query` runtime skill 正文 |
| `self-test.mjs` | 107 项契约检查(假 ctx + 合成日志,不连真实会话) |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `package.json` | `dsh.bundle.patch`(纯 host,无客户端半边) |

### 验证

```text
node self-test.mjs                                 # 在安装后的包目录里运行 → ALL PASS
trajectory_sessions(limit=5)                       # 拿到 id 与 live/persisted
trajectory_find(session=<id>, query="<字面词>")    # 命中带 seq 与 logId
trajectory_window(session=<id>, seq=<命中 seq>)    # 逐字上下文
```
