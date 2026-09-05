# Tier 0 结果:H1–H4 判据表

日期:2025(会话内,deepseek-v4-flash)。依据 `docs/experiments/protocol.md`。
信息体制 = 合成 live 会话 `tq-corpus-t0`(9 场景 / 37 随机 token,事实只在日志,不在作答者 context)。

## 判据汇总

| 假设 | 判据 | 结果 | 判定 |
|---|---|---|---|
| H1 回源召回:远端事实可找回 | P_far ≥ 8/10 正确 | **5/5** 精确 token 找回(每个答案带 (session,seq),引文 verbatim) | ✅ |
| H2 证据保真 | 断言可被 (session,seq) 支撑;引文逐字;阴性"无证据" ≥ 8/10 | 5/5 引文=事件原文逐字;P_absent **2/2** 空结果→无证据,未编造 | ✅ |
| H3 经济性(修正版) | 按需查询边际成本小、不随会话长度增长 | 每探针平均 1–2 次 find、返回数百字符;整轮 8 问约 10 次工具调用(见下成本估算) | ✅(弱) |
| H4 采纳(软) | 目标不在 context 时用查询而非猜 | 5/5 远端探针先 find 后作答;近端探针(在 context)0 次工具调用 | ✅(软,见局限) |

## find recall(自然措辞 vs 原文)

| 探针 | 尝试措辞 | 结果 |
|---|---|---|
| Q1 | `docker-push 阶段错误码`(转述短语) | 0 命中 ✗ |
| Q1 | `docker-push`(句中显著词) | 命中 ✓ |
| Q2–Q5 | `mock` / `回滚` / `锁` / `timeout`(单个显著词) | 各 1–2 命中,均含正确事件 ✓ |

→ **证实协议里的隐藏瓶颈**:literal 子串检索对"转述长短语"recall≈0,对"句中显著单词"recall 高。
thin skill 必须教猜词纪律(先用显著词,再放宽/换词/按 type·seq 过滤),或 find 需自动拆词重试。

## 成本估算(近似;未接 tokenMeter,按返回字符数/2 估 token)

| 项 | 字符(约) | token(约) |
|---|---|---|
| 5 个 P_far 全程(find+window) | ~5.5k | ~2.8k |
| 2 个阴性 + 1 跨会话 | ~1.8k | ~0.9k |
| 合计(8 问 + 冒烟) | ~7.5k | ~4k |

对照:目标事实若持续携带在 context(会话数千~数万事件),成本随会话线性增长;按需查询成本≈固定小常数。
→ H3 倾向成立,但需 Tier 1 用 tokenMeter 精确对比"compaction 摘要+查询" vs "不压缩全量"。

## 重要环境发现

1. **本部署 sessionQuery 的 SQLite FTS 索引配置为 `openAt:"never"`** → `searchEvents/searchSessions` 抛
   `session search is disabled`。可用的精确原语是 provider-independent 的 **literal 子串扫描**
   (`filterEvents`,大小写不敏感、空白灵活)。工具已按此实现并回退。
   → 推论:query 层必须设计成"backend 无关"或带多级回退,不能假设 FTS 在位。
2. 跨会话扫描会带回**目标会话自身的文本**(种子代码在本会话日志中出现),噪音真实存在 → 已知目标时应带 `session` 参数。
3. seq 是**原始日志位置**(含 chunk/边界),跨度大(本会话已 ~9.6 万事件),window 需按 seq 而非 turn。

## 局限(诚实清单)

- 单臂单模型(n=1 会话、5 远端+2 阴性);每问 1 次(未做 ≥3 次重复)。
- 无外部双盲评分子代理:评分为"随机 token 精确串匹配 + verbatim 复核"(客观性强),但工具访问只在本会话内,独立盲评不可行;原始记录已落盘 `experiments/probes/tier0-raw.md` 可供复核。
- H4 未隔离"纯工具 vs 工具+skill"(本体制下任务指令含纪律)。
- 语料为种子合成事件,不覆盖 compaction 真实摘要泄漏/真实 tool result 长文本形态。

## 结论与下一步

- **H1/H2 成立;H3 倾向成立;H4 软证据成立** → Tier 0 全绿,按目标进入 **Tier 1**:
  burner 真实会话 + `compactRegion` 真实压缩 + tokenMeter 成本对比 + 独立盲评(rubric 子代理),并验证回源地基(compaction 后事件仍在、seq 稳定)。
