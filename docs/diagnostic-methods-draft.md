# 诊断方法评审稿

本稿已整合到正式 skill，方法正文只在源文件维护：

- [综合诊断与专项入口](../skill/trace-analysis/SKILL.md)
- [当前上下文与能力配置剖面](../skill/context-profile/SKILL.md)

评审后删除了工具使用章节和主题参数表；综合诊断直接写入 skill，专项通过链接复用能力取舍、组装与恢复的方法。宿主差异由生成脚本附加。

## 编写依据

方法与本项目“阶段统计—原文—组装与关系”取证能力结合，具体调查模式和建议验证由本稿设计。

- [OpenAI 官方 Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)：参考其用执行过程定位质量、正确性和流程问题的思路。
- [OpenAI 官方 Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：参考其先定义任务成功标准、选择代表性与边界样本、运行对照及校准评价的思路。
- [OpenAI 官方 Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)：参考其同时关注调用往返、可并行工作与用户等待的划分；本稿据依赖关系选择调整对象。
- [OpenAI 官方 Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)：前缀复用要求用于成本调查中的组装检查；其他提供方按各自机制核对，不硬套 OpenAI 的参数、阈值或价格。
