# Digest: session-e0636aa9-e8d7-4879-9309-7b5ff232037d

- 生成:2026-09-08T13:13:49.027Z;文件:C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd
- 事件(可解析落盘):5578;seq 0–371540
- 复跑:`node analyzers/run-digest.mjs "C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd"`
- 局限:jsonl 打包/截断会漏事件;live 会话最准走 ctx.sessionQuery(分析器同源可复用)。

| analyzer v | facts |
| --- | --- |
| turns v1 | 49 turns (end 48) |
| tools v1 | 301 calls / 31 tools; top: pwsh×92, write×61, read×25 |
| errors v1 | 8 error events / 4 kinds |
| retry v1 | 0 suspected repeat pairs |
| incidents v1 |  |

### Incidents (v1, 机械层, 确定性)
- **调用失败** (sev 1) — 10 个调用返回错误; cause: 工具调用返回错误; runtime: 错误码见证据; model: 收到 tool result(可能已含错误); harness: 未检测到针对性处理; impact: 该部分目标未达成; evidence seq: 72652, 92652, 92732, 191688, 241063, 241065, 249962, 249968
- **空转 turn** (sev 1) — 2 个 turn 无任何工具调用; cause: 该 turn 未产生工具动作; runtime: -; model: 无工具上下文; harness: -; impact: 该 turn 未推进; evidence seq: 

> 列全部由确定性分析器产出(模型不写列)。开放解读与人工核验见 skill/analysis.md。
