# dsh-analysis-view

A resident **Analysis** tab for the DSH Web GUI that turns a session's trajectory into a
**runtime incident view** — what happened, and why the harness reacted (or did not).
DSH Web GUI 常驻「分析」标签:把一次会话的轨迹组织成 **runtime incident view**——
系统发生了什么、以及 Harness 为什么这样反应。

0.10.31 起，Web 端可用 `/trajectory` 直接打开当前会话的路径与上下文页；这是客户端动作，不发送分析提示词或调用模型。

0.10.32 合入来源多选与总趋势图层。总趋势默认关闭；共享资源与独立宿主视图同步，保留已做的缓存、可见区域裁剪和折线压缩。

English | [中文](#中文)

---

## English

### What it is

A DSH Web GUI plugin providing **Analysis** and **Path** views for the current conversation.

### What the tab shows

- **KPI strip** — turns · tool calls · failures · cache hit · events, one number per cell.
- **Turn map** — one proportional band per turn (width by duration, colour by that turn's failure
  count); a turn with failures jumps to the Trajectory tab (`openView("trajectory", callId)`).
  The legend is printed; no unlabeled colours.
- **Spend** — per turn, two bars: the reused prefix (cache hit) beside what was actually processed
  fresh (miss), with output on its own bar; each turn's hit rate sits on the right and turns amber
  below 90%. The list scrolls and starts at the newest turn. When every request came from the official
  DeepSeek API (`deepseek-flash` / `deepseek-v4-pro`), the right side of the summary shows the official
  unit prices for miss / hit / output plus a total, with the peak/off-peak schedule already applied;
  anything else shows no price at all.
- **Tools** — three rings show categories, tools and calls per turn. Selecting a category or tool updates the related rings.
- **Incident cards** — only *evidence-backed* incidents. Each card is a causal chain:
  `Cause / Runtime knew / Model received / Harness response / Impact`, with evidence `seq` chips
  that jump to the Trajectory tab.
- **Interpretation** — click to request an explanation from the current default model.
  It consumes tokens and includes evidence citations. It is not run until requested.

The Analysis tab appears next to Conversation and Trajectory.



### Install (permanent, not a dynamic plugin)

Dynamic plugins are session-scoped and vanish on reload; this one is installed into the web profile.

```text
1. pnpm pack                      # -> dsh-analysis-view-0.10.31.tgz
2. add to ~/.dsh/profiles/web/package.json:
     dependencies:  "dsh-analysis-view": "file:<abs path>/dsh-analysis-view-0.10.31.tgz"
     dsh.profile.bundles: append "dsh-analysis-view"
3. pnpm install                   # in ~/.dsh/profiles/web
4. rebuild / restart `dsh web`    # so the new client module enters the bundle
```

### Path view

Open the **Path** tab to browse the session overview and individual turns.
Context composition, file history, tool results, subagent branches and Skill records are available
from the page. Tool parameters and results open in the detail drawer.

The page appears in stages: the real trunk appears first, followed by details and other layers.
Selecting a turn gives its details priority. Viewport, zoom and selection remain while data arrives.
When older context data is outside the current range, use **Load earlier increments**.

The standalone `GET /analysis-view/trace?session=<id>` URL returns a self-contained snapshot.



### Verify

- Refresh the GUI → the **分析** tab renders the work path for the current session.
- If it is blank, check the browser console for the first error.
- Panel render: `node plugin/analysis-view/self-test.mjs` (must print `ALL PASS (21 checks)`); it
  executes the real component tree against a React shim, so no browser is needed.
- Analyzer semantics: `node analyzers/self-test.mjs` (must print `ALL PASS`).
- Shape contract: `node analyzers/shape-law.mjs` and `node analyzers/shape-law.mjs --mutate`
  (both must print `ALL PASS`; the second one prints `CAUGHT` per mutation).

### Limitations

- Missing official statistics or context data is shown as unavailable; other available content remains accessible.
- Earlier context may require an explicit history load.
- Model interpretation is optional and consumes tokens.
- Price display is limited to the supported official API models.

---

<a id="中文"></a>
## 中文

### 这是什么

为 DSH Web GUI 的当前会话提供「分析」和「路径」视图的插件。

### 面板内容

- **KPI 条**:轮次 · 工具调用 · 失败 · 缓存命中 · 事件,一个数字一格。
- **轮次地图**:一条按时长分宽的比例带(颜色按该轮失败数);有失败的轮次点击切到「轨迹」
  (`openView("trajectory", callId)`);图例直接写在界面上。
- **花费**:每轮两条——命中(复用的前缀)与未命中(真正新处理)并排画,输出单独一条;右侧是这一轮的
  命中率,低于 90% 标警示色;列表可滚动,默认停在最新。走官方 API(deepseek-flash / deepseek-v4-pro)时,右边按官方价目给未命中 / 命中 / 输出的单价与总价,峰谷已计入;不是官方 API 就不显示价格。
- **工具**:三个环并排——类别 → 该类工具 → 这个工具用在哪些轮;三张默认都在(取最大类别与它的第一名工具),
  点类别或工具只切换后两张;类别色不用红,红只留给错误。
- **Incident 卡片**:只列**有证据**的 incident,每张是一条因果链
  `Cause / Runtime 知道 / Model 收到 / Harness 反应 / 影响`,并带证据 `seq` 徽章。
- **解读**：点击后由当前默认模型解释，消耗 token，并附证据引用。默认不调用；输出达到上限时显示「已截断」。

「分析」与「对话」「轨迹」位于同一排标签。



### 安装(常驻,非动态插件)

动态插件是会话级、刷新即失;这个是装进 web profile 的常驻插件。

```text
1. pnpm pack                      # 生成 dsh-analysis-view-0.10.31.tgz
2. 在 ~/.dsh/profiles/web/package.json 中:
     dependencies 增加 "dsh-analysis-view": "file:<绝对路径>/dsh-analysis-view-0.10.31.tgz"
     dsh.profile.bundles 追加 "dsh-analysis-view"
3. 在 ~/.dsh/profiles/web 下执行 pnpm install
4. 重建/重启 `dsh web`,让新的 client 模块进入前端包
```

### 路径页

打开「路径」标签，可浏览全景与逐轮行动路径，并查看上下文构成、文件历史、工具结果、
子代理和 Skill 记录。点击工具即可在详情中查看参数和结果。

页面分阶段显示：先出现真实主干，再补齐正文和其他图层；选中某轮会优先加载其详情。
补齐数据时保留位置、缩放和选中项。更早的上下文超出当前范围时，可点击「回补更早增量」。

`GET /analysis-view/trace?session=<id>` 可单独打开自包含快照。



### 验证

- 刷新 GUI → 「分析」标签按当前会话渲染工作路径。
- 若空白:看浏览器控制台第一条报错。
- 面板渲染:`node plugin/analysis-view/self-test.mjs`(必须输出 `ALL PASS (21 checks)`);
  它用一个 React 垫片真的执行组件树,不需要开浏览器。
- 路径加载与资源边界:`node plugin/analysis-view/stages-test.mjs`、`node plugin/analysis-view/resources-test.mjs` 与 `node plugin/analysis-view/perf-test.mjs`。
- 分析器语义:`node analyzers/self-test.mjs`(必须输出 `ALL PASS`)。
- 形状契约:`node analyzers/shape-law.mjs` 与 `node analyzers/shape-law.mjs --mutate`
  (都要 `ALL PASS`;后者对每种变异打印 `CAUGHT`)。

### 局限

- 官方统计或上下文数据缺失时会明确显示不可用，已有内容仍可查看。
- 更早的上下文可能需要手动回补。
- 模型解读为可选功能，会消耗 token。
- 费用显示仅适用于已支持的官方 API 模型。

开发文档：[分析面板与路径页](https://github.com/goatliamia/trajectory-tree/blob/main/docs/analysis-view-design.md)。
