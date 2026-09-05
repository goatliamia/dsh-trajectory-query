# trajectory-query(纪律 v0)

需要过去的信息时(被 compaction 覆盖、很久以前、其他会话/子代理):**不要猜,先查**。

- `trajectory_find` — 关键词/类型/时间找事件,返回 `(session, seq)` 定位 + snippet
- `trajectory_window` — 按 `(session, seq 区间)` 取原文窗口
- `trajectory_trace` — 需要关系/子代理链时,拉事件引用与谱系

引用纪律:

1. 陈述历史结论时带证据位置 `(session, seq)`。
2. 引文必须**原样**,不改写、不总结事实。
3. 找不到证据就说"无证据",不要用常识补。

```text
find(query="test failed")  →  session=abc seq=6430
window(session=abc, 6410..6450)  →  原始事件
```
