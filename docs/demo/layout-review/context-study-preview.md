# 上下文趋势独立预览的数据检查

独立预览没有 DSH 父页面提供官方统计，也没有历史回补接口。只包含最近一段 `context.requests` 的冻结页面不能代替完整演示数据。

`scripts/build-context-trend-study.mjs` 在写入前检查：

- 主会话中每个已记录模型响应的 `assistantSeq` 都有对应的构成记录，轮次与步骤一致。没有响应的中止步骤不补造数据。
- `context.historyRequests` 与 `context.requests` 合并后无冲突，并与主会话中的响应序号、轮次和步骤逐一对照；不匹配的记录会被拒绝。
- 官方占用与容量存在。来源构成的估算总和不能代替官方占用。

本地完整快照可保存在被 Git 忽略的 `.dsh/context-trend-study-source.html`。不指定 `--source` 时优先使用它，否则沿用 `.dsh/layout-review/geist.html`。刷新渲染代码时不重新丢弃历史或官方统计。显式提供 `--source` 可以切换到另一份完整快照。

用于测量部分加载的样本必须同时指定 `--allow-incomplete --out <另一个目录>`；主预览目录不接受此模式。校验失败发生在写文件之前，保留现有预览。这里的覆盖检查用于防止演示回退；采集快照时仍须核对会话、日志版本和官方投影所属的记录位置，不能混合不同版本的数据。

运行 `node scripts/context-study-snapshot-test.mjs` 验证覆盖检查及失败时保留原文件的行为。原始会话、回补结果和官方缓存只留在本地。
