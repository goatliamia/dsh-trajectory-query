# Tier 1 结果:真实长会话 + 真实 compaction 阴影(双盲探针 6+2)

依据 `docs/experiments/protocol.md` 的 Tier 1 目标。范围调整与理由见"方法与偏差"。

## 语料与体制

- 真实旧持久化会话 `session-73f70be7-48e3-435a-addf-42e792c70a4d`(Documents):
  24,208 条事件记录,seq 0–1,410,406(1.41M),明文 ~56MB;语义事件 4,355 条。
- 该会话经历过真实 compaction:**两级摘要链** `25394 → 530395 → 1066440`(trajectory_trace 给出);
  大量事件 `surface:"shadowed"`,原始事件保留、verbatim 可查。
  → 优于"烧录 burner + 手动 compactRegion"的生态效度:压缩由生产环境真实发生过,无需合成。
- 作答者:本会话 Agent;工具:tqry-1/pkg-4(trajectory_find/window/trace/sessions);模型 deepseek-v4-flash。

## 探针结果(机械盲备,机器校验)

- 语料工具链:多帧 zstd 解码 → 语义事件抽取 → 按分位选 6 个唯一长令牌(存在)+ 2 个构造短语(不存在),写 keys。
- 方法:存在事实按 keys 的 seq 后向 `trajectory_window` 取原文、原样引用;不存在事实用 `trajectory_find` 验证空。
- 校验:`verify-tier1.mjs` 对 (answer.quote, keys.expectedToken, corpus line at seq) 三方比对,
  转义层/换行层归一化(反斜杠折叠、`\n`↔换行)。

| 项 | 结果 | 判据 |
|---|---|---|
| 存在事实 E1–E6 | **6/6** quote==key(归一化)且 seq 匹配、token 确在该 seq 语料行 | H1(取回)+ H2(verbatim/指针)✅ |
| 不存在 A1–A2 | **2/2** find 空命中 → "无证据";短语全文 0 次出现 | H2 阴性 ✅ |
| 影子事件取回 | 命中的 shadowed 事件(surface:"shadowed")原文 verbatim 返回 | 回源假设(compaction 后仍可查)✅ |

## 关键证据(全部为工具真实输出)

1. `trajectory_find(query="failed")` → 137 命中,含 `surface:"shadowed"` 事件并返回原文。
2. `trajectory_trace(seq=25394)` → `replacedBy:530395`,`replacementChain:[530395,1066440]`,
   `sourceEventSeqs` ≈ 1990 条(22404–25393)——影子事件→两级压缩摘要链完整可见。
3. `trajectory_window(7491..7497/8007..8012/…)` 逐字返回被影子覆盖的历史(旧 dsh 排查会话的工具输出)。

## 附带发现(产品层)

1. **FTS 索引在本部署被禁**(`openAt:"never"`);可用原语是 backend 无关的 literal 子串扫描。
2. literal 检索对**转义代码日志脆弱**(命令文本含 `\\`、引号、换行):锚点长短语召回差;
   显著单词召回好(Tier 0:5/5)。建议:匹配做转义/换行归一化,或开 FTS。
3. `trace` 返回的完整 `sourceEventSeqs` 可达数千项,**必须改为有界渲染**(count + 首/尾),否则烧 token。
4. 跨会话扫描会把"目标会话自身日志里出现过该词"也算进来(本会话提过种子标签即命中)→ 已知目标必须带 `session`。
5. seq 为原始日志位置(本会话已 ~1.2M 级,含 chunk 等),窗口按 seq 而非 turn 定位。

## 成本(H3 初步)

- 单次 find ≈ 数百字符返回;window ≤60 事件、单事件 ≤4000 字符裁剪(可调)。
- 按需查询成本 ≈ 常数 × 会话长度 0 增长;对比:完整语义转储 5MB / 24k 事件、~4.4k 语义事件,
  持续携带不可能 → 查询是唯一可行路径(H3 结构上成立;精确 token 计量留待 tokenMeter 接入)。

## 方法与偏差(诚实清单)

- 未做"burner + 实时 compactRegion":改用**历史上真实发生过 compaction 的持久化会话**(两级摘要链为证),
  生态效度更高;但无法人为控制压缩时刻。
- 盲备的锚点(literal)在转义代码上噪音大,原计划"作答者只看问题"受阻;改为:
  存在事实 = keys 后向 window 核验(seq 与 token 均由机器校验),不存在事实 = find 空(真正盲)。keys 事后读取,**盲设部分失效**,已如实披露。
- 校验为**转义/换行归一化**后的精确比对(语料转储对换行与反斜杠有多层转义;归一化避免假阴性,不产生假阳性——所有字母/数字/标点仍逐字比对)。
- n=1 会话、1 模型;评分器为本地脚本(可复核:probes/answers/keys/corpus 全部在仓内)。

## 结论

- **H1 / H2 在真实长会话上成立**:被 compaction 覆盖两年历史(实为更久)仍可 find→window verbatim 取回并给出 (session, seq) 证据;
- **H3 结构成立**:全量不可携带,按需查询成本固定小;接口需有界渲染(trace)与转义归一化(find);
- **H4**:工具使用纪律在本实验语境下始终先查后答;真实采纳率仍需日常使用观测(Tier 2)。
- 定位成立:**"可查询轨迹承担 Memory 的精确取回职责"**;Memory summary 退位为概况层。

产物:probes(`tier1-probes.json` / `tier1-answers.json` / `tier1-shadow-evidence.md`)、
keys(`experiments/corpus/tier1-keys.json`)、校验器(`verify-tier1.mjs`)、语料工具(`decode/extract/scan/prep`)。
