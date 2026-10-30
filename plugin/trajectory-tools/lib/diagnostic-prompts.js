// Small task entries. Subject methods and report rules are loaded by inspect,
// not copied into every first-turn prompt. No tool is registered by this module.
export { INSPECT_METHODS, INSPECT_OUTPUT_RULE, METHOD_VERSION } from './inspect-methods.js';

export const ENTRY_PROMPTS = Object.freeze({
  process: '分析指定会话的执行过程，回答用户提出的问题。先理解目标、主要投入和结果；综合问题从 trajectory_inspect 的 overview 开始，明确的局部问题直接查对应主题。沿用 snapshot，按返回的方法选择范围与对象，优先使用 reads、body 和 nextRead 取得有关联的行动与反馈。围绕会改变下一次做法的重要发现形成判断，按共同报告规则交付；不要求遍历全部主题。',
  profile: '分析指定会话当前可确认的上下文构成、能力用途和保留价值。先用 trajectory_inspect 的 cost 取得同切点的构成、定义与用量线索，再按需要查看 context 或工具分组。静态切点与历史使用范围分别说明；历史声明清单作为历史证据，当前有效工具与 SDK 以宿主实际组装或明确提供的作用域快照为准。先解释已有材料支持什么工作，以及哪些开销值得保留，再按共同规则判断调整。规模和低频不直接支持替换，涉及能力或调用契约变化时核对受影响场景。只使用实际提供的取证入口。',
});
