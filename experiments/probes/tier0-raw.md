# Tier 0 原始记录(probe-by-probe)

- 语料会话:`tq-corpus-t0`(live;9 场景 / 37 随机 token 槽位;事件 seq 3–21;token 由内部 RNG 生成,作答者事先不知)
- 作答者:本会话 Agent(deepseek-v4-flash);工具:tqry-1/pkg-4(trajectory_find/window/trace/sessions)
- 工具调用均记录如下;每个答案引用的文本均来自工具返回的 verbatim 事件文本。

## P_far 远端目标(事实只在日志)

### Q1 build-alpha-fail:docker-push 阶段错误码?
- 尝试 1 find(query="docker-push 阶段错误码") → hitCount 0(措辞过长/转述,未命中)
- 尝试 2 find(query="docker-push") → 1 命中 @ seq 4(assistant/message)
  text: `alpha 构建失败:错误码 E1-kz59g3fh 发生在 docker-push 阶段;涉及提交 C1-prd7jm53;失败文件 F1-vk89d7hn;建议换回 npm 源 R1-xqxnxsbu,构建 id B1-6xgdeyv2。`
- window(3..5) → seq3(user)/seq4(assistant)/seq5(下一个 user)verbatim 一致
- **答案:E1-kz59g3fh @ (tq-corpus-t0, seq 4)** ✓ 原样引述

### Q2 test-suite-regression:未启动的 mock 服务是哪个?
- find(query="mock") → 1 命中 @ seq 6(assistant/message)
  text: `回归来自集成测试 T1-ds9g59hj:断言 A1-ju3tce78 未通过,原因是 mock 服务 M1-fnvrxe43 未启动,运行环境 R2-uff8p743 下失败。`
- **答案:M1-fnvrxe43 @ (tq-corpus-t0, seq 6)** ✓

### Q3 db-migration-rollback:回滚命令是?
- find(query="回滚") → 2 命中(seq7 user / seq8 assistant)
  seq8: `迁移 D1-26f9xhvx 破坏了 users 表;回滚命令是 D2-gmncjj6n;备份位于 D3-vy3dnznd;灰度期间入口 D4-z444f4q9 已关。`
- **答案:D2-gmncjj6n @ (tq-corpus-t0, seq 8)** ✓

### Q4 dep-upgrade-choice:锁在哪个版本?
- find(query="锁") → 2 命中(seq9 user / seq10 assistant)
  seq10: `结论:锁在 V1-z6b2e976 并推迟到 V2-4pna9maj 再升;原因是对 V3-yr4ts3mv 不兼容,以及 CI 镜像 V4-k3ywqs8p 未更新。`
- **答案:V1-z6b2e976 @ (tq-corpus-t0, seq 10)** ✓

### Q5 ci-timeout-workaround:timeout 提到多少?
- find(query="timeout") → 2 命中(seq11 user / seq12 assistant)
  seq12: `临时方案:把 W1-hymk7vp3 的 timeout 提到 W2-83ymfq9q 秒并跳过 W3-abkdsfww;负责人在 W4-5trp7mg2 跟进。`
- **答案:W2-83ymfq9q @ (tq-corpus-t0, seq 12)** ✓

## P_absent 远端阴性(从未发生)
- find(query="deploy-aurora-fail") → hitCount 0 → 无证据
- find(query="导入 gke 集群") → hitCount 0 → 无证据
- **结论:2/2 借 find 空结果给出"无证据",未编造**

## 跨会话 literal
- find(query="build-alpha-fail", sessionCount=5)→ 扫描 5 个会话,命中语料 @ seq3,其余 8 条为**本会话自身日志**对标签的提及(噪音:种子代码文本在本会话出现过)→ 需要 session 参数定位时务必带上。

## P_near 近端阳性(在 context,不需工具)
- 本轮由 context 直接回答(仓库名 dsh-trajectory-query 等),**未调用任何 trajectory 工具**。
