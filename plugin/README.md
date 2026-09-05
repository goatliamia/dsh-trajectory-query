# plugin(动态 Cordis 插件源码镜像)

运行时插件通过会话内 `cordis_define`(host 代码)装载;本目录保留**源码镜像**作为单一来源。
若运行实例与镜像不一致,以镜像重新 `cordis_define`(新插件或追加包)后 `cordis_run` 即可恢复。

| 文件 | 插件 | 说明 |
|---|---|---|
| `trajectory-tools.js` | `tqry-1`(运行包 pkg-4) | 产品工具:trajectory_find / window / trace / sessions。host-only;依赖 `ctx.sessionQuery`(可选 get);FTS 在本部署被禁(`openAt:"never"`),find 走 literal 子串(`filterEvents`) |
| `corpus-seed.js` | `tqcs-2`(运行包 pkg-5) | dev-only:Tier0 语料种子 `tq_seed_corpus`。`inject: ['sessions']`(guard 要求声明) |

约束:

- 工具注册生命周期随插件 run;`cordis_stop` / `cordis_undefine` 会撤销注册。
- 动态代码为 plain JS,无 import/require;只用 builtin(`harness.defineTool/registerTool`)、`ctx.get` 服务与 `ctx.effect` 注册 disposer。
- `harness.defineTool` 要求 `parameters`(对象 schema,须显式 `additionalProperties`)、`output:{schema,render}`、`execute(args,exec)` 返回 lossless JSON。
- `ctx.get('sessions')` 等运行时读取必须先在插件对象声明 `inject`(guard 拒绝未声明读取)。
