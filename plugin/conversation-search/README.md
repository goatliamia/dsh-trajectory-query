# dsh-conversation-search

右侧栏的「对话搜索」:在当前会话的事件日志里搜关键词,点结果跳到对话里对应的那一轮。

会话很长时,往上翻找一句话很费劲。这个插件把检索放在右侧栏(工作区文件 / 终端 同一排),
搜到的是日志里的逐字位置(`seq` + 轮次),不是模型猜的摘要。

## 用

1. 右侧栏的 `+`(或引导页)里选「对话搜索」;
2. 输入关键词,停顿或回车即搜索(大小写不敏感,直接匹配日志原文);
3. 结果按出现顺序列出:轮次、事件类型、`seq`、命中处的片段(关键词高亮);
4. 点一条,滚到「对话」里对应的那一轮并短暂描边。

跳转优先复用对话自己的锚点:先按 `seq` 把历史页加载出来,再找对话里带 `data-chat-turn`
的那一行滚到视口中间。**当前主区不是「对话」时找不到目标行**,会提示切过去再点一次——
这一版没有替用户切视图(对话视图的选择没有公开的写入口)。

## 返回

`GET /conversation-search/search?session=<id>&q=<词>&limit=<n>`

```text
{ ok, session, log: { id, events }, query, total, returned, truncated,
  hits: [{ seq, turn, type, time, text, matchAt }] }
```

`total` 是全部命中数,`returned` 是这次返回的条数(默认 20,上限 50);`text` 是以命中点为中心
截的片段,`matchAt` 是命中词在片段里的偏移。

## 安装

```text
pnpm pack                            # -> dsh-conversation-search-0.1.2.tgz
# ~/.dsh/profiles/web/package.json: dependencies 增加
#   "dsh-conversation-search": "file:<绝对路径>/dsh-conversation-search-0.1.2.tgz"
#   dsh.profile.bundles 追加 "dsh-conversation-search"
pnpm install                         # 在 ~/.dsh/profiles/web
# 重启 dsh web
```

## 验证

```text
node plugin/conversation-search/self-test.mjs     # 11 项:大小写 / 轮次 / matchAt / 上限
```
