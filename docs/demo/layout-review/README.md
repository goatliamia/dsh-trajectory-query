# 执行路径布局预览

## 2026-10-29:移植回插件的「路径」页

`/geist` 的渲染器已经搬进 `plugin/analysis-view`:插件的「路径」标签直接服务这份页面,
不再加载旧的 `template.html` / `branches.js`。页面代码仍然只在 demo 里写,移植是一条命令:

    node scripts/build-preserved-demo.mjs   # 先把 demo 源拼成 preserved.html
    node scripts/build-geist-demo.mjs       # 再叠 Geist 层
    node scripts/port-geist-page.mjs        # 最后拆成插件的两个资产

port-geist-page 把构建好的页面拆成 `plugin/analysis-view/lib/trace/{page.html,page.js}`,
把纯模型模块复制到 `lib/trace/models/`,并复制 Geist 字体。旧插件里的六个渲染文件冻结在
`docs/demo/layout-review/base/`,继续作为 `build-preserved-demo.mjs` 的对照基准。

插件侧的数据分两段:事件能推出来的(调用事实、文件操作、边界、重试、Skill、子代理)由
`lib/trace-context.js` 在 host 算;官方统计与上下文投影由 `lib/client.js` 通过官方 hook 读出,
作为一次 `postMessage` 补丁交给页面。离线的整页自检:

    node scripts/check-trace-page.mjs

它用真实的 host 模块拼出页面,要求内嵌 JSON 能自解析、每个脚本都能编译。

## 2026-10-28：固定文件层版本与 Geist 视觉试作

文件层版本已固定为 files-v1。完整页面、数据及 40 份源码保存在本地
.dsh/layout-review/checkpoints/2026-10-28-files-v1/，manifest.json 记录每个文件的 SHA-256。
checkpoint-layout-review.mjs 拒绝覆盖已有快照；真实会话资料继续留在 Git 忽略目录中。

- /versions/files-v1：固定页面，按原字节提供，后续构建不会改写。
- /geist：从固定页面派生的新版视觉试作，使用 geist.css 和 geist.js。
- /：原有预览入口。

    node scripts/build-geist-demo.mjs
    node scripts/serve-layout-review.mjs 60573

参考 Vercel 官方 Geist 的颜色、Typography、Materials、Checkbox 与 Modal 规范：
https://vercel.com/geist/introduction
https://vercel.com/geist/colors
https://vercel.com/geist/typography
https://vercel.com/geist/materials

视觉适配独立编写。沿用既有事件口径、分叉形态、聚合和跳转逻辑。
七类上下文用固定语义色，柱体不再默认半透明；选中文件时才弱化不相关步骤。
界面使用中性底色、清晰文字层级、统一的 6px 控件圆角和 12px 浮层圆角。
底部观察开关保持集中；窄高度优先保留开关，详情可滚动查看。
本版默认开启文件层，方便对照文件与上下文；勾选状态在全景和行动路径之间继续共享。

Geist / Geist Mono 字体来自官方 npm geist@1.8.2，两个可变字体以本地 woff2 提供，
浏览页面不依赖字体 CDN。SIL OFL 1.1 许可证保存在 fonts/LICENSE.txt。
中文回退至系统字体，数字、路径和代码用 Geist Mono。
UI 样式未安装进 DSH，文件最终差异和插件影响分析的接入状态不变。

后续调整：蓝色、青绿色柱体提亮并降低饱和度，仍保持实色；分叉文字统一为
深色正文，所有分叉文字采用同样的 2px 背景色描边以保证叠加可读性。
枝条不加白色外圈，状态仍由原来的符号呈现。
geist-step.js 将选中步骤改为平面的操作/结果列表，直接打开改动片段和原始记录，
去掉重复的操作总标题、分栏卡片与灰色面板底色。

geist-navigation.js 统一概览和逐步视图的拖动：超过 6px 水平移动才开始平移，
拖动结束拦截误点击，取消、失焦时释放指针；支持方向键和横向滚轮。
文件层按整个时间轴或整轮步骤预排，视口仅裁切显示，不参与分组或位置计算。
概览文件入口明确显示全程范围，行动路径显示本轮范围。固定 files-v1 快照保持不变。

文件选择状态移到紧贴图表的固定入口，显示当前文件和“× 取消选择”。
选中的文件短条使用实色底和勾选标记，聚合条改为显示被选中的具体文件，
但不改变条目的宽度、位置或分组。取消通过按钮或空闲画布上的 Esc 明确触发；
画布点击、拖动、查看其他步骤均不隐式取消。弹层、输入框、进行中的拖动优先处理 Esc。
取消或换选同步更新返回全景时的选择状态，避免已取消的文件又被恢复。

文件全程记录由 geist-file-history.js 展示，fileChangeHistory 按路径从全会话读取，
不会被当前轮或可见窗口截断。点文件或从聚合列表中选择文件后直接打开全程记录，
关闭记录仍保留文件选择。顶部轮次轨迹定位到对应段落，正文按轮次折叠，默认看修改，
可切换包含读取。当前图中轮次单独标明；操作行直接打开实际替换片段或受阻操作的原计划，
并可定位回原执行步骤。查看差异后返回保留记录的展开状态和滚动位置。
目前覆盖保存的直接文件工具操作，不将 shell 内部修改猜归到路径，也不将各片段累计为整文件净差异。

    node docs/demo/layout-review/geist-interaction-test.mjs

## 工具结果枝条与官方耗时

工具结果、错误与恢复共用原来的细枝条和碰撞布局，观察开关统一为“工具结果”。
端点区分取回内容、写入修改、检查输出、受阻与恢复。总览按空间聚合，展开态按真实步骤定位；
普通调用不逐项画枝条，只纳入有明确文件、查询或检查记录的结果。未识别工具仍在步骤原文中。
恢复链中已关联的补读、再次修改不会重复生成普通结果枝条。检查只陈述实际输出，
PASS 行只表示记录有通过项，不能推出整个任务通过；未返回调用不会被画成成功结果。
结果枝条可展开原始结果、查看替换片段、进入文件全程记录或定位到相应步骤。

    node scripts/build-official-stats-review.mjs
    node scripts/build-geist-demo.mjs
    node docs/demo/layout-review/tool-result-test.mjs

官方统计 fixture 直接执行本机已安装 client-ui-stats 模块，收集它注册的 Definitions 和
stats view builder，离线回放同一日志截止点。没有复制统计公式，没有创建新 Host 接口；
运行中 DSH 的读取仍使用 official-reader.mjs 的官方 stats target。
当前回放覆盖 105 轮、1214 步。fixture 记录模块版本和 SHA-256，真实数据保留在 .dsh/。

工具区间在耗时勾选下显示细线，选中步骤可查看官方覆盖时长和累计工具时长。
覆盖时长直接使用官方区间并集，累计值保持官方口径，不用累计值代替用户经历的时长。
本历史快照有部分调用结果时间超出步骤范围；这种记录保留原值供核对，不画失真的比例。
官方每步摘要最多 12 项调用，明细不完整时明确说明，不能将截断摘要当作完整调用列表。

## 当前版本：保留原有细分叉

当前首页由 scripts/build-preserved-demo.mjs 生成，复用安装版的主干、
细分叉、截口、成功标记和缩放交互。上次的大标签方案已退出首页。

    node scripts/build-preserved-demo.mjs
    node docs/demo/layout-review/preserved-test.mjs
    node scripts/serve-layout-review.mjs 60573

当前相关源码：

- branch-layout.mjs：标签、符号和竖向枝条一起预留空间；放不下时在邻近分叉上显示数量。
- meaning.mjs：将工具、失败、恢复与请求结果转为短文案；不据单次返回推断任务完成。
- preserved.js：原分叉渲染、普通语言详情、主路径动作摘要。
- preserved.css：沿用安装版视觉形态。

当前阅读层级：

- 全览先说明受阻数量、后续成功与结果未确认的数量；保持原来的短枝和状态符号。
- 事件按固定的时间层次组织，屏幕跨度不足时共用一条分叉，放大后拆开；布局碰撞仍会触发邻近展示组的进一步收拢。平移不重新分组。
- 自动再试用贴近主线的短虚线标位置，底部入口提供完整次数和记录，不逐条画循环图标。
- 单个事件、动作摘要和再试详情都有行动路径入口。返回全景时恢复缩放与横向位置。

## 耗时与上下文叠加层

“耗时”按 turn/start 与 turn/end 划分轮次，竖向虚线标边界，上方在空间允许时标该轮总耗时。
窄区间用分:秒，放大后显示轮次和完整时长；含轮内等待，不含轮间等待。
这与 context 的 activeMs（扣除用户等待）不是同一个指标。

“上下文变化”直接叠在同一条主线上：向上增加，向下减少，七种颜色表示来源。
它不是第二张图；取消勾选会隐藏色带、刻度和来源图例，主路径坐标保持不动。
纵向刻度按整份会话新增量的第 95 百分位向上取整，本样本为 ±30k；
横向缩放和平移都不会改变纵向单位。超过显示范围的柱用省略号收起柱高，
标“实际数值 · 收起”，保留来源占比；详情始终显示完整值，并说明这不是模型容量上限。
首轮增量口径仍为基线零，图上改为明确标注首轮末次请求已有量 97.7k，
详情展示首次请求 13.1k 到末次请求的各来源变化，避免把开场内容画成空白。
“注入内容”改称“补充内容”，七类来源图例可点击查看解释和实际补充来源记录。
总上下文窗口不是单轮增量的刻度。原细分叉加窄底色避让，不移动事件位置。

轮次虚线加深并改为较长线段。总览中不足 16px 的密集边界先以顶部短刻度表示，
上方按空间合并连续轮次，显示轮次范围与合计耗时；所有轮次恰好出现一次，
不再只显示能放下标题的长轮次。点范围展开每一轮，顶部“每轮耗时”支持按轮号直达。
放大后显示完整分隔线。成功压缩的 summary 事件用上方剪刀和贯穿的黄色虚线标记；
剪刀只绑定“上下文变化”，不再与“停顿与再试”取或。
多次压缩过于靠近时共用入口，详情仍逐条保留。
本会话另有 17 条工具返回裁短，涉及运行时查询、插件管理、读取、命令、轨迹读取与网页读取。
它们保留首尾、裁去过长中间段，不画成摘要压缩；详情中与两次摘要压缩分开解释。

数据读取使用本机已安装 dsh-context 的现有只读投影，离线回放到该轨迹快照的最后 seq。
没有复制或修改第三方源码。来源分类与比较口径参考了它的公开实现，增量计算和绘制代码独立编写。
若重新读取数据，先运行：

    node scripts/build-context-review.mjs
    node scripts/build-preserved-demo.mjs
    node docs/demo/layout-review/context-test.mjs

比较每轮最后一次请求与上一轮最后一次请求的七类构成，首轮为基线。
增加、减少分别保留，净值是两者之差；不是计费量，不含末次请求之后才产生的回复。
当前快照覆盖 105 轮、1212 次请求：第 105 轮 +7099，第 33 轮 -421548，与 context 显示对齐。

事件口径已对照 DSH 源码：llm/retry 只表示安排重试，llm/retry-started 才确认开始；
本样本的 8 次都有开始记录。行动路径的恢复标记使用已有完整参数匹配的成功调用，
不再用“后面出现同名工具”作为恢复依据。

## 总览到逐步行动

继续放大时，指针或视口中心所在的轮次宽度达到视口 85%，自动进入该轮行动路径。
按原时间锚点选中步骤；缩小或返回恢复进入前的缩放和横向位置，避免来回跳动。
直接行动路径入口仍保留；定位短轮次可用“每轮耗时”的轮号输入，无需反复放大。
行动路径保留每步圆节点，标出步骤编号和耗时。上下文顶部构成及每步变化来自同一份
请求构成记录，不再把 provider 的未缓存输入计费量称为上下文增量。
逐步视图按本轮请求变化选取自身刻度，并在图中明示，与总览的每轮刻度区分。
耗时、上下文勾选在总览与逐步视图之间保持同步。裁短详情列出原工具返回的 seq、
原轮次/步骤和裁短事件 seq，不把时间接近当成绑定依据。

## 视觉一致性

action-view.js 使用原有 stepIcon 图标，统一到总览的主线、来源色和文字样式。
上下文柱在两个视图中都以主线为零点，增加向上、减少向下，动作节点保持可点选。
轮次与步骤标题使用同一种细线括号；选中态用实线描边与浅色光圈。
短路径居中，长路径仍可横向查看；原始记录入口、键盘点选、自动进入和原位返回保留。
底部详情缩为紧凑信息条，visual-unity.css 统一两个视图的字体、线条、图例和间距。

底部进一步展示基于记录的步骤解释：本轮问题/此前返回、具体操作对象、实际结果，
以及后续步骤入口。step-insight.mjs 独立实现规则，从完整本地日志提取有界事实，
避免对已截断 JSON 猜计数。修改展示目标与可展开的改动片段；失败片段标为原计划，
成功只在工具明确确认时说明。命令输出中的 PASS 只称为输出报告。
恢复链接使用现有完整参数匹配的 failedSeq/successSeq，不根据相邻同名工具推断。
“接下来”仅表达记录顺序，不推断模型采用了此前结果，也不评定用户任务已完成。
DSH 一步覆盖模型回应和随后一批工具操作，且可能包含请求重试；不把一步等同于一个工具调用。

    node docs/demo/layout-review/step-insight-test.mjs

步骤下方按“操作标题 → 实际结果 → 后续入口”排版，前后文、构成数值和判断依据收进独立详情。
改动对比改用固定浮层；保留缩进，以原/新片段行号和红绿差异行显示，支持展开未变化内容。
只比较该工具请求中的替换片段，不声称是整文件 diff；失败或结果缺失时标为原计划。
从完整本地记录提取片段，每侧最多 600 行 / 48000 字符，超过时明确注明截取范围。
diff-model.mjs 独立计算逐行差异；step-detail.js 提供关闭、Esc、焦点返回和详情内返回。
ResizeObserver 只响应宽度变化，同一步说明不随图重绘替换 DOM，避免高度变化重置阅读状态。

    node docs/demo/layout-review/diff-test.mjs

## 新版官方读取入口（0.2.2-alpha.2）

已对照本机全局安装的 dsh-experimental-client-ui-stats，而不是较旧的 _refs 克隆。
official-reader.mjs 是在 DSH View 内使用的窄读取层，不注册 Host 服务或统计路由：

    const reader = createOfficialReader(ctx, sessionId);
    // inject.hooks: { stats: reader.stats, trajectory: reader.trajectory }
    // 组件通过框架生成的 useStats 读取；卸载时调用 reader.dispose()

stats 源直接来自 ctx.uiConversation.binding(sessionId).target('stats')。
不复制它的六个 Definition、折叠或 SnapshotBuilder。历史分页复用
ctx.sessions.binding(sessionId).session.loadOlder()；官方全量合计由标准
useProjection('sessionStats')、useProjection('tokenUsage') 提供。
stats.context 不等于 Context 的七类来源分解，来源分解仍可读取已有 Context projection，
不为它另建数据接口。窗口数据未就绪用 undefined，不能当成全会话空数据。
官方 contextBreakdown projection 目前仅分 systemTokens、toolsTokens、messageTokens，
且是当前构成，不是按轮保留的七类历史分解。

文件变更坐标使用官方 turnLocation.data.get('deliverables')?.changes?.seq，
客户端同源读取 api/changes.summary?sessionId=...&seq=...，按原数组下标读取
api/changes.diff?sessionId=...&seq=...&index=...。Host 对应 workspaceChanges.summary/diff。
直接打开官方差异侧栏使用 sidebarRight.openResource：

    dsh-resource://changes-review/session/{encodeURIComponent(sessionId)}/{seq}/{turn}
    // params: { index: 原摘要数组下标 }

文件统计采用官方轮首/轮末状态对比，不累计工具参数里的 old/new 行数。
保留 total 与被截短 files 列表的区别，并保留 binary/oversized/coarse 状态。
官方摘要及快照随 Host Session 存活，重启后旧轮次可能返回 404；缺失不是“未修改”。
不能用当前 git diff 冒充历史轮次差异。

当前 demo 已增加独立的「文件」勾选层，与上下文共用主图：读取材料在上方，
写入/修改对象在下方。同一路径合成一个对象；同一文件既读又改时主条目放下方，
选中后再显示读取与修改触点。密集文件短条合并为选择入口，触点也随缩放聚合。
点击文件突出相关步骤与受阻枝条，点击步骤反向突出相关文件。
「形成过程」在独立浮层按顺序展示实际返回及错误，可跳到对应行动步骤。
范围内所有文件仍可从底部入口访问，包括图中暂时放不下的条目。

本版数据来自保存日志中可确认路径的直接文件工具操作，不解析 shell 命令来猜读写。
失败操作单独保留，不计入已返回的修改次数。没有把修改次数或替换片段行数当成最终差异。
最终净改动仍应接官方轮首/轮末摘要；新增和删除分开保留，点击文件打开官方侧栏。
官方读取层也尚未接到 60573 的离线输入：它需要 DSH 自身的同源、会话绑定和认证环境。
当前完成的是读取契约和测试，不表示已安装到运行中的 DSH。

    node docs/demo/layout-review/official-reader-test.mjs
    node docs/demo/layout-review/file-test.mjs

上下文增量详情仅显示 delta 非零的来源；首轮已有构成只显示实际非零项。

浏览器已实际验证：第 35 轮受阻跳到对应行动步骤；从行动路径返回保留 4× 和横向位置；
第 6、8 轮的聚合入口放大后分成两条原样分叉。

信息转化参考了本机第三方 dsh-context 的 brief.ts、callSummary.ts、
fileOps.ts 和 commands.ts：把同一轮的输入、动作与结果对齐，
区分动作意图、实际返回与任务完成。没有复制该项目的代码或整套面板。
当前只是基于可核实事件的过程分析，不包含模型质量评分或任务完成度评分。

下文记录第一版预览的运行方式和布局实验；app.js、layout.mjs、
style.css、self-test.mjs 属于那一版，目前首页没有加载。

独立、本地、只读的设计验证页。没有改动 DSH 插件或安装目录。

## 数据与启动

预览使用已安装 DSH 的 /analysis-view/trace?session=… 页面快照。
将页面 HTML 存为 .dsh/layout-review/installed-trace.html 后，在仓库根目录执行：

    node scripts/build-layout-review.mjs
    node scripts/serve-layout-review.mjs

第二条命令打印本机预览地址。服务只监听 127.0.0.1，仅提供明确列出的预览文件。
真实会话数据、安装版快照和截图都在 Git 忽略的 .dsh/layout-review/ 中。
生成器只向新图提供绘图和证据定位所需的字段，不加载工具参数和正文。
“安装版原图”保留原页面供视觉对照；它是快照，不跟随 DSH 更新。

## 交互

- 当前会话：105 轮快照，16 个 incident、27 次工具失败、8 次请求重试。
- 密集样本：沿用同一时间轴，生成 160 个 incident 和 48 次重试；界面明确标为合成。
- 点击分叉显示每条原始事件，点击重试显示原因、步骤、退避时间和 seq。
- 滚轮缩放、横向拖动、缩略条定位；可用缩放按钮和缩略条方向键完成相同行为。
- 密集聚合可以在详情中逐条查看，也可以放大时间窗口进一步拆开。

## 布局规则

1. 先计算时间坐标，再测量标签。事件锚点不为文字腾地方。
2. 按时间排序，扫描可用区间，最多三层。每个候选位置同时预留文字与连接线通道。
3. 上层标签不能占用已预留的竖线通道。连接线只允许短距离侧移，避免绕到图的边缘再折返。
4. 放不下时合并碰撞附近的相邻展示组，再重新排布；每个组保留完整成员列表，不合并业务事实。
5. 重试使用单独的一行灰色计数标记，按同一算法控制密度。
6. 排布依据整个投影，而非当前可见窗口。平移不重新分组，也不改变节点位置。

在有限空间中，不可能同时展示任意数量的全长标签、维持字号并保持不重叠。
本预览选择保持字号、限制层数，通过带数量的入口和局部放大保留完整访问。
子 Agent 的跨会话支路不在这一版 demo 的验证范围内。

## 验证

    node docs/demo/layout-review/self-test.mjs

检查事件不丢失、锚点不移动、标签不重叠、连接线不穿标签、布局有界、
输入顺序不影响输出，以及放大后解聚合。覆盖空集、单点、同点密集、
千事件和窄画布。
