# 分析报告:session-e0636aa9(analysis skill 输出)

- 方法:analysis skill(先证后论;scope → 事实层 → 解读层;每条带 `(session, seq)`;解释≠改写)
- 数据源:host 活快照(`sessions.get(id).snapshotEvents()`)+ host digest 路由
- 生成:`/analysis-view/digest`、`/analysis-view/interpret`(均为确定性检测 + 有界证据)

## 0. 插件体检(版本更新后)

| 项 | 结果 |
|---|---|
| 文件一致性 | `lib/client.js` / `lib/index.js` / `package.json` / `cordis.patch.yml` 均 repo == installed |
| `/analysis-view/digest` | HTTP 200,353 ms |
| `/analysis-view/interpret` | HTTP 200,1,776 ms(模型 `deepseek-official/deepseek-v4.1-flash-expires-on-0910`) |
| 结论 | **健康** |

## 1. Scope

- 会话:`session-e0636aa9-e8d7-4879-9309-7b5ff232037d`
- 当前活日志:**2,470 个事件,seq 密集 0–2469,不含 `assistant/chunk`**
- 构成:66 turn/start · 411 step/start · 409 assistant/message · 387 tool/call · 386 tool/result · 85 user/message · 29 request/header

## 2. 事实层(机械,确定性)

| 事实 | 值 |
|---|---|
| turns | 66(ended 65) |
| tool calls | 387(结果 386) |
| error 事件 | **14**(5 类) |
| 空转 turn(无工具且无助手产出) | **2** |
| 工具分布(持久化 digest) | pwsh×126 · write×82 · read×33 · grep … |

## 3. Incident 判定(每条带证据 seq)

| incident | 数量 | 证据 seq |
|---|---|---|
| 调用失败 | 14 | 251, 351, 357, 1032, 1248, 1250, 1318, 1324, 1423, 1433, 1880, 1958 |
| 空转 turn | 2 | — |

逐类判定(错误种类来自事件字段 `tool/result.error`,非全文检索):

| 错误种类 | Harness 是否响应 | 判定 |
|---|---|---|
| `FsError:FS_NOT_OBSERVED` | ✅ **guard 已拦截** | 写前未读,被 fs-observation 策略拦下 |
| `WebError:WEB_BLOCKED_URL` | ✅ **guard 已拦截** | 环回/受限 URL 被 web 守卫拦下 |
| `ToolNotFoundError:UNKNOWN_TOOL` | ❌ 无 guard | 模型侧工具名错误,需自纠 |
| `WebError:WEB_PROVIDER_ERROR` | — | 外部 provider 失败(环境/网络侧),需单独定位 |
| `error`(generic) | — | 需进一步定位(见待办) |

> 结论:本会话**不存在"Harness 没接住已有事实"的 incident**;两类错误恰恰是 Harness 主动拦截,一类是模型侧笔误。

## 4. AI 解读层(analysis skill 生成,逐字)

> **发生了什么**:该会话 66 轮、382 次工具调用中,14 次返回错误,另有 2 轮既无工具调用也无产出。
> **原因**:工具调用返回了错误结果——调用未知工具 trajectory_seed_corpus、describe_image (session, seq 351) (session, seq 1032);以及在未先读取文件时编辑/覆盖 (session, seq 1248) (session, seq 1318)。
> **Harness 是否响应**:部分 guard 已拦截 FS_NOT_OBSERVED 与 WEB_BLOCKED_URL 类错误 (session, seq 1250) (session, seq 1324);ToolNotFoundError 等其余错误需模型自纠。
> **影响**:相应部分目标未达成,2 个空转轮未推进任务。

**引用校验**:它引用的 6 个 seq(351 / 1032 / 1248 / 1250 / 1318 / 1324)**全部命中 host evidence 列表**,无编造。

## 5. 关键发现:seq 空间**不跨版本/日志重写稳定**

| | 旧持久化文件(更新前) | 现活日志(更新后) |
|---|---|---|
| 事件数 | ~450,000(含 `assistant/chunk`) | 2,470(无 chunk) |
| seq | 0 – ~450,000 | 密集 0 – 2469 |
| 首个错误 seq | 72,652 | 351 |

→ **`(session, seq)` 只在同一日志修订内有效。** 版本更新 / 日志重写后,同一会话的 seq 会整体改变。

影响与建议:

1. 引用格式应附带**日志身份**:`(session, seq@revision)` 或带 log fingerprint,否则跨版本引用会指向错误位置;
2. 分析器输出应附带 log identity(事件数/首尾 seq/指纹),便于判定"这份分析基于哪一版日志";
3. 此前 Tier 1 的结论"compaction 后 seq 稳定"应修正为 **"同一修订内稳定"**——跨修订需重新解析。

## 6. 待办

- 定位 generic `error` 与 `WebError:WEB_PROVIDER_ERROR` 的具体事件(按 host seq 读取原文);
- 给引用加日志身份(见 §5);
- 空转 turn 的 2 个 turn 可点开轨迹核对是否为中断/无产出。

## 7. 方法与局限

- 判定全部来自事件字段与 host 活快照;AI 层引用已逐条校验。
- 本报告基于**当前活日志修订**;若日志再次重写,seq 需重新解析。
