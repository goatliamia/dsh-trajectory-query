# trajectory-query(查询纪律 v6)

> 由 plugin/trajectory-tools/ 随工具注册为 runtime skill；本文件是 lib/skill.js 正文的仓库副本。

需要过去的信息时(被 compaction 覆盖、很久以前、其他会话/子代理):**不要猜,先查**。

- `trajectory_search` — 查事实与数字,`view` 必填:
  `events` 按字面词搜事件(返回 `(session, seq, type, time)` 与逐字片段 + `matchAt`;`offset` 翻页,返回 `nextOffset`);
  `catalog` 会话的计数与 seq / 时间范围(不含正文);要按事件类型 / 工具细分时加 `filter.breakdown:true`;
  `cost` 逐请求 token 与 cache 效率(`coverage` 只在有请求没报全时出现);
  `sessions` 可查会话列表(带标题)。
  可选维度收在 `filter` 里,键按 view 不同(传错会告诉你这个 view 能用哪些)。
- `trajectory_read` — 按 `(session, seq 区间)` 逐字取原文;默认只给有正文的事件,`raw:true` 给区间内全部;`format:"json"` 给完整事件对象(信封/来源都在),log 身份照样带。
- `trajectory_graph` — 事件关系链(替换/引用/派生)或会话谱系;链默认只给计数与首尾,`full:true` 给完整数组。
- `trajectory_inspect` — 运行诊断取证：先取总览或指定主题，得到官方统计、必要的关联原文和可继续调用的读取入口；按返回的调查方法分析。多次查询沿用返回的 snapshot。

默认行为:

- 不给 session 时,`events` 覆盖 **当前会话 + 所有 live 会话 + 最近若干已持久化会话**;要查很久以前的已持久化会话,显式传 session。
- `events` 默认过滤注入样板(`<system-reminder>` 的 workspace 指令)与 `trajectory_*` 自身的调用/结果,避免"查什么就命中自己";要看原始结果时关掉 `filter.excludeInjected` / `filter.excludeSelf`。`cost` 不套这两个过滤:记账要记全量。
- `events` 匹配默认归一化(`filter.normalize:false` 可关):连续反斜杠折叠、中英文引号互认 —— 写单反斜杠的路径也能查到日志里转义过的双反斜杠。

成本纪律:

- 数字是**确定性事实**,工具只给数;"这次花得值不值"是你的解释,不要混进数字里。
- 读成本区分 `input`(未缓存输入)、`cacheRead`(缓存读取)和输出。缓存率变化是待调查现象，单靠未命中不能确定前缀变化；工具定义估算也不能直接当作可节省的金额。
- `unknown` 是"适配器没上报",不是 0;不要把它当成成本为零。

引用纪律:

1. 陈述历史结论时带证据位置 `(session, seq@logId)`;logId 由工具返回(`seq` 只在同一份日志修订内稳定)。
2. 引文必须**原样**,不改写、不总结事实(归一化只影响匹配,不影响引文)。
3. 工具返回空 = 日志里确实没有,说"无证据",不要用常识补。
4. 工具只给事实;解释是你的工作,但必须建立在查到的逐字证据上。

```text
search(view="events", query="test failed")                 →  当前会话 + live + 最近会话里的命中
search(view="catalog", session=abc)                        →  该会话有多少可查事件、seq/时间范围
read(session=abc, seq=6430)                                →  那一段的原始事件
graph(session=abc, seq=6430)                               →  它的替换/引用/派生链
search(view="cost", session=abc, filter={groupBy:"turn"})  →  每轮 token 与 cache 效率
```
