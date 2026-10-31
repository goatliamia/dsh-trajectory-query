// Compatibility entry for callers that submit a one-click skill request.
// Analysis knowledge belongs to the skills, never to query responses.
export const ENTRY_PROMPTS=Object.freeze({
 process:'使用 trace-analysis skill 分析指定会话，回答用户的问题。',
 profile:'使用 context-profile skill 分析指定会话的上下文与工具配置。',
});
