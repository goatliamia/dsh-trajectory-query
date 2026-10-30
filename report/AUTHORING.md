# 可视化报告的写作与组件用法

先完成诊断：理解任务，沿已有 `trajectory_inspect` / `read` 取证，选出会改变下次做法的发现。再选择能帮助读者理解这项发现的组件。纯文字或表格已经清楚时继续使用它们。

1. 开头回答用户的问题，说明优先处理什么。章节标题表达发现。
2. 图前交代要比较的对象；图后解释意义、具体改法及怎样检查改法。正文不逐项复述数值。
3. 绑定已经取证的 snapshot、范围和对象。模型选择字段、重点及说明；渲染器直接读取分页数据，模型不用抄写整组数值。
4. 点和注释引用数据行 ID；数字、单位、口径、覆盖与原文位置由数据提供。自写判断放在标题、图注和正文，不写进测量字段。
5. 大小比较用 bar，长尾用 histogram，相近条件对照用 scatter，实际重叠用 timeline。sequence 只组织已经读过原文的行动与反馈，标出新增信息。
6. context 展示来源估算；与官方总占用、实际请求用量分别解释。comparison 指定两个真实记录位置和同单位字段。工具规模与低频不自动产生替换建议。
7. 每节围绕一个问题排图，保留正文的阅读顺序。重要图可以展开，相关图才并排；报告以静止画面先呈现，交互用于继续查看。

普通 Markdown 中明确放置组件：

````markdown
## 压缩之后，助手消息仍在增长

这里先解释主要发现。

```report-figure
{"id":"growth","type":"context","data":"ctx","fields":{"x":"turn"},"sample":"last-per-turn","series":["assistant","tool"],"layers":["total","delta"],"title":"第 160–190 轮的构成变化"}
```

这里解释值得关注的位置，以及下一次具体改什么。
````

`ctx` 是宿主根据取证查询生成的数据集别名，不是模型自行填出的数值数组。它的取数声明例如：

```json
{"tool":"trajectory_inspect","args":{"session":"会话 ID","snapshot":"已有切点","view":"context","turns":{"from":160,"to":190}}}
```

宿主调用 `collectDataset`，设置 `format:"data"` 并取完有界分页；Markdown 只引用别名。序列图通过同切点 `trajectory_read` 取得选中的原文，再将节点绑定到记录 ID。组件及字段契约见 `docs/report-assembly.md`。
