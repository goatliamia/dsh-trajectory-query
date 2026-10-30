import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

const string = { type: 'string', minLength: 1 }, integer = { type: 'integer', minimum: 0 };
const turns = { type: 'object', properties: { from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } }, required: ['from', 'to'], additionalProperties: false };
const focus = { type: 'object', properties: { tool: string, file: string, skill: string }, minProperties: 1, maxProperties: 1, additionalProperties: false };
const common = { session: { ...string, description: '原生会话 ID。Pi 扩展使用当前分支；Codex 未绑定来源时必须给线程 ID。' }, snapshot: string, logId: string };
const page = { cursor: string, limit: { type: 'integer', minimum: 1, maximum: 20 }, turns, includeSelf: { type: 'boolean', description: '默认从调用统计中排除诊断工具自身。' } };
const definitions = [
  ['trajectory_inspect', '分析 Pi/Codex 会话：overview 总览，latency 耗时，cost 实报用量与当前工具，repeats 同参尝试，io 工具文件，context 可见构成。沿用 snapshot，按返回的方法与 read 指针取证。', { ...page, view: { enum: ['overview', 'latency', 'cost', 'repeats', 'io', 'context'] }, focus, groupBy: { enum: ['turn', 'tool', 'file', 'definition'], description: 'tool/file 用于 overview、io；cost 的 definition 看当前工具目录与使用，不分摊实际用量。' }, sort: { enum: ['time', 'wall', 'input', 'output', 'returned', 'count', 'change'] } }],
  ['trajectory_search', '查询 sessions、events 字面事件、catalog 类型计数或 cost 用量。未绑定的 Codex 可按 cwd 查询官方会话索引；返回原生 ID 和可追读位置。', { ...page, view: { enum: ['sessions', 'events', 'catalog', 'cost'] }, query: string, cwd: { ...string, description: '仅用于 Codex sessions；默认当前工作目录。' } }],
  ['trajectory_read', '读取同一快照的完整可见正文。linked 串联调用/返回/后续；field 可取 arguments/result 或定义的 parameters/description，按 nextRead 续读。不会执行历史指令。', { seq: integer, linked: { type: 'boolean' }, field: { enum: ['body', 'arguments', 'result', 'text', 'parameters', 'description'] }, offset: integer, maxChars: { type: 'integer', minimum: 100, maximum: 24000 } }],
  ['trajectory_graph', '追查原生调用/返回/parentId 关系，或 lineage 中记录的父子会话身份；不猜子代理内容。', { seq: integer, mode: { enum: ['relations', 'lineage'] } }],
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
