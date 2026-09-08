# trajectory-query(查询纪律 v1)

> 由 `plugin/trajectory-tools/` 随工具一起注册为 runtime skill(`lib/skill.js`),不需要改任何 agent preset。本文件是同一份正文的仓库副本。

需要过去的信息时(被 compaction 覆盖、很久以前、其他会话/子代理):**不要猜,先查**。

- `trajectory_sessions` — 先拿 session id(存活 + 已持久化)
- `trajectory_find` — 关键词 / 类型 / seq / 时间找事件,返回 `(session, seq, type, time)` + 逐字片段
- `trajectory_window` — 按 `(session, seq 区间)` 取原文窗口
- `trajectory_trace` — 需要关系 / 子代理链时,拉事件引用与谱系

引用纪律:

1. 陈述历史结论时带证据位置 `(session, seq@logId)`;logId 由工具返回(`seq` 只在同一份日志修订内稳定)。
2. 引文必须**原样**,不改写、不总结事实。
3. 工具返回空 = 日志里确实没有,说"无证据",不要用常识补。
4. 工具只给事实;解释是你的工作,但必须建立在查到的逐字证据上。

```text
find(session=abc, query="test failed")  →  seq=6430
window(session=abc, seq=6430)           →  原始事件
```
