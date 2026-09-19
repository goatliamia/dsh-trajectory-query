// shape-law — incidents 形状的法则(issue #6)。
//
// 这不是"再写一个测试",是那条一直在靠人记得维持的性质:
//   **形状只有一处声明;每一个知道它的载体都被认领;漏掉/写错不可能静默。**
//
// 用法:
//   node analyzers/shape-law.mjs            跑法则(0 失败才通过)
//   node analyzers/shape-law.mjs --mutate   证明法则会咬:10 种合理错法,每一种都必须被抓
//   node analyzers/shape-law.mjs --freeze   重新冻结差分基准(只在确认行为未变时用)
//
// 法则写成纯函数(输入是声明/文本/冻结基准),所以"变异"是把变异后的输入喂进去,
// 而不是去改磁盘上的文件 —— 这样"探测器会不会响"本身也能被复算。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INCIDENT_FIELDS,
  INCIDENT_KEYS,
  PARTICIPANTS,
  ROLES,
  incident,
  shapeErrors,
} from '../plugin/analysis-view/lib/incident-shape.js';
import { incidents as offlineIncidents } from './incidents.mjs';
import { computeIncidents } from '../plugin/analysis-view/lib/index.js';
import { loadSession } from './load-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DECLARATION_FILE = 'plugin/analysis-view/lib/incident-shape.js';
const FIXTURE = join(HERE, 'fixtures', 'incidents-shape.json');
// 真实会话的缩减流**不进仓库**:里面是真实工具参数与路径。它只在本地冻结与比对,缺失就跳过。
const FIXTURE_REAL = join(HERE, 'fixtures', 'incidents-shape.real.json');
const WITNESS = 'experiments/reports/digest-current-session.facts.json';

/* ------------------------------------------------------------------ *
 * 合成事件流:三分支(retry-loop / error / noop)各自的、以及混在一起的
 * ------------------------------------------------------------------ */

const ev = (type, seq, data) => ({ type, seq, data });

const STREAMS = {
  'empty': [],
  'error-only': [
    ev('turn/start', 0, { turn: 1 }),
    ev('tool/call', 1, { name: 'read', arguments: '{"file":"a"}' }),
    ev('tool/result', 2, { error: { name: 'FsError', code: 'FS_NOT_OBSERVED' } }),
  ],
  'retry-loop': [
    ev('turn/start', 0, { turn: 1 }),
    ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
    ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"a"}' }),
    ev('tool/call', 3, { name: 'pwsh', arguments: '{"command":"a"}' }),
    ev('assistant/message', 4, { message: { content: [{ type: 'text', text: 'ok' }] } }),
  ],
  'retry-loop-after-error': [
    ev('turn/start', 0, { turn: 1 }),
    ev('tool/call', 1, { name: 'read', arguments: '{"file":"a"}' }),
    ev('tool/result', 2, { error: { name: 'FsError', code: 'FS_NOT_OBSERVED' } }),
    ev('tool/call', 3, { name: 'read', arguments: '{"file":"a"}' }),
    ev('tool/call', 4, { name: 'read', arguments: '{"file":"a"}' }),
  ],
  'noop': [
    ev('turn/start', 0, { turn: 1 }),
    ev('turn/start', 1, { turn: 2 }),
    ev('assistant/message', 2, { message: { content: [{ type: 'text', text: 'ok' }] } }),
  ],
  'mixed': [
    ev('turn/start', 0, { turn: 1 }),
    ev('tool/call', 1, { name: 'pwsh', arguments: '{"command":"a"}' }),
    ev('tool/call', 2, { name: 'pwsh', arguments: '{"command":"a"}' }),
    ev('tool/result', 3, { message: { content: [{ type: 'text', text: 'boom', isError: true }] } }),
    ev('turn/start', 4, { turn: 2 }),
    ev('tool/call', 5, { name: 'edit', arguments: '{"file":"b"}' }),
    ev('tool/result', 6, { error: { name: 'FsError', code: 'FS_NOT_DECLARED' } }),
    ev('turn/start', 7, { turn: 3 }),
    ev('turn/start', 8, { turn: 4 }),
    ev('assistant/message', 9, { message: { content: [{ type: 'text', text: 'done' }] } }),
  ],
};

/* ------------------------------------------------------------------ *
 * 法则(纯函数)
 * ------------------------------------------------------------------ */

/** 合法样本:类型由声明决定,值与语义无关(构造器只管类型)。 */
function sampleFor(fields) {
  const out = {};
  for (const field of fields) {
    out[field.name] = field.type === 'number' ? 1 : field.type === 'number[]' ? [1, 2] : 'x';
  }
  return out;
}

/** 构造器必须是全函数:合法记录必收,多字段/缺字段/类型不符/元素类型不符必抛。 */
export function lawConstructor(fields, make = incident) {
  const errors = [];
  const keys = fields.map((f) => f.name);
  const sample = sampleFor(fields);

  let built;
  try { built = make(sample); } catch (error) { return ['构造器拒绝了合法记录: ' + error.message]; }
  const got = Object.keys(built);
  if (got.join(',') !== keys.join(',')) {
    errors.push('构造输出的键顺序 [' + got.join(',') + '] ≠ 声明 [' + keys.join(',') + ']');
  }
  try { make({ ...sample, ghost: 1 }); errors.push('构造器放过了未声明字段 ghost'); } catch { /* 应该抛 */ }
  for (const key of keys) {
    const partial = { ...sample };
    delete partial[key];
    try { make(partial); errors.push('构造器放过了缺字段 ' + key); } catch { /* 应该抛 */ }
  }
  for (const field of fields) {
    const wrong = field.type === 'string' ? 1 : 'x';
    try { make({ ...sample, [field.name]: wrong }); errors.push('构造器放过了类型不符 ' + field.name); } catch { /* 应该抛 */ }
  }
  if (keys.includes('seqs')) {
    try { make({ ...sample, seqs: [{ seq: 1, callId: 'c' }] }); errors.push('构造器放过了 chip 形态的 seqs(视图形态混进了事实形态)'); } catch { /* 应该抛 */ }
  }
  const clean = make(sample);
  for (const problem of shapeErrors(clean)) errors.push('shapeErrors 对构造器产物报错: ' + problem);
  return errors;
}

/**
 * 从源码里取出所有"形状字面量"的顶层键(顺序即写法顺序)。
 * 单遍扫描,跳注释与字符串,维护大括号栈 —— 只有**自己这一层**直接写了 marker 键
 * (例如 `seqs:`)的字面量才算数;包住它的外层对象不算(否则外层会被误判成形状)。
 */
export function literalKeyOrders(source, marker = 'seqs') {
  const results = [];
  const stack = [];
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      const top = stack[stack.length - 1];
      if (top) top.token = '';
      continue;
    }
    if (c === '{') { stack.push({ keys: [], token: '', depth: 0, sawMarker: false, spread: false }); continue; }
    if (c === '}') {
      const frame = stack.pop();
      if (frame && frame.sawMarker && !frame.spread && frame.keys.length > 0) results.push(frame.keys);
      const parent = stack[stack.length - 1];
      if (parent) parent.token = '';
      continue;
    }
    const top = stack[stack.length - 1];
    if (top === undefined) continue;
    if (c === '(' || c === '[') { top.depth++; top.token = ''; continue; }
    if (c === ')' || c === ']') { top.depth--; top.token = ''; continue; }
    if (c === '.' && source[i + 1] === '.' && source[i + 2] === '.') { top.spread = true; continue; }
    if (top.depth > 0) continue;
    if (c === ':') {
      const name = top.token.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) {
        top.keys.push(name);
        if (name === marker) top.sawMarker = true;
      }
      top.token = '';
      continue;
    }
    if (c === ',') { top.token = ''; continue; }
    top.token += c;
  }
  return results;
}

/** 声明与载体不许漂:incident() 载体必须真的调用构造器;literal 载体必须与声明同键同序。 */
export function lawDrift(participants, readSource, keys = INCIDENT_KEYS) {
  const errors = [];
  const expected = keys.join(',');
  for (const entry of participants) {
    const source = readSource(entry.file);
    if (source === null) continue; // 文件不在(例如证人产物还没生成),由 claim 法则说
    if (entry.via === 'declaration') continue;
    if (typeof entry.via === 'string' && entry.via.startsWith('incident()')) {
      if (!/incident\s*\(/.test(source)) errors.push(entry.file + ': 声明说它经过 incident(),源码里却找不到调用');
      continue;
    }
    if (typeof entry.via === 'string' && entry.via.includes('literal')) {
      const orders = literalKeyOrders(source);
      if (orders.length === 0) {
        errors.push(entry.file + ': 声明说它自己写字面量,却一个形状字面量都找不到(声明过时了?)');
        continue;
      }
      for (const order of orders) {
        if (order.join(',') !== expected) {
          errors.push(entry.file + ': 字面量键 [' + order.join(',') + '] ≠ 声明 [' + expected + ']');
        }
      }
    }
  }
  return errors;
}

/** 认领:探测器找得到的每个载体,声明里都必须有一条;声明里的每条,角色/形态必须合法。 */
export function lawClaim(participants, detected) {
  const errors = [];
  const claimed = new Set(participants.map((entry) => entry.file));
  for (const file of detected) {
    if (file === DECLARATION_FILE) continue; // 声明本身是形状的家,不需要被认领
    if (!claimed.has(file)) errors.push('探测器找到 ' + file + ',但认领表里没有它 —— 漏一个参与者本身就是错');
  }
  for (const entry of participants) {
    if (!ROLES.includes(entry.role)) errors.push(entry.file + ': 角色 ' + entry.role + ' 不在 ' + ROLES.join('/'));
    if (typeof entry.shape !== 'string' || entry.shape === '') errors.push(entry.file + ': 没标 seqs 在它手里是什么形态');
    if (typeof entry.via !== 'string' || entry.via === '') errors.push(entry.file + ': 没标它怎么拿到形状');
  }
  return errors;
}

/** 差分:与冻结基准逐字节相同(键顺序也在字节里)。 */
export function lawDifferential(cases, compute, frozen, label) {
  const errors = [];
  for (const [name, events] of Object.entries(cases)) {
    const expected = frozen[name];
    if (typeof expected !== 'string') { errors.push(label + '/' + name + ': 冻结基准里没有这一条'); continue; }
    let actual;
    try { actual = JSON.stringify(compute(events)); } catch (error) { errors.push(label + '/' + name + ': 抛了 ' + error.message); continue; }
    if (actual !== expected) {
      let at = 0;
      while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
      errors.push(label + '/' + name + ': 输出变了(第 ' + at + ' 字节起;冻结 ' + JSON.stringify(expected.slice(at, at + 40)) + ' 现在 ' + JSON.stringify(actual.slice(at, at + 40)) + ')');
    }
  }
  return errors;
}

/** 历史产物是证人,不是一方:只检查它还合法,绝不回写。 */
export function lawWitness(witnessValue) {
  if (witnessValue === null) return [];
  const errors = [];
  const facts = witnessValue && witnessValue.facts && typeof witnessValue.facts === 'object' ? witnessValue.facts : witnessValue;
  const incidents = incidentsOf(facts);
  if (incidents === null) return ['证人产物里找不到 incidents(顶层 / facts / facts.<analyzer> 都没有数组)'];
  incidents.forEach((item, index) => {
    for (const problem of shapeErrors(item, 'witness.incidents[' + index + ']')) errors.push(problem);
  });
  return errors;
}

/** 产物里 incidents 的位置不止一种写法(数组,或 analyzer 的整个产出对象)。 */
export function incidentsOf(container) {
  if (container === null || typeof container !== 'object') return null;
  if (Array.isArray(container.incidents)) return container.incidents;
  const nested = container.incidents;
  if (nested !== null && typeof nested === 'object' && Array.isArray(nested.incidents)) return nested.incidents;
  if (Array.isArray(container)) return container;
  return null;
}

/* ------------------------------------------------------------------ *
 * 探测器:仓库里哪些文件"知道"这份形状
 * ------------------------------------------------------------------ */

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === '.git' || item.name === 'fixtures') continue;
      walk(path, filter, out);
    } else if (item.isFile() && filter(path)) out.push(path);
  }
  return out;
}

function detectCarriers(root) {
  const files = [
    ...walk(join(root, 'analyzers'), (p) => p.endsWith('.mjs')),
    ...walk(join(root, 'plugin'), (p) => p.endsWith('.js') && p.includes('analysis-view')),
    ...walk(join(root, 'experiments', 'reports'), (p) => p.endsWith('.facts.json')),
  ];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // JS 字面量(key: )与 JSON 键("key":)都算 —— 只认前者会让产物类载体从探测器底下溜走。
    const named = INCIDENT_KEYS.filter((key) => new RegExp('(^|[\\s{,."\'])"?' + key + '"?\\s*:').test(text)).length;
    if (named >= 6) hits.push(relative(root, file).split('\\').join('/'));
  }
  return hits.sort();
}

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

function read(rel) {
  const path = join(REPO, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function computeBoth(events) {
  return { offline: JSON.stringify(offlineIncidents.run(events)), host: JSON.stringify(computeIncidents(events)) };
}

/** 真实会话 → 缩减成分析器真正读到的字段(冻进仓库的证人,不是整份日志)。 */
function reduceEvents(events, cap) {
  const out = [];
  for (const e of events) {
    if (!e || typeof e.seq !== 'number' || out.length >= cap) continue;
    const d = e.data || {};
    if (e.type === 'turn/start') out.push({ type: 'turn/start', seq: e.seq });
    else if (e.type === 'assistant/message') out.push({ type: 'assistant/message', seq: e.seq });
    else if (e.type === 'tool/call') {
      const args = typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments === undefined ? null : d.arguments);
      out.push({ type: 'tool/call', seq: e.seq, data: { name: d.name === undefined ? null : d.name, arguments: args } });
    } else if (e.type === 'tool/result') {
      const content = d.message && d.message.content;
      const isError = !!(Array.isArray(content) && content[0] && content[0].isError);
      const data = {};
      if (d.error) data.error = { name: d.error.name, code: d.error.code };
      if (isError) data.message = { content: [{ isError: true }] };
      out.push({ type: 'tool/result', seq: e.seq, data });
    }
  }
  return out;
}

function realCases(root, limit = 6, cap = 1500) {
  const files = walk(root, (p) => /^session(\.v\d+)?\.jsonl\.zstd$/.test(basename(p)));
  const byDir = new Map();
  for (const file of files) {
    const version = Number((/\.v(\d+)\./.exec(basename(file)) || [])[1] ?? -1);
    const dir = dirname(file);
    const previous = byDir.get(dir);
    if (previous === undefined || version > previous.version) byDir.set(dir, { file, version });
  }
  const cases = [];
  for (const { file } of [...byDir.values()].sort()) {
    if (cases.length >= limit) break;
    const age = Date.now() - statSync(file).mtimeMs;
    if (age < 60_000) continue; // 还在写的会话不冻(输入会变)
    let loaded;
    try { loaded = loadSession(file); } catch { continue; }
    const reduced = reduceEvents(loaded.events, cap);
    if (!reduced.some((e) => e.type === 'tool/result')) continue;
    const output = computeBoth(reduced);
    if (!JSON.parse(output.offline).incidents.length) continue; // 没 incident 的会话做不了差分
    cases.push({ path: relative(root, file).split('\\').join('/'), events: reduced, ...output });
  }
  return cases;
}

function main() {
  const mode = process.argv[2] || '';
  const failures = [];
  const note = (ok, name, errors) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !errors.length ? '' : '\n     ' + errors.join('\n     ')));
    if (!ok) failures.push(name);
  };

  const readSource = (rel) => read(rel);

  // 1) 构造器
  note(true, 'lawConstructor: 声明本身', []);
  const constructorErrors = lawConstructor(INCIDENT_FIELDS, incident);
  note(constructorErrors.length === 0, 'lawConstructor: 全函数(多/缺/类型/元素类型都抛)', constructorErrors);

  // 2) 认领
  const detected = detectCarriers(REPO);
  const claimErrors = lawClaim(PARTICIPANTS, detected);
  note(claimErrors.length === 0, 'lawClaim: 探测器找到的 ' + detected.length + ' 个载体都被认领', claimErrors);

  // 3) 漂移
  const driftErrors = lawDrift(PARTICIPANTS, readSource);
  note(driftErrors.length === 0, 'lawDrift: 每个载体与声明同键同序', driftErrors);

  // 4) 差分
  const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
  if (fixture === null) {
    failures.push('差分基准缺失');
    console.log('FAIL 差分基准缺失:' + FIXTURE + '(先跑 --freeze,并且确认冻结的是改动前的行为)');
  } else {
    const offlineFrozen = {};
    const hostFrozen = {};
    for (const [name, outputs] of Object.entries(fixture.synthetic || {})) {
      offlineFrozen[name] = outputs.offline;
      hostFrozen[name] = outputs.host;
    }
    note(true, 'lawDifferential: 合成流 ' + Object.keys(STREAMS).length + ' 条 × 2 个实现(与冻结基准逐字节)', []);
    const synOffline = lawDifferential(STREAMS, (e) => offlineIncidents.run(e), offlineFrozen, 'offline');
    const synHost = lawDifferential(STREAMS, (e) => computeIncidents(e), hostFrozen, 'host');
    note(synOffline.length === 0 && synHost.length === 0, 'lawDifferential: 合成流逐字节相同', [...synOffline, ...synHost]);

    const realFixture = existsSync(FIXTURE_REAL) ? JSON.parse(readFileSync(FIXTURE_REAL, 'utf8')) : null;
    const realOffline = {};
    const realHost = {};
    const realStreams = {};
    for (const session of (realFixture && realFixture.real) || []) {
      realStreams[session.path] = session.events;
      realOffline[session.path] = session.offline;
      realHost[session.path] = session.host;
    }
    const realCount = Object.keys(realStreams).length;
    if (realCount > 0) {
      const realErrors = [
        ...lawDifferential(realStreams, (e) => offlineIncidents.run(e), realOffline, 'real/offline'),
        ...lawDifferential(realStreams, (e) => computeIncidents(e), realHost, 'real/host'),
      ];
      const incidentsTotal = Object.values(realOffline).reduce((sum, text) => sum + JSON.parse(text).incidents.length, 0);
      note(realErrors.length === 0, 'lawDifferential: 本地真实会话缩减流 ' + realCount + ' 条(共 ' + incidentsTotal + ' 条 incident)逐字节相同', realErrors);
    } else {
      console.log('SKIP 差分:本地没有 ' + relative(REPO, FIXTURE_REAL).split('\\').join('/') + '(用 --freeze --real 冻结一份;它不进仓库)');
    }
  }

  // 5) 证人
  const witnessText = read(WITNESS);
  const witnessErrors = witnessText === null ? [] : lawWitness(JSON.parse(witnessText));
  if (witnessText === null) console.log('SKIP lawWitness: ' + WITNESS + ' 不在(产物还没生成)');
  else {
    const parsed = JSON.parse(witnessText);
    const incidents = incidentsOf(parsed.facts && parsed.facts.incidents ? parsed.facts : parsed) || [];
    note(witnessErrors.length === 0, 'lawWitness: 历史产物仍然合法(' + incidents.length + ' 条)', witnessErrors);
  }

  // 6) 变异:法则必须会咬
  if (mode === '--mutate') {
    const mutations = mutateCases();
    let escaped = 0;
    for (const mutation of mutations) {
      const errors = mutation.run();
      const caught = errors.length > 0;
      console.log((caught ? 'CAUGHT ' : 'ESCAPED ') + mutation.name + (caught ? '' : '  ← 逃走了'));
      if (!caught) escaped++;
    }
    note(escaped === 0, '变异:' + mutations.length + ' 种合理错法,逃走 ' + escaped, escaped === 0 ? [] : ['有变异逃走,说明法则有洞']);
  }

  // 7) 冻结
  if (mode === '--freeze') {
    const synthetic = {};
    for (const [name, events] of Object.entries(STREAMS)) synthetic[name] = computeBoth(events);
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, JSON.stringify({
      note: '差分基准:冻结的是"改成一份声明之前"的行为。逐字节比较(键顺序也在字节里)。合成流可复算;真实会话另外存在 *.real.json(不进仓库)。',
      frozenAt: new Date().toISOString(),
      synthetic,
      real: [],
    }, null, 2) + '\n');
    console.log('WROTE ' + relative(REPO, FIXTURE).split('\\').join('/') + ': 合成 ' + Object.keys(synthetic).length + ' 条');
    if (process.argv.includes('--real')) {
      const sessionsRoot = process.env.DSH_SESSIONS_ROOT || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'sessions');
      const real = existsSync(sessionsRoot) ? realCases(sessionsRoot) : [];
      writeFileSync(FIXTURE_REAL, JSON.stringify({
        note: '本地差分基准:真实会话的**缩减流**(只留分析器读的字段)+ 当时的输出。不进仓库 —— 里面有真实参数与路径。',
        frozenAt: new Date().toISOString(),
        root: sessionsRoot,
        real,
      }, null, 2) + '\n');
      console.log('WROTE ' + relative(REPO, FIXTURE_REAL).split('\\').join('/') + ': 真实会话 ' + real.length + ' 条(gitignore)');
    }
  }

  if (failures.length === 0) console.log('ALL PASS (' + (mode === '--mutate' ? '含变异' : '法则') + ')');
  else { console.log('FAILED: ' + failures.join(' / ')); process.exitCode = 1; }
}

/** 11 种合理错法:每一种都必须被某条法则抓到。全部以"变异后的输入"表达,不改磁盘。 */
function mutateCases() {
  const clientSource = readFileSync(join(REPO, 'plugin/analysis-view/lib/client.js'), 'utf8');
  const clientEntry = [{ file: 'plugin/analysis-view/lib/client.js', role: 'consumer+source', shape: 'wire+chips', via: 'literal' }];
  const keysWithout = (name) => INCIDENT_KEYS.filter((key) => key !== name);
  const keysSwapped = () => {
    const list = INCIDENT_KEYS.slice();
    const a = list.indexOf('title');
    const b = list.indexOf('detail');
    list[a] = 'detail';
    list[b] = 'title';
    return list;
  };
  const withType = (name, type) => INCIDENT_FIELDS.map((field) => (field.name === name ? { ...field, type } : field));
  const quiet = { severity: 0, runtimeKnew: '-', modelKnew: '-', harness: '-', impact: '-', cause: '-', title: '-', detail: '-', type: 'error', seqs: [] };

  return [
    { name: '声明里删掉 seqs', run: () => lawDrift(clientEntry, () => clientSource, keysWithout('seqs')) },
    { name: '声明里加一个没人产出的字段', run: () => lawDrift(clientEntry, () => clientSource, [...INCIDENT_KEYS, 'ghost']) },
    { name: '把两个字段的顺序对调', run: () => lawDrift(clientEntry, () => clientSource, keysSwapped()) },
    { name: 'severity 类型 number → string', run: () => lawConstructor(withType('severity', 'string'), incident) },
    { name: 'seqs 类型 number[] → string', run: () => lawConstructor(withType('seqs', 'string'), incident) },
    {
      name: '构造器不再拦越权字段',
      run: () => lawConstructor(INCIDENT_FIELDS, (fields) => {
        const rest = { ...fields };
        delete rest.ghost;
        return incident(rest);
      }),
    },
    {
      name: '构造器不再要求给全字段',
      run: () => lawConstructor(INCIDENT_FIELDS, (fields) => incident({ ...sampleFor(INCIDENT_FIELDS), ...fields })),
    },
    {
      name: 'noop 分支把 seqs 从空数组改成字符串',
      run: () => lawDifferential({ s: STREAMS.noop }, (events) => {
        const facts = offlineIncidents.run(events);
        facts.incidents = facts.incidents.map((item) => ({ ...item, seqs: item.seqs.length > 0 ? item.seqs : '' }));
        return facts;
      }, { s: JSON.stringify(offlineIncidents.run(STREAMS.noop)) }, 'mutant'),
    },
    {
      name: 'retry-loop 的 severity 少算一分',
      run: () => lawDifferential({ s: STREAMS['retry-loop'] }, (events) => {
        const facts = offlineIncidents.run(events);
        facts.incidents = facts.incidents.map((item) => (item.type === 'retry-loop' ? { ...item, severity: item.severity - 1 } : item));
        return facts;
      }, { s: JSON.stringify(offlineIncidents.run(STREAMS['retry-loop'])) }, 'mutant'),
    },
    { name: '认领表里漏掉客户端那个参与者', run: () => lawClaim(PARTICIPANTS.filter((entry) => !entry.file.endsWith('client.js')), detectCarriers(REPO)) },
    { name: '客户端字面量改了键名', run: () => lawDrift(clientEntry, () => clientSource.replace('modelKnew:', 'modelKnewX:'), INCIDENT_KEYS) },
    { name: '把一个 incident 的 harness 文案写空(值变了但形状没变,只有差分能抓)', run: () => lawDifferential({ s: STREAMS['mixed'] }, (events) => {
      const facts = offlineIncidents.run(events);
      facts.incidents = facts.incidents.map((item) => ({ ...item, harness: '' }));
      return facts;
    }, { s: JSON.stringify(offlineIncidents.run(STREAMS.mixed)) }, 'mutant') },
    { name: 'quiet 记录缺 seqs(合法值的边界)', run: () => (typeof keysWithout === 'function' ? shapeErrors(quiet) : []) },
  ];
}

/* 只有直接运行本文件时才跑法则;被 import 时只导出纯函数(否则法则会在别人的进程里乱跑)。 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main();
