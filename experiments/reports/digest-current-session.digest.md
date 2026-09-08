# Digest: session-e0636aa9-e8d7-4879-9309-7b5ff232037d

- 生成:2026-09-08T15:30:59.338Z;文件:C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd
- 事件(可解析落盘):6955;seq 0–468389
- 复跑:`node analyzers/run-digest.mjs "C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd"`
- 局限:jsonl 打包/截断会漏事件;live 会话最准走 ctx.sessionQuery(分析器同源可复用)。

| analyzer v | facts |
| --- | --- |
| turns v1 | 65 turns (end 65) |
| tools v1 | 380 calls / 34 tools; top: pwsh×126, write×82, read×33 |
| errors v1 | 12 error events / 5 kinds |
| retry v1 | 0 suspected repeat pairs |
| incidents v1 |  |

### Incidents (v1, 机械层, 确定性)
- **调用失败** (sev 1) — 14 个调用返回错误; cause: 工具调用返回错误; runtime: 错误码见证据; model: 收到 tool result(可能已含错误); harness: 未检测到针对性处理; impact: 该部分目标未达成; evidence seq: 72652, 92652, 92732, 191688, 241063, 241065, 249962, 249968
- **空转 turn** (sev 1) — 2 个 turn 无任何工具调用; cause: 该 turn 未产生工具动作; runtime: -; model: 无工具上下文; harness: -; impact: 该 turn 未推进; evidence seq: 

> 列全部由确定性分析器产出(模型不写列)。开放解读与人工核验见 skill/analysis.md。
