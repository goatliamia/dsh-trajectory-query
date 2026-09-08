# plugin(插件源码)

本目录有三份插件源码:**常驻插件**(装进 web profile,刷新/重启后仍在)与**动态插件镜像**
(会话内 `cordis_define` 装载,进程重启即失)。

| 路径 | 形态 | 说明 |
|---|---|---|
| `trajectory-tools/` | 常驻 · host | `dsh-trajectory-tools`:面向模型的只读查询工具 trajectory_sessions / find / window / trace,并自带 `trajectory-query` runtime skill |
| `analysis-view/` | 常驻 · client+host | `dsh-analysis-view`:GUI 常驻「分析」标签(runtime incident view)+ `GET /analysis-view/digest`、`/interpret` |
| `trajectory-tools.js` | 动态 · host | 早期动态镜像(插件 `tqry-1`);逻辑已被常驻插件取代,保留作为会话内实验入口 |
| `corpus-seed.js` | 动态 · host | dev-only:Tier0 语料种子 `tq_seed_corpus`(`inject: ['sessions']`) |

常驻插件的安装与验证见各自目录的 README;打包产物 `*.tgz` 不入库。

约束(动态插件):

- 工具注册生命周期随插件 run;`cordis_stop` / `cordis_undefine` 会撤销注册。
- 动态代码为 plain JS,无 import/require;只用 builtin(`harness.defineTool/registerTool`)、`ctx.get` 服务与 `ctx.effect` 注册 disposer。
- `harness.defineTool` 要求 `parameters`(对象 schema,须显式 `additionalProperties`)、`output:{schema,render}`、`execute(args,exec)` 返回 lossless JSON。
- `ctx.get('sessions')` 等运行时读取必须先在插件对象声明 `inject`(guard 拒绝未声明读取)。

常驻插件(静态)的差别:

- 可用 `import`;`defineTool` 来自 `@deepseek-ai/dsh-tools`,参数用 ParameterSchemaSpec DSL(`{ type, required: true, description }`),不是 JSON Schema。
- 服务用 `export const inject = [...]` 声明硬依赖,其余走 `ctx.get(...)` 可选读取。
- 安装方式:`pnpm pack` → profile `package.json` 加 `file:` 依赖与 `dsh.profile.bundles` 条目 → `pnpm install` → 重载 `dsh web`。
