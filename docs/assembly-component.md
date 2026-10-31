# 上下文动态拼装组件

`report/assembly.mjs` 同时用于独立 demo 和 Markdown 报告。原来写死的 12 轮、第 7 轮改写只存在于 `docs/demo/assembly-study/sequence.mjs` 概念夹具，组件不包含这些剧情。

来源基色由 `design/tokens.mjs` 提供，与原面板最终主题值一致。片段默认实色；历史变化用短暂描边及拆解定位，片段基色继续表示来源。对应关系及可复用资产见 [视觉语言](../design/DESIGN.md)。

## 输入与含义

组件接受 `trajectory-data/1` 数据，`kind: "context-assembly"`。它在同一日志身份和冻结切点下保存最多 48 个观察位置，并通过 `blocks` 字典复用不可变片段；每个位置的 `system / tools / history` 数组保存片段身份与逻辑顺序。历史最多 4096 条，系统和工具区各最多 16 块，字典最多 8192 块。片段只携带来源类别、位置和有界证据指针，不常驻工具正文。

- `assemblyFromContextSnapshots(snapshots, {source})` 适配已有 `context-evidence` / 官方 SurfaceManager 输出。生产宿主必须保证输入来自 `source` 指定的日志身份；预览直接在原工具已绑定的同一份冻结事件上重建。
- 工具定义单独成区；相同定义内容复用身份，不能因 request/header 事件序号变化就演成工具定义变更。
- 保留片段沿用身份；新增与移除按身份差分；顺序变化单独识别。实际逻辑历史顺序不按事件 seq 或轮次重新排序。
- 来源类别可以来自既有投影或角色配色，保留 `categoryBasis`。片段宽度不代表 token 数、耗时、模型注意力或缓存边界。
- 稀疏切点的差分只表示两个所选状态间的变化，不补画未观察的中间事件。仅有 token 数值时拒绝装配。

当前尚未给模型发布额外的 assembly 查询入口。宿主可复用已有只读适配器提供结构数据，不能宣称普通 `trajectory_inspect(view="context",format="data")` 已返回它。

## 调用

```json
{"id":"context-change","type":"assembly","data":"structure","initialRow":"assembly:1614","title":"一次工具结果替换之后，历史怎样接续"}
```

行 ID 必须来自宿主返回的数据；示例不代表固定案例。可用 `rows` 限定切点。报告默认静态，`autoplay:true` 只用于明确需要的演示。模型只选数据与重点，排版和动作由组件决定。

独立挂载使用 `renderAssembly(data,spec)` 取得标记，再调用 `mountAssembly(root,data,spec,{onSelect,onChange})`。返回 `play / pause / seek / destroy / state`；卸载或替换数据前调用 `destroy()`。`onSelect` 返回对应切点、片段及原事件指针，正文仍由宿主已有读取接口取得。

## 动效与资源

沿用来源侧片段飞入、旧片段标红、局部散开及重新拼入。一次只画 12 段历史，每段最多 18 个标记，密集段中间合并为可选的省略标记；被合并片段的身份仍完整保留，可点选查看。历史窗口可以平移。

仅新片段运行动效，拆解最多同时处理 12 个标记；没有永久 rAF 循环或每块事件监听。每实例管理自己的计时器、动画和一次委托事件。暂停保留剩余阶段；切换报告页、文档隐藏或组件离屏时暂停，销毁时释放监听和动画。减少动态效果模式不自动播放，打印保留静态结构。

## 预览

```powershell
node scripts/build-report-assembly.mjs
node scripts/serve-assembly-study.mjs 3091
```

独立页支持概念与真实记录切换；报告案例位于 `http://127.0.0.1:3090/#assembly`。真实夹具为原长对话第 10–22 轮的 15 个选定切点，通过官方 SurfaceManager 重建。生成数据仍只保存于被忽略的 `.dsh/report-study/`。
