# dsh-analysis-view(常驻分析 tab)

把"分析"作为 `conversation.view` 的一个同级 tab 常驻进 DSH Web GUI(与「对话」「轨迹」并列)。

## 实现

- 复用 DSH 自身视图框架:`uiConversation.views.register({ target:'analysis', create, isActive })`(最小 snapshot builder,
  让容器能 `activate('analysis')` 而不破坏轨迹视图)+ `conversation.view` occupant(`id:'analysis'`, order 20)。
- 数据:消费轨迹视图的 `useTrajectory` 投影(snapshot 的 turn/groups/cells),确定性 fold 成 digest —— 复用轨迹,
  **人读层**(KPI / turns/tools/errors/现象区/脚注),非模型生成、不改变任何原始事件。
- 前端注意:occupant 缺 view target 会让 DSH 容器协调出错(首次用"只注册 occupant"时把轨迹时间线弄坏的根因);
  必须连 view target 一起注册。

## 安装(常驻,非动态插件)

动态插件会话级、进程内存,刷新/重启即失。要常驻须做成 profile 插件:

1. 打包:`pnpm pack`(本目录)→ `dsh-analysis-view-0.1.0.tgz`。
2. 加入 web profile:`profiles/web/package.json` 的 `dependencies`(file:…tgz)与 `dsh.profile.bundles`。
3. `pnpm install`(profile 下)注册依赖。
4. 重启/重建 `dsh web`,使新 client 模块进入 web 包。

镜像:会话内动态插件 `tqan-3/pkg-8`;本目录为正式来源。
