// incident-shape — incidents 这条事实的形状,只有这一份声明(issue #6)。
//
// 为什么住在插件里:运行期 import 不到仓库脚本,所以形状必须跟着包走,由 analyzers/
// **反过来** import 它。包一打出去,两边就是同一个文件 —— 否则"只有一份"只是口号。
//
// 这张表管的是**事实 / wire 形态**:seqs 是 number[]。
// 客户端渲染用的 {seq, callId}[] 是**视图形态**,由 lib/client.js 的 toChips() 一次转换产生,
// 不在这张表里声明 —— 两种形态各自只有一处,混起来就是当初 seqs 有两种类型的由来。
//
// 字段顺序有意义:导出的 JSON 是逐字节比对的对象,key 的插入顺序就是这里的顺序。

export const INCIDENT_FIELDS = Object.freeze([
  Object.freeze({ name: "type", type: "string", means: "incident 种类:retry-loop / error / noop" }),
  Object.freeze({ name: "severity", type: "number", means: "确定性算出的严重度,不是评分" }),
  Object.freeze({ name: "title", type: "string", means: "给人看的一行标题" }),
  Object.freeze({ name: "detail", type: "string", means: "计数与对象" }),
  Object.freeze({ name: "cause", type: "string", means: "机械层成因" }),
  Object.freeze({ name: "runtimeKnew", type: "string", means: "运行期当时知道什么" }),
  Object.freeze({ name: "modelKnew", type: "string", means: "模型当时收到了什么" }),
  Object.freeze({ name: "harness", type: "string", means: "harness 有没有针对性反应" }),
  Object.freeze({ name: "impact", type: "string", means: "这件事的后果" }),
  Object.freeze({ name: "seqs", type: "number[]", means: "证据:事件 seq(事实形态,不是 chip)" }),
]);

export const INCIDENT_KEYS = Object.freeze(INCIDENT_FIELDS.map((field) => field.name));

/** 角色:源(生产事实)/ 像(消费)/ 证人(冻结产物,只读比对)。 */
export const ROLES = Object.freeze(["source", "consumer", "consumer+source", "witness"]);

/**
 * 认领表:探测器找得到的每一个"知道这份形状"的载体,都必须在这里有一条。
 * 法则会反过来问:探测器找到的,声明里都有吗?—— 漏一个参与者,本身就会报错。
 *
 * via 说明它怎么拿到形状:
 *   incident()  = 经过构造器(漏字段/多字段/类型不符当场抛)
 *   literal     = 自己写字面量(浏览器半边 import 不到本模块,只能被法则盯着)
 *   read-only   = 只读比对,绝不参与"保持同步"
 */
export const PARTICIPANTS = Object.freeze([
  Object.freeze({ file: "plugin/analysis-view/lib/incident-shape.js", role: "source", shape: "wire", via: "declaration" }),
  Object.freeze({ file: "analyzers/incidents.mjs", role: "source", shape: "wire", via: "incident()" }),
  Object.freeze({ file: "plugin/analysis-view/lib/index.js", role: "source", shape: "wire", via: "incident()" }),
  Object.freeze({ file: "plugin/analysis-view/lib/client.js", role: "consumer+source", shape: "wire+chips", via: "toChips() + 自有兜底 producer(literal,受法则盯着)" }),
  Object.freeze({ file: "analyzers/shape-law.mjs", role: "consumer", shape: "wire", via: "read-only(法则本身)" }),
  Object.freeze({ file: "experiments/reports/digest-current-session.facts.json", role: "witness", shape: "wire", via: "read-only(冻结产物,不是一方)" }),
]);

/** 一个值是不是声明里的类型。给构造器与法则共用,两边不会各自解释类型。 */
export function typeOk(type, value) {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "number[]") {
    return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
  }
  return false;
}

/** 缺字段 / 多字段 / 类型不符都当场抛 —— 于是"三个分支各写一遍同一批名字"这件事写不出来了。 */
export function incident(fields) {
  const source = fields !== null && typeof fields === "object" ? fields : {};
  const extra = Object.keys(source).filter((key) => !INCIDENT_KEYS.includes(key));
  if (extra.length > 0) {
    throw new Error("incident: 未声明的字段 " + extra.join(", ") + "(声明里只有:" + INCIDENT_KEYS.join(", ") + ")");
  }
  const out = {};
  for (const field of INCIDENT_FIELDS) {
    if (!(field.name in source)) {
      throw new Error("incident: 缺字段 " + field.name + "(声明要求:" + INCIDENT_KEYS.join(", ") + ")");
    }
    const value = source[field.name];
    if (!typeOk(field.type, value)) {
      throw new Error("incident: 字段 " + field.name + " 需要 " + field.type + ",拿到 " + describe(value));
    }
    out[field.name] = value;
  }
  return out;
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "数组(" + (value.length === 0 ? "空" : describe(value[0]) + " 等 " + value.length + " 项") + ")";
  return typeof value;
}

/** 法则用:一个已存在的记录,键集合、顺序、类型是否都合声明。返回错误列表(空 = 合法)。 */
export function shapeErrors(value, path = "incident") {
  const errors = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [path + ": 不是对象"];
  const keys = Object.keys(value);
  if (keys.length !== INCIDENT_KEYS.length) {
    errors.push(path + ": 键数 " + keys.length + " ≠ 声明 " + INCIDENT_KEYS.length + "(" + keys.join(", ") + ")");
    return errors;
  }
  for (let index = 0; index < INCIDENT_KEYS.length; index++) {
    const key = INCIDENT_KEYS[index];
    if (keys[index] !== key) {
      errors.push(path + ": 第 " + index + " 个键是 " + keys[index] + ",声明是 " + key + "(顺序即序列化字节)");
    }
    const field = INCIDENT_FIELDS[index];
    if (!typeOk(field.type, value[key])) {
      errors.push(path + "." + key + ": 需要 " + field.type + ",拿到 " + describe(value[key]));
    }
  }
  return errors;
}
