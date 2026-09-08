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
| `trajectory_sessions` | queryable sessions (live + persisted): id, createdAt, cwd, parent, preset |
| `trajectory_find` | literal substring search over events → `(session, seq, type, time)` + verbatim snippet |
| `trajectory_window` | verbatim window by `(session, seq range)`, max 60 events |
| `trajectory_trace` | event replacement / source / derived chain, or session lineage |

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
1. pnpm pack                      # -> dsh-trajectory-tools-0.1.3.tgz
2. in ~/.dsh/profiles/web/package.json:
     dependencies:  "dsh-trajectory-tools": "file:<abs path>/dsh-trajectory-tools-0.1.3.tgz"
     dsh.profile.bundles: append "dsh-trajectory-tools"
3. pnpm install                   # in ~/.dsh/profiles/web
4. reload/restart `dsh web`       # host plugins do not hot-reload reliably
```

### Files

| File | Role |
|---|---|
| `lib/index.js` | host half: reads the log and registers the four tools |
| `lib/skill.js` | the `trajectory-query` runtime skill body |
| `self-test.mjs` | 40 contract checks against a fake ctx + synthetic log (no real session) |
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
这四个工具直接读日志,返回**逐字文本 + 指针**:模型解释事实,而不是凭印象重建事实。

### 工具

| 工具 | 返回 |
|---|---|
| `trajectory_sessions` | 可查询的会话(存活 + 已持久化):id、创建时间、cwd、父会话、preset |
| `trajectory_find` | 事件字面量子串检索 → `(session, seq, type, time)` + 逐字片段 |
| `trajectory_window` | 按 `(session, seq 区间)` 取原文窗口,上限 60 个事件 |
| `trajectory_trace` | 事件替换 / 引用 / 派生链,或会话谱系 |

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
1. pnpm pack                      # 生成 dsh-trajectory-tools-0.1.3.tgz
2. 在 ~/.dsh/profiles/web/package.json 中:
     dependencies 增加 "dsh-trajectory-tools": "file:<绝对路径>/dsh-trajectory-tools-0.1.3.tgz"
     dsh.profile.bundles 追加 "dsh-trajectory-tools"
3. 在 ~/.dsh/profiles/web 下执行 pnpm install
4. 重载/重启 `dsh web`             # host 插件不会可靠热更新
```

### 文件

| 文件 | 作用 |
|---|---|
| `lib/index.js` | host 半边:读日志并注册四个工具 |
| `lib/skill.js` | `trajectory-query` runtime skill 正文 |
| `self-test.mjs` | 40 项契约检查(假 ctx + 合成日志,不连真实会话) |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `package.json` | `dsh.bundle.patch`(纯 host,无客户端半边) |

### 验证

```text
node self-test.mjs                                 # 在安装后的包目录里运行 → ALL PASS
trajectory_sessions(limit=5)                       # 拿到 id 与 live/persisted
trajectory_find(session=<id>, query="<字面词>")    # 命中带 seq 与 logId
trajectory_window(session=<id>, seq=<命中 seq>)    # 逐字上下文
```
