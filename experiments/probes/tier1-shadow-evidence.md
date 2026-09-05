# Tier 1 前置实证:真实 compaction 的可查询性(语料 session-73f70be7)

- 语料:旧持久化真实会话 `session-73f70be7-48e3-435a-addf-42e792c70a4d`(Documents,24,208 条记录,seq 0–1,410,406,56MB 明文)。
- `trajectory_find(query="failed")` → 137 命中;多命中 `surface:"shadowed"` 且返回 verbatim 原文
  (如 seq 16698/16700/21009/25394/25396/26455/43268 等,文本为真实工具输出与消息)。
- `trajectory_trace(session, seq=25394)`:
  - target = assistant/message,surface=shadowed;
  - `replacedBy: 530395`,`replacementChain: [530395, 1066440]` → 该段被压缩过**两次**(两级 compaction 摘要);
  - `sourceEventSeqs`: 22404–25393(约 1990 个被摘要的原事件,仍可按 seq 取回)。
- 结论性证据:
  1. 真实会话中 compaction 已发生(先前的记录格式扫描 surfaceReplace=0 属误判,compaction 元数据在事件关系层而非记录顶层字段);
  2. **被 compaction shadow 的事件依然 verbatim 可查**——"回源假设"在真实数据上成立;
  3. `trace` 给出的正是设计想要的"事件→摘要链"。
- 产品缺陷记录:trace 返回完整 `sourceEventSeqs`(上千项)会烧 token;工具层应改为有界渲染
  (count + 首/尾若干),这是 H3 经济性在真实数据上暴露的接口问题。
