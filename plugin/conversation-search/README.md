# dsh-conversation-search

右侧栏的「对话搜索」:在当前会话里按关键词找**聊过的内容**,点结果跳到对话里对应的那一轮。

会话很长时,往上翻找一句话很费劲。这个插件把检索放在右侧栏(工作区文件 / 终端 同一排),
结果是"第几轮、你问了什么、命中的那句话",不是一堆日志条目。

## 用

1. 右侧栏的 `+`(或引导页)里选「对话搜索」;
2. 输入关键词,停顿即搜索(大小写不敏感,直接匹配原文);
3. 结果按轮次分组:轮次、这一轮的问法、命中的句子(关键词高亮);同一轮最多列 3 句;
4. 默认只搜你和助手说过的话;要连工具调用/结果一起搜,勾「也搜工具」;
5. 点一条,滚到「对话」里对应的那一轮并短暂描边。

跳转复用对话自己的锚点:先按 `seq` 把历史页加载出来,再找带 `data-chat-turn` 的那一行滚到
视口中间。**当前主区不是「对话」时找不到目标行**,会提示切过去再点一次——对话视图的选择
没有公开的写入口,这一版不替用户切。

## 返回

`GET /conversation-search/search?session=<id>&q=<词>&scope=chat|all&limit=<n>`

```text
{ ok, session, log: { id, events }, query, scope,
  totalMatches, matchedTurns, returnedTurns, truncated,
  turns: [{ turn, prompt, promptSeq, count,
            matches: [{ seq, type, role, time, text, matchAt }] }] }
```

`matchedTurns` 是命中的轮数,`returnedTurns` 是这次返回的轮数(默认 10,上限 30);
`prompt` 是这一轮你说的第一句话(截到 120 字),`count` 是这一轮的命中处数,
`matches` 最多 3 条,`matchAt` 是命中词在片段里的偏移。

## 安装

```text
pnpm pack                            # -> dsh-conversation-search-0.2.0.tgz
# ~/.dsh/profiles/web/package.json: dependencies 增加
#   "dsh-conversation-search": "file:<绝对路径>/dsh-conversation-search-0.2.0.tgz"
#   dsh.profile.bundles 追加 "dsh-conversation-search"
pnpm install                         # 在 ~/.dsh/profiles/web
# 重启 dsh web
```

## 验证

```text
node plugin/conversation-search/self-test.mjs     # 22 项:轮次 / scope / prompt / 片段 / 路由
```
