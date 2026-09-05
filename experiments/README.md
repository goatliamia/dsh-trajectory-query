# experiments(流水线约定)

流程:`语料 → 探针 → 运行 → 盲评 → 报告`

| 目录 | 内容 |
|---|---|
| `corpus/` | 语料说明与生成脚本(burner 会话 / 合成体制) |
| `probes/` | `probes.json`(问题集)+ `keys.json`(答案键;**作答者不得打开**) |
| `raw/` | 运行原始记录(作答输出、工具调用日志、token 计数) |
| `reports/` | 评分后报告(`tier0-results.md` 等) |

红线:

1. **双盲**:准备键与作答分离;评分子代理不知臂别。
2. **verbatim 自动校验**:引文字符串逐字查日志;指针 decode 后查事件。
3. **指标**:正确率 / 幻觉率 / 引用有效性 / verbatim 命中 / 每探针 token / find 使用率。
