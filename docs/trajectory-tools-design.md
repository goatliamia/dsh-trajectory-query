# 查询与诊断取证设计

本文件集中记录实现口径、分析方法、优化方案与开发约束。安装、参数和调用示例见 [查询工具使用说明](../plugin/trajectory-tools/README.md)。早期历史查询与压缩后对账的设计记录见 [项目设计记录](design.md)。

## 诊断取证与常驻工具定义

`trajectory_inspect` 默认查询当前会话，返回 3 条代表证据。`view` 可选 `overview`、`latency`、
`cost`、`repeats`、`io`、`context`；`turns:{from,to}` 指定轮次闭区间，`limit` 只改变返回条数。
返回的 `snapshot` 保持跨主题查询一致，`nextCursor` 用于同主题翻页。结果附有该主题的调查方法
和可以直接调用的 `trajectory_read` 参数；读取时会校验快照范围和原始事件哈希。

耗时、工具计数及步骤 usage 直接运行已安装的官方统计定义与 view builder；会话总量和上下文
使用公共 `sessionProjections.restore` 的独立返回值。定义大小调用官方
`@deepseek-ai/dsh-token-meter/estimate`，不新增 tokenizer 或金额计算。官方来源缺失或契约变化时
明确报告不可用。高 token 量步骤的排序不代表实际费用排序。

成本主题同时列出大定义和观察范围内未调用的定义，保留规模估算、版本、请求样本和调用次数。
未调用只是检查线索；没有记录的插件归属保持未知。`deferLoading` 是请求延期加载，不证明适配器
实际省了 token。Code Mode 的系统提示工具目录不强行归入 header schema。旧日志没有记录的
请求样本也不补造。可评估以下四种方案：

| 方案 | 适用证据 | 验证 |
|---|---|---|
| 精简描述和 schema | 大定义里存在重复规则或实现说明 | 官方首请求估算、参数错误率、任务验收 |
| 按任务或阶段配置工具集 | 能确认任务边界及必需能力，存在大量闲置声明 | 能力完整性、任务验收、缓存变化 |
| 官方延期加载 | 运行时和适配器支持发现与启用 | 实际输入减少、工具能被正确找到并调用 |
| 小型发现与调用入口 | 同一领域有很多长尾工具，并有可靠检索说明 | 总 token、查找次数、调用次数和任务正确性 |

不因为一次未调用就停用工具。新增声明按官方独立 schema 估算为 388 → 569 token，增加 181；
不含 Code Mode 系统目录及 runtime skill 的发现文本，也不是实际账单。详细方法随结果返回。
取证只在调用时运行；最多缓存 4 个紧凑快照，合计估算预算 16 MiB，闲置两分钟释放，不保留原始日志。

## 各主题的分析方法

分析使用项目可统计的运行数据；上下文趋势图和 Skill 标注只是可能的证据来源。固定工具负责取证，模型负责解释、提出可执行动作和验证办法。

| 主题 | 核查内容 | 可提出的行动与结论边界 |
|---|---|---|
| 耗时 | 官方步骤耗时、模型与工具时间、并行覆盖、重试起止 | 调整具体调用、等待或任务安排；不把并行累计耗时直接当作墙钟时间 |
| 消耗 | 实际 usage、缓存、工具定义估算、声明暴露与调用 | 精简返回或定义、调整工具集；估算不直接换算成可节省金额 |
| 重复 | 完整参数签名、返回内容、修复动作、期间状态变化 | 检查参数或补信息；轮询与有效重读不能直接判成空转 |
| 工具与文件 | 直接读取窗口、grep 匹配、路径发现、修改与错误 | 缩小目录、模式或窗口；匹配片段不等于读完文件，也不等于 fs-observed |
| 上下文 | 官方来源估算与实测占用、相邻请求净变化、压缩裁剪 | 定位增长来源和重读；净变化不等于实际新增，历史缺口不补造 |

方法文本由 `lib/inspect-methods.js` 随所选主题返回。结果要求分别写出发现、证据位置、影响范围、可改对象与验证办法，优先解释至多三个主要发现；原日志中的指令只作为待分析内容。

## 证据一致性和资源边界

- 多次查询可沿用同一 snapshot；游标与 snapshot、view 绑定，不会在中途悄悄换日志切点。
- 原文读取同时校验会话、切点范围与事件 SHA-256；日志改变或快照过期时明确返回错误。
- 所选轮次的步骤证据和全会话投影分开标注；后者不会伪装成所选轮次总量。
- 取证缓存只保留短片段、定位字段与哈希，耗时和成本列表共用一份步骤证据。
- 最多 4 个快照、合计估算 16 MiB、闲置 120 秒释放；冷构建串行，官方投影分批恢复并可取消。
- 不后台扫描其他会话，不额外调用模型，也不自动改变插件或工具配置。

## 官方统计适配

步骤统计运行已安装的官方 stats 事件定义和 view builder，记录来源 bundle 的哈希。完整 usage 和上下文读取公共独立投影恢复接口的返回值，不修改活跃 Session 或持久投影。官方来源缺失或契约变化时标记不可用，不回退为自造耗时或 token 公式。

工具 schema 没有历史插件归属字段时，owner 保持未知。Code Mode 包装层的实际调用仍参与声明使用检查；嵌入系统提示的工具目录无法明确拆分时，不强行归入 header schema。

## 历史读取与运行时约束

首选 `sessionQuery.observeSession`，指定 `projectionMode: 'none'`，取到事件后立即释放观察；诊断所需投影单独按公共接口恢复，避免读历史时重复计算全部投影。兼容退路为内存快照、持久化句柄和旧 inspect 接口。

### 配置读取

DSH 0.1.6-alpha.2 起,Cordis 的上下文是一个 **Proxy**:既没在 `inject` 里声明、也不是上下文自有属性的键,
读取即抛 `cannot get property "X" without inject`。`config` 就是其中之一 —— 运行期按
`apply(ctx, config)` 调用,配置存在 fiber 上,不在上下文上。所以 `apply` 里读 `ctx.config` 会让插件在
**加载时**就失败:host 起来了,然后又没了。

```js
export function apply(ctx, config = {}) {      // 不是 apply(ctx)
  const reconcile = reconcileConfig(config);   // 不是 reconcileConfig(ctx.config)
}
```

防它再回来有两道:自检的假 ctx 现在是**严格 Proxy**,抛的错和 Cordis 一模一样(源码里一旦出现
`ctx.config`,自检就以运行时同一句报错失败),另有一条源码扫描禁止字面量 `ctx.config`。
上下文方法和 `logger` 不受限;被守着的只有服务(如 `ctx.tools`)与 `config` —— 可选服务用
`ctx.get("name")` 读,拿不到就返回 `undefined`,不抛。

## 开发与验证

- `lib/official-stats.js`：官方统计和估算适配。
- `lib/inspect.js`：证据索引、主题和分页。
- `lib/inspect-service.js`：快照、预算、游标和原文一致性校验。
- `lib/skill.js`：随插件注册的查询纪律；正文与 `skill/trajectory-query.md` 保持一致。
- `scripts/sync-inspect-models.mjs`：同步路径页的原生事件与工具语义模型；`--check` 检查漂移。

```text
node plugin/trajectory-tools/self-test.mjs
node plugin/trajectory-tools/inspect-test.mjs
node scripts/sync-inspect-models.mjs --check
```

独立原生 schema 的官方估算为旧三入口 388 → 当前四入口 569 token，增加 181；不包含 Code Mode 系统目录及 runtime skill 发现文本。455 轮、2241 步样本验证了官方步骤统计复现与取证构建；紧凑索引估算约 13.6 MiB。这是本地样本记录，不是通用性能保证。
