import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

const string = { type: 'string', minLength: 1 }, integer = { type: 'integer', minimum: 0 };
const turns = { type: 'object', properties: { from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } }, required: ['from', 'to'], additionalProperties: false };
const focus = { type: 'object', properties: { tool: string, file: string, skill: string }, minProperties: 1, maxProperties: 1, additionalProperties: false };
const common = { session: { ...string, description: '原生会话 ID；已绑定当前来源时可省略。' }, snapshot: { ...string,description:'返回的快照 ID，用于续查同一切点。' }, logId: string };
const page = { cursor: string, limit: { type: 'integer', minimum: 1, maximum: 20 }, turns, includeSelf: { type: 'boolean', description: '默认从调用统计中排除诊断工具自身。' } };
const definitions = [
  ['trajectory_inspect', '查询会话统计、步骤、工具文件操作和可见上下文，返回原生标识与原文位置。', { ...page,
    format: { enum: ['summary', 'data'], description: 'summary 默认；data 返回同切点表格；repeats 仅支持 summary。' },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'summary 每页1–20项(默认6)，data每页1–500行(默认250)。' },
    view: { enum: ['overview', 'latency', 'cost', 'repeats', 'io', 'context'],description:'overview=总览；latency=耗时；cost=用量与定义；repeats=重复调用候选；io=工具文件；context=可见构成。' }, focus, groupBy: { enum: ['turn', 'tool', 'file', 'definition'], description: 'summary:tool/file 用于 overview、io，cost 的 definition 看当前工具目录与使用；data 仅 io 支持 tool/file，其余保留原始行。不分摊实际用量。' }, sort: { enum: ['time', 'wall', 'input', 'output', 'returned', 'count', 'change'], description: 'data 仅 time，summary 可用本主题的指标排序。' } }],
  ['trajectory_search', '查询 sessions、events 字面事件、catalog 类型计数或 cost 用量。未绑定的 Codex 可按 cwd 查询官方会话索引；返回原生 ID 和可追读位置。', { ...page, view: { enum: ['sessions', 'events', 'catalog', 'cost'] }, query: string, cwd: { ...string, description: '仅用于 Codex sessions；默认当前工作目录。' } }],
  ['trajectory_read', '读取快照中的原文或字段，支持关联调用、返回和后续记录，长字段可续读。', { seq: integer, linked: { type: 'boolean',description:'同时读取关联的调用、返回和后续记录。' }, field: { enum: ['body', 'arguments', 'result', 'text', 'parameters', 'description'] }, offset: integer, maxChars: { type: 'integer', minimum: 100, maximum: 24000 } }],
  ['trajectory_graph', '查询调用、返回及会话父子关系，保留原生标识。', { seq: integer, mode: { enum: ['relations', 'lineage'],description:'relations=记录关系；lineage=会话父子关系。' } }],
];
export const TOOLS = definitions.map(([name, description, properties]) => {
  const inputSchema = { type: 'object', properties: { ...common, ...properties }, additionalProperties: false };
  const parameters = Type.Unsafe(inputSchema), validator = Compile(parameters);
  return { name, description, inputSchema, parameters, validate(args) { if (!validator.Check(args)) throw Error('Invalid ' + name + ' parameters: ' + JSON.stringify([...validator.Errors(args)].slice(0, 2))); } };
});
export async function executeTool(service, name, args = {}, signal) {
  const tool = TOOLS.find(t => t.name === name); if (!tool) throw Error('Unknown tool');
  tool.validate(args); return service.call(name, args, signal);
}
