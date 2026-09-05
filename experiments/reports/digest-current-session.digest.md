# Digest: session-e0636aa9-e8d7-4879-9309-7b5ff232037d

- 生成:2026-09-05T09:04:27.738Z;文件:C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd
- 事件(可解析落盘):2895;seq 0–182938
- 复跑:`node analyzers/run-digest.mjs "C:\Users\14100\.dsh\sessions\--D-projects-sql~0020event--\session-e0636aa9-e8d7-4879-9309-7b5ff232037d\session.jsonl.zstd"`
- 局限:jsonl 打包/截断会漏事件;live 会话最准走 ctx.sessionQuery(分析器同源可复用)。

| analyzer v | facts |
| --- | --- |
| turns v1 | 18 turns (end 17) |
| tools v1 | 171 calls / 26 tools; top: pwsh×40, write×35, trajectory_find×18 |
| errors v1 | 1 error events / 1 kinds |
| retry v1 | 0 suspected repeat pairs |

> 列全部由确定性分析器产出(模型不写列)。开放解读与人工核验见 skill/analysis.md。
