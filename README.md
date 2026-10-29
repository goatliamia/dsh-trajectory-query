# dsh-trajectory-query

三个 DSH 插件，把已经写进日志的会话变成随时可取回、查看和分析的东西。

| 插件 | 位置 | 做什么 |
|---|---|---|
| `dsh-trajectory-tools` | host（模型工具） | 四个只读入口：查历史事件、取逐字窗口、看关系链、诊断取证 |
| `dsh-analysis-view` | 「分析」与「路径」 | 当前会话的轮次、花费、工具、incident、一次按需解读,以及完整的执行路径页 |
| `dsh-conversation-search` | 右侧栏 | 在当前会话里搜关键词，点结果跳到对应轮次 |

不改 DSH core，不写回会话，不新增埋点。更多文档见 [docs/](docs/)。

## 环境

- DSH 0.2.1-rc.3，Web GUI
- Node.js 18+
- profile 默认在 `~/.dsh/profiles/web`

## 安装

三个包都是本地文件依赖，不发布 npm。

```bash
# 1. 打包（各自目录里执行）
cd plugin/trajectory-tools    && pnpm pack
cd ../analysis-view           && pnpm pack
cd ../conversation-search     && pnpm pack
```

把打出的 `.tgz` 放到一个固定目录（例如 `~/Documents/plugins/`），然后在 `~/.dsh/profiles/web/package.json` 里加依赖和 bundle：

```jsonc
{
  "dependencies": {
    "dsh-trajectory-tools": "file:/绝对路径/dsh-trajectory-tools-0.4.0.tgz",
    "dsh-analysis-view": "file:/绝对路径/dsh-analysis-view-0.10.30.tgz",
    "dsh-conversation-search": "file:/绝对路径/dsh-conversation-search-0.2.1.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-trajectory-tools",
        "dsh-analysis-view",
        "dsh-conversation-search"
      ]
    }
  }
}
```

```bash
cd ~/.dsh/profiles/web && pnpm install
```

最后重启 `dsh web`。host 侧插件不会可靠热更新，客户端改动刷新页面即可。

## 功能

### 历史查询工具

四个入口按问题划分：

| 工具 | 用途 |
|---|---|
| `trajectory_search` | `view` 必填：`events` 字面命中、`catalog` 计数与范围、`cost` token 成本、`sessions` 会话列表 |
| `trajectory_read` | 按 `seq` 区间取逐字原文，可选 `format: "json"` |
| `trajectory_graph` | 事件的替换 / 引用 / 派生关系，或会话谱系 |
| `trajectory_inspect` | 基于官方统计取证：耗时、消耗与工具定义、重复调用、工具文件、上下文；支持有界结果和同一快照下的原文追查 |

证据优先：每个结果带 `(session, seq@logId)`，引用原样；查不到就是可核验的"没有"。

插件同时注册 `trajectory-query` skill（先查再答、逐字引用）。

**压缩后对账**（默认开）：一次成功的 compaction 之后，在当轮收尾点注入一句"用两行说明你现在理解这件事要做什么、到哪了、下一步做什么"。不想用就把 `config.reconcile` 设为 `false`。

### 分析面板

Web GUI「对话 | 轨迹」旁边的第三个标签：

| 区块 | 内容 |
|---|---|
| 路径(独立标签) | 当前一轮的主线与支路、轮次条、时间轴,加上上下文构成、文件对象、工具结果、子代理与 Skill;点节点看真实事件,数据从 /analysis-view/trace 现场生成 |
| KPI | 轮次、工具调用、失败、缓存命中、事件 |
| 轮次 | 一条按时长分宽的带子，颜色按失败数；点有失败的轮次跳到轨迹 |
| 花费 | 每轮命中与未命中分开画、输出单独一条，右侧是这一轮的命中率；点一行跳到对话对应轮次。走官方 API 时每个数字下面直接给这项花了多少钱 |
| 工具 | 三个环：类别 → 该类工具 → 这个工具用在哪些轮；点选只切换后两张 |
| Incident | 有证据的因果链：Cause / Runtime 知道 / Model 收到 / Harness 反应 / 影响，`seq` 可点 |
| 解读 | 按钮触发，host 用当前模型调一次，每条陈述带引用 |

提供以下只读接口：

```text
GET /analysis-view/digest?session=<id>      # 确定性事实，2 秒缓存，&fresh=1 强刷
GET /analysis-view/interpret?session=<id>   # 按需解读，会消耗一次模型调用
GET /analysis-view/trace?session=<id>       # 「路径」整页(自包含 HTML)，按日志版本缓存
GET /analysis-view/trace?staged=1&session=<id> # 「路径」真实页面分层显示，正文和图层自动补齐
GET /analysis-view/trace-data?session=<id>&stage=core # 分阶段数据；后续阶段携带同一个 cut
```

### 对话搜索

右侧栏与「工作区文件」「终端」同一排。按关键词找当前会话里聊过的内容，结果按轮次分组；默认只搜人和助手说的话，勾「也搜工具」连工具结果一起搜。点一条滚动到对话里对应的那一轮。

```text
GET /conversation-search/search?session=<id>&q=<词>&scope=chat|all
```

## 用法

```bash
# 模型侧：装好后在对话里直接调用
trajectory_search(view="sessions")                    # 有哪些会话
trajectory_search(view="events", query="<字面词>")     # 命中带 seq / logId
trajectory_read(session=<id>, seq=<命中 seq>)          # 逐字上下文
trajectory_graph(session=<id>, seq=<命中 seq>)         # 引用 / 替换 / 派生链
trajectory_search(view="cost", session=<id>)          # token 与缓存

# 人看面板：Web GUI 的「分析」标签，或直接取路由
curl "http://127.0.0.1:3080/analysis-view/digest?session=<id>"
```

## 自检

```bash
node analyzers/self-test.mjs                    # 分析器语义
node analyzers/host-self-test.mjs               # host 侧 incident / 成本 / 计价
node analyzers/shape-law.mjs                    # incident 形状法则
node plugin/trajectory-tools/self-test.mjs      # 查询工具契约
node plugin/analysis-view/self-test.mjs         # 面板渲染冒烟
node plugin/conversation-search/self-test.mjs   # 对话搜索
```

## 目录

- `plugin/trajectory-tools/`：历史查询工具（host）
- `plugin/analysis-view/`：分析面板（host 路由 + 客户端）
- `plugin/conversation-search/`：对话搜索（host 路由 + 客户端）
- `analyzers/`：确定性分析器、digest 运行器、自检
- `skill/`：`trajectory-query.md`、`analysis.md`
- `docs/`：技术文档
- `experiments/`：语料、探针与生成的报告

## 版本

| 包 | 版本 |
|---|---|
| dsh-trajectory-tools | 0.4.0 |
| dsh-analysis-view | 0.10.30 |
| dsh-conversation-search | 0.2.1 |

## 许可证

MIT © 2026 goatliamia，见 [LICENSE](LICENSE)。
