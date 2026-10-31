# 诊断报告写作

正文按[报告写作](WRITING.md)组织。这里说明组件、数据绑定与 HTML 装配；图表数量由问题决定，文字和表格足够清楚时直接使用它们。

普通 Markdown 中插入 `report-figure` JSON 围栏。模型选择数据别名、字段、记录 ID、标题与重点，宿主管理完整数据。数字、单位、来源与证据来自取证结果；颜色、字号、间距及交互由渲染器统一提供。

## 选择组件

| 类型 | 用途 |
|---|---|
| metrics | 从数据行引用少量关键读数，自动显示单位 |
| bar | 比较对象的数量大小，可对已声明可加的指标按标签分组 |
| histogram | 看常见区间及长尾 |
| scatter | 在两项实际配对测量间找代表点或异常点 |
| timeline | 看有真实起止位置的调用怎样重叠或串行 |
| sequence | 将已读原文中的行动、反馈与转折连起来 |
| context | 看来源构成的保留量及增减 |
| comparison | 看两个明确时点的前值、后值及变化 |
| donut | 看同一统计范围内互斥类别的数量和比例 |
| stacked | 比较多个时点的数量或比例结构 |
| assembly | 按片段身份与逻辑顺序重放保留、追加及历史变化 |

需要某个组件的绑定例子和专用参数时，执行 `node scripts/trajectory-report.mjs components --type <类型>`。图前交代比较对象，图后解释对任务的意义和行动；不用不同图重复同一份信息。每张图应帮助解释一个具体判断或选择下一步；若图只是在正文末尾补一份无关统计，重新选择表达方式。

**看同一整体中少量、互斥分项的占比，用 donut；比较对象大小用 bar；观察随时间变化用趋势图。**

## 准备数据

CLI 可直接连接本机 Codex：加 `--host codex`，默认当前会话，或加 `--thread ID`。Pi 离线加 `--host pi --file <session.jsonl>`；Claude Code 使用 `--host claude --file <transcript_path>`。DSH 使用宿主提供的连接文件与 case。后续 query / prepare 使用相同来源参数，查询与读取沿用原工具的 snapshot 和指针。命令中的脚本路径按所在宿主 skill 给出的安装位置解析。

```sh
node scripts/trajectory-report.mjs query --connection <host.json> --case <key> --tool schema
node scripts/trajectory-report.mjs query --connection <host.json> --case <key> --tool trajectory_inspect --request <args.json>
node scripts/trajectory-report.mjs query --host codex --tool trajectory_inspect --request <args.json>
```

把选定的查询写入计划，引用已经返回的 snapshot：

```json
{"schema":"trajectory-report-plan/1","sources":{"steps":{"query":{"tool":"trajectory_inspect","args":{"snapshot":"已取证的 snapshot","view":"latency","turns":{"from":1,"to":10}}}},"quotes":{"records":{"from":"steps","seqs":[123,456]}}}}
```

`query` 直接复用 `trajectory_inspect` 参数；prepare 自动设置 data 格式并取完分页，支持 overview/latency、cost、io、context 的数据输出。io 可按 tool/file 分组，cost 这里是原始 usage 结算。其他分析摘要仍可用于正文或 Markdown 表格。`records` 从同一已准备数据的来源读取明确选定的原文；需要真实拼装结构时使用 `{"assembly":{"from":"steps","cuts":[123,456]}}`。如果只需要原文或结构，可把 query 返回的 `reportSource` 直接放在 records/assembly 的 `source` 字段里，替代 `from`，不用为身份再准备一张数值表。

DSH 官方已有的范围合计和分组也可直接绑定：在同一个 query 中加 `"table":"summary"` 导出一行 `scope` 合计，或 `"table":"groups"` 导出原 inspect 的窗口/轮次/工具/文件分组。它复用原查询与汇总值，无需先抓逐步明细再求和。分组种类仍由原 args 控制；不指定 groupBy 的 overview 是时间窗口。组件只看字段和单位，数据无需来自对话摘录或某个固定主题。

```sh
node scripts/trajectory-report.mjs prepare --connection <host.json> --case <key> --plan <sources.json> --bundle <bundle.json>
```

prepare 返回列名、单位、覆盖和少量位置示例；选中原文额外提供有界摘录与续读参数，完整数组保存在 bundle。重要判断仍应沿关联原文核对行动、反馈及后续，再写成解释；保存原文与读过原文分别记录。重复 prepare 会复用同一计划的冻结数据；修改范围或 snapshot 则重新读取。需要更多具体行 ID 时，可用原 inspect 的 data 格式缩小范围读取。序列图的行 ID 为 `record:<seq>`；其节点标题与说明由已经读过原文的作者归纳。

## 写 Markdown 并渲染

````markdown
# 直接说明主要判断

先解释发现和比较对象。

```report-figure
{"id":"duration","type":"histogram","data":"steps","fields":{"value":"wallMs"},"title":"活动步骤耗时分布"}
```

解释这项发现对任务意味着什么，下一次先改哪一步，怎样检查改法。
````

```sh
node scripts/trajectory-report.mjs render --markdown <report.md> --bundle <bundle.json> --output <report.html>
```

绑定错误返回 Markdown 块、行号和原因。修正相关声明即可；改文字或版式不需要重新取数。输出是自包含 HTML。原事件身份和正文指针随图保存，宿主尚未提供完整正文打开桥时可查看保存的证据位置。

### 使用诊断模板

渲染时加 `--template diagnostic`，统一提供标题、可展开章节导航、编号、字体和留白。普通 H2 保持正文顺序；`## [pair] 标题` 组织图前解释与后面的图文，只有正文宽度足够时才并排；`## [actions] 标题` 将有序列表排成行动区，`## [sources] 标题` 折叠详细口径。标题始终独占一行，窄屏顺排。开头可放一句判断的引用块和一张 metrics；不必填满所有区域。模型只选择内容与位置，不写 CSS，也不用把每一节强行配图。

snapshot 失效时先重新 inspect，核对日志身份和切点再续读；同批读取共享身份失效后停止该批，避免重复使用旧 ID。写 Markdown/JSON 时使用文件写入工具或正确的字面量，避免 shell 再解释反引号；渲染结果会返回实际装配的图表清单。

来源构成是估算；与实报 usage 分别解释。比例用互斥且同单位的分项，不把合计再加进分项；token 比例不是费用比例。两个切点的净差包含其间新增和移除，比较单次转折时优先选择相邻记录。图形不能从数值比例补造结构。
