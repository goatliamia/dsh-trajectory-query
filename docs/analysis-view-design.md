# 分析面板与路径页设计

本文件记录内部实现、数据流、资源边界及维护约束。功能、安装和访问方式见 [分析面板使用说明](../plugin/analysis-view/README.md)。

## 现有解读入口

现有面板按钮按需使用当前默认模型发起一次 `llm.stream`，输入为固定系统提示和有界证据块（incident、cost 与最多 8 条原文节选）。它不走 agent loop，也不向会话写回解释。新增诊断工具及分主题方法尚未接入这个按钮，两者的接入状态需要分别确认。

## 设计原则

1. **检测是确定性的,不是模型判断。** 什么算 incident 由分析器按类型化事件判定;模型只解释,不发明。
2. **面板只渲染证据**,绝不把表面模式当 incident。
3. **不做 profiler 计数。** 工具名直方图、调用次数不是 incident。两条坑已被测试钉死:
   *提及 ≠ 发生*(日志里出现字符串不等于事件发生)、*同名 ≠ 重复*(重复必须同工具**且**同参)。
4. **诚实标注缺口。** 同参重复、空转 turn 需要参数/状态,而客户端投影不携带,因此标 `需 host`,不猜。

## incident 的形状只有一份家

`incidents` 是十个字段的事实(`type severity title detail cause runtimeKnew modelKnew harness impact seqs`)。
写它的地方有三个 —— 仓库分析器、本插件的 host 半边、本插件的客户端半边(它 import 不到任何东西)——
所以"形状归谁管"以前是习惯,不是事实。

现在它是**一处声明**:`lib/incident-shape.js`,而且这个文件**住在包里** —— 运行期 import 不到仓库脚本,
所以声明跟着包走,由 `analyzers/` **反过来** import 它。记录只能经 `incident(...)` 造出来:
缺字段、多字段、类型不符、`seqs` 写成 chip 形态,都当场抛。于是"每个分支再写一遍那十个名字"这件事
**写不出来了**。

`analyzers/shape-law.mjs` 负责让它一直这样:

```text
node analyzers/shape-law.mjs            # 形状 / 认领 / 漂移 / 差分 / 证人
node analyzers/shape-law.mjs --mutate   # 证明法则会咬:合理的错法必须被抓
```

- **认领** —— 探测器找出所有"知道这份形状"的文件,每一个都要在声明里挂上角色(源 / 像 / 证人)与形态
  (在它手里 `seqs` 是什么)。**漏一个参与者本身就是错。**
- **漂移** —— 自己写字面量的载体(客户端半边)按键、按顺序逐个比对。
- **差分** —— 与冻结基准逐字节相同(合成流 + 缩减后的真实会话),键顺序也在字节里。
- **证人** —— 历史 `experiments/reports/*.facts.json` 只读校验,绝不回写。

## 路径页

单独的「路径」标签取 `GET /analysis-view/trace?staged=1&session=<id>`:立即启动真实页面,
先显示当前统计,主干就绪后立即显示,正文、文件与子代理图层随后主动补齐。所有阶段共享一次主日志观察和同一份 cut;
预载期间选中某轮会优先读取该轮正文,参数与结果沿用原始投影的节选长度,不再额外缩到 600 字符。
图层补齐保留缩放、位置与选择。原有 `GET /analysis-view/trace?session=<id>` 仍提供自包含快照。
官方当前上下文更新只刷新摘要;历史增量更新只替换上下文 SVG 图层,不重建主干。
切走或浏览器隐藏会取消未完成的补齐任务。切走后的隐藏 iframe 最多保留两分钟,到期释放;回到页面时重验数据与资产版本。
HTML 与阶段数据共用最多四项、估算 64 MiB、空闲两分钟的缓存预算,仅一个超大当前快照可超过预算。
缓存只保留压缩后的响应,不同时长期保留 JSON 字符串;主日志、子代理、历史回放各有全局并发限制。

超长会话若超过 `dsh-context` 的历史保留范围,页面会标注当前覆盖范围并提供「回补更早增量」。
点击后通过 Harness 公共 `sessionProjections.restore` 接口分批回放早期日志,不改动活跃投影或全局保留设置。
每个快照只保留一个回补窗口;每个窗口最多 1500 条请求,继续点击可向前回补。工具正文仍主动预载,选中轮次会优先返回。
两者由 `lib/trace/page.html` + `lib/trace/page.js` 组成。它就是
`docs/demo/layout-review` 里那套 Geist 视觉试作搬回插件后的样子 —— 全景与逐轮行动路径、上下文构成、
文件对象、工具结果枝条、子代理与 Skill 观察。

页面代码的**作者位置在 demo,不在插件里**。`node scripts/port-geist-page.mjs` 把构建好的 demo 页面
拆成这两个运行时资产,并把纯模型模块复制到 `lib/trace/models/`;`page.html` 与 `page.js` 不要手改。

数据分两头来,因为有两类值只存在于视图侧:

- host(`lib/trace-context.js`):调用事实、文件操作、压缩与裁短边界、模型重试、补充内容计数、
  Skill 读入记录、Skill 正文存续(走官方 `SurfaceManager` 回放)、子代理支线(子会话同样通过
  Session 查询服务读取)。
- 视图(`lib/client.js`):`stats` 会话目标里的官方统计快照,以及通过标准 `useProjection` 钩子位读到的
  `contextPressure` / `contextBreakdown` / `contextTimeline`。这些作为按会话隔离的 `postMessage` 补丁送达,
  到达后重建对应索引并更新图层,主干启动不再等待它们;详情先到、后到都能正确保留。

两边都可缺:投影没到、没有 stats 目标时,对应图层不出现,主图照常渲染。
会话在本进程里活着时,host 也会直接读一次 `contextTimeline`(`ctx.sessionProjections.snapshot`),
每轮请求构成就来自这里。

## 文件

| 文件 | 作用 |
|---|---|
| `lib/client.js` | 客户端插件本体;必须以 `window.__ModuleLoader__.load({ id, factory })` 自注册,`require("react")` 而非全局 |
| `lib/index.js` | host 半边:计算 incidents,提供 `GET /analysis-view/digest?session=<id>`(事实 + `log` 身份)、`GET /analysis-view/interpret?session=<id>`(AI 解读,仅展开时才调用)、`GET /analysis-view/trace?session=<id>`(路径页)与 `/analysis-view/trace/fonts/*` |
| `lib/trace-build.js` | 会话事件 → 页面数据(轮次、步骤、调用、incident、通信) |
| `lib/trace-stages.js` | 共用日志切点、轻量主干、主动预载正文和子代理、单轮优先读取 |
| `lib/trace-resources.js` | 跨快照共享的容量预算、空闲淘汰、可取消队列与并发限制 |
| `lib/trace-context.js` | 页面的补充图层:调用事实、文件操作、边界、重试、补充内容、Skill、子代理 |
| `lib/trace-skill-evidence.js` | Skill 正文与存续证据(`analyzers/dsh-skill-evidence.mjs` 的副本) |
| `lib/trace/` | 生成出来的页面资产(`page.html`、`page.js`)、纯模型模块(`models/`)与 Geist 字体 |
| `lib/incident-shape.js` | incident 事实的唯一声明:有序字段、类型、`incident()` 构造器、参与者认领表 |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `package.json` | `dsh.bundle.patch` + `dsh.client`(platform web + client injects) |

## 维护与验证

### 独立趋势试作

`docs/demo/layout-review/context-observation.js` 用于 3089 的趋势试作和 Pi / Codex 独立视图，尚未装入 DSH 的生产路径页。构成筛选只替换 `trace-context-layer`，保留主干、结果枝条、文件与子代理的 DOM；仅切换总趋势显示等几何变化才重新布局。趋势累计值与时间映射分别使用单项缓存，来源或坐标变化时重建。

`context-trend-model.mjs` 在原有 SVG 两位小数精度下合并重复点与同向共线点；不会抽样、改变曲线、删除峰值或压缩跳变。完整请求与详情不变。`context-trend-test.mjs` 验证密集平台、拐点、同时间跳变、往返与数值精度，以及移除点仍位于同一线段。

本机 105 轮、1,212 条构成记录的交互取样：同样 2 倍缩放、取消“工具结果”，处理约 63 ms → 8 ms；全览 SVG 的 path 字符数约 43.4 万 → 18.6 万。它们是本次浏览器取样，不是完整帧耗时或 455 轮保证；整图缩放和布局仍有明显重绘开销。

```sh
node docs/demo/layout-review/context-trend-test.mjs
node scripts/build-context-trend-study.mjs
```

### 步骤选择与补画

逐步视图复用同一轮已生成的图形。选择变化只更新旧/新节点的高亮、色柱透明度、ARIA、详情、工具耗时入口和文件关联；轮次不匹配、节点未生成或技术缩放时仍回到完整渲染。数据、图层和尺寸变化继续完整更新。

子代理与 Skill 补画读取主渲染器已测得的视口坐标。逐步视图的滚动在重画文件层前更新该坐标；未选择 Skill 时只清除旧高亮，不读取布局或扫描所有轮次。未增加跨会话缓存。

455 轮、2,241 步冻结样本的本机浏览器取样中，第 81 轮（63 步）切换至第 2 步约 15.2 ms → 0.7 ms；未选择 Skill 的全览补画绑定约 20 ms → 不足 1 ms。原始记录、浮动标注和后续缩放继续可用。取样不代表所有设备上的帧耗时，整图平移仍有 SVG 重建成本。分阶段服务端补齐与这些交互成本分别计量。

```sh
node docs/demo/layout-review/selection-perf-test.mjs
node docs/demo/layout-review/geist-interaction-test.mjs
```

修改页面应编辑 `docs/demo/layout-review` 的源文件，再执行构建与 port 脚本；不要直接改生成的 `plugin/analysis-view/lib/trace/page.html` 或 `page.js`。

```text
node scripts/build-preserved-demo.mjs
node scripts/build-geist-demo.mjs
node scripts/port-geist-page.mjs
node scripts/sync-inspect-models.mjs
node plugin/analysis-view/self-test.mjs
node plugin/analysis-view/stages-test.mjs
node plugin/analysis-view/resources-test.mjs
node plugin/analysis-view/perf-test.mjs
node plugin/analysis-view/operations-test.mjs
node analyzers/shape-law.mjs
```

Host 分析与仓库 analyzers 仍有各自的检测实现和差分基准；incident 形状共用唯一声明。客户端 factory 不能直接相对导入这一声明，因此字面量由漂移检查保护。取值差异不能只因形状一致就当作已经统一。
