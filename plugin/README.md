# plugin(动态 Cordis 插件源码镜像)

运行时通过会话内 `cordis_define`(host 代码)装载;本目录保留一份**源码镜像**,
便于版本化与跨会话重装载。镜像与实际装载的 Package 必须保持一致。

- 类型:host-only(不涉及浏览器 UI)
- 依赖服务:`ctx.sessionQuery`(`ctx.get('sessionQuery')`,可选服务,需判空)、
  `ctx.sessions` / `ctx.agents`(定位当前 session)
- 工具:`trajectory_find` / `trajectory_window` / `trajectory_trace`(实现中)
- 注意:工具注册的生命周期随插件 run;`cordis_stop` / `cordis_undefine` 会撤销注册。

文件约定:`index.js` = 单一来源(cordis_define 的 host 函数体原文)。
