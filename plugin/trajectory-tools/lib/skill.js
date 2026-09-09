// dsh-trajectory-tools 自带的查询纪律(runtime skill)。
//
// 工具解决"能不能查",这份 skill 解决"该不该查、默认范围是什么、查完怎么引用"。
// 它随插件一起注册到 ctx.skills,不需要改任何 agent preset;正文与仓库 skill/trajectory-query.md 保持一致。

export const SKILL_NAME = "trajectory-query";

export const SKILL_DESCRIPTION =
  "需要过去的信息时(被 compaction 覆盖、很久以前、其他会话/子代理)用 trajectory_* 工具查日志,而不是猜;默认会扫当前会话与 live 会话,引用要带 (session, seq@logId)。";

export const SKILL_WHEN_TO_USE =
  "当你要陈述一件发生在很久以前、已被压缩、或在别的会话/子代理里的事实,且当前上下文没有逐字证据时。";

export const SKILL_BODY = `# trajectory-query(查询纪律 v2)

需要过去的信息时(被 compaction 覆盖、很久以前、其他会话/子代理):**不要猜,先查**。

- \`trajectory_sessions\` — 先拿 session id(当前 / live / 已持久化;\`current\` 标出你自己)
- \`trajectory_find\` — 关键词 / 类型 / seq / 时间找事件,返回 \`(session, seq, type, time)\` + 逐字片段(含 \`matchAt\`)
- \`trajectory_window\` — 按 \`(session, seq 区间)\` 取原文窗口
- \`trajectory_trace\` — 需要关系 / 子代理链时,拉事件引用与谱系

默认行为:

- 不给 session 时,\`find\` 扫描 **当前会话 + 所有 live 会话 + 最近若干已持久化会话**;要查很久以前的已持久化会话,显式传 session。
- 默认过滤注入样板(\`<system-reminder>\` 的 workspace 指令)与 \`trajectory_*\` 自身的调用/结果,避免"查什么就命中自己";要看原始结果时关掉 \`excludeInjected\` / \`excludeSelf\`。

引用纪律:

1. 陈述历史结论时带证据位置 \`(session, seq@logId)\`;logId 由工具返回(\`seq\` 只在同一份日志修订内稳定)。
2. 引文必须**原样**,不改写、不总结事实。
3. 工具返回空 = 日志里确实没有,说"无证据",不要用常识补。
4. 工具只给事实;解释是你的工作,但必须建立在查到的逐字证据上。

\`\`\`text
find(query="test failed")               →  当前会话 + live + 最近会话里的命中
find(session=abc, query="test failed")  →  seq=6430(logId 见返回)
window(session=abc, seq=6430)           →  原始事件
\`\`\`
`;
