# Pi 会话视图

复用项目原有执行路径、文件对象、结果支路、Skill 标注和上下文构成。上方构成可多选，下方增量与总趋势可独立开关并叠加在原图中。

导入原生 Session v3，无需安装 Pi 或读取 Pi 源码：

```sh
node scripts/build-pi-demo.mjs --session /absolute/session.jsonl
node scripts/serve-layout-review.mjs 3086
```

打开 `http://127.0.0.1:3086/pi`。可选 `--leaf ID`、`--capture events.jsonl`、`--out path.html`；模拟日志显式加 `--synthetic`。

不传 `--session` 会生成模拟示例，读取本地 Pi 源仓库的固定 revision 校验格式，页面明确标注“模拟会话”，不调用模型。`--source` 保留为 Pi 源仓库路径参数；默认 `D:/projects/new loop/pi`，固定 revision `ad702637fdf6fbd3f965c5dba0b14bae100b74eb`，包版本 1.4.0。使用 `git show`，不会更新源码工作区。

```sh
node scripts/build-pi-demo.mjs --source /absolute/pi-source
node analyzers/pi-adapter-test.mjs
```

每步表示 assistant cycle，实际 Usage 与可见来源估算分开。仅有历史结果时不补造工具起止时间；容量未知时不生成百分比。写入内容不冒充有旧版本对照的差异。当前未安装或假定 Pi 有原生子代理能力。

真实工具接入与来源边界见 [跨宿主说明](../../portable-analysis.md) 和 [工具安装](../../../plugin/portable-tools/README.md)。页面由当前共享模板构建，无需先生成 Geist demo。
