# 报告试排

十二个可切换的真实场景，每页一张候选图：活动耗时分布、上下文切片、未缓存输入尖峰、请求散点、工具时间区间、反馈定位过程、工具返回规模、下降前后的来源对照、时点构成、构成迁移、输入构成，以及动态拼装。只试报告的阅读与组件形式，没有注册新的诊断工具，也没有改变 DSH 视图。

正文来自本目录的 Markdown。组件位于 `report/`，共十种；数值通过实际注册的 `trajectory_inspect(format="data")` 返回，证据序列通过同切点 `trajectory_read(format="linked")` 取得。拼装结构由同一冻结日志上的已有 `context-evidence` 和官方 SurfaceManager 读取，沿用同一日志身份。模型无需搬运分页。组件本身不读本地会话目录。

构建和阅读均由本仓库提供：`report/compile.mjs` 编译有限的报告 Markdown，原始 HTML 转义，`components.mjs` 解析声明并绘制 HTML/SVG。没有 ARC 运行或构建依赖。

```powershell
node scripts/build-report-study.mjs
node scripts/serve-report-study.mjs 3090
```

构建需要本机已有的 `.dsh/diagnostic-pilot/{repair,long}/events.jsonl`、`meta.json` 和完整 `.dsh/context-trend-study-source.html`。专用的 `scripts/report-fixture-source.mjs` 仅供预览：把两份冻结日志交给原工具注册路径，官方步骤统计继续调用当前已安装定义；可选构成从同切点已捕获投影读取，并核对每条响应身份。它保持官方投影最近保留窗口，不把历史回补永久塞进检查缓存。

不会重新运行模型、采集浏览器数据或扫描其他会话。真实数据、数据包与生成 HTML 留在被忽略的 `.dsh/report-study/`。`context-report.html` 是单文件报告，包含字体、组件和冻结数据，可离线阅读。
