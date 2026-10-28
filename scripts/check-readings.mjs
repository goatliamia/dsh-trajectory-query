// 运输检查:平移只允许改变位置,不允许改变读数(标签、分组、挂接)。
// 顺带量首帧时间、拖动帧时间、以及总览里最坏一组的合并倍数。
//
//   node scripts/check-readings.mjs <page-url> [--pan 300] [--json]
//
// 读数定义(与 §6.1 的声明读数一致):
//   text    节点上写给人看的文字
//   group   节点归属的组(轮次/步骤/文件对象/子代理支线)
//   offset  相对内容原点的横向位置;平移后必须整体位移同一个量
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/check-readings.mjs <page-url> [--pan 300] [--json]');
  process.exit(2);
}
const panArg = process.argv.indexOf('--pan');
const pan = panArg > 0 ? Number(process.argv[panArg + 1]) : 300;
const asJson = process.argv.includes('--json');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => existsSync(path)) ?? 'chrome';
const port = 9400 + Math.floor(Math.random() * 300);
const profile = `${process.env.TEMP}/readings-${port}`;

const browser = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1415,826', '--hide-scrollbars', target], { stdio: 'ignore' });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
let nextId = 0;
const pending = new Map();

async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(250);
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some(item => item.type === 'page' && item.webSocketDebuggerUrl)) break;
    } catch { /* still booting */ }
  }
  const page = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!page) throw new Error('no browser page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await send('Runtime.enable');
}

function send(method, params = {}) {
  return new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const result = message.result?.result;
  if (result?.subtype === 'error') throw new Error(result.description || 'evaluate failed');
  return result?.value;
}

const READINGS = `(() => {
  const viewport = document.getElementById('graph-scroll');
  const left = viewport ? viewport.getBoundingClientRect().left : 0;
  const nodes = [...document.querySelectorAll('#graph text')];
  const readings = {};
  for (const [index, node] of nodes.entries()) {
    const keys = Object.keys(node.dataset);
    const box = node.getBoundingClientRect();
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    readings['t' + index + ':' + text.slice(0, 24)] = { text, offset: Math.round(box.left - left) };
  }
  return readings;
})()`;

const BANDS = `(() => {
  const bands = [...document.querySelectorAll('text')].map(node => (node.textContent || '').trim())
    .filter(text => /^\\d+[-–]\\d+ 轮/.test(text))
    .map(text => { const match = /^(\\d+)[-–](\\d+) 轮/.exec(text); return Number(match[2]) - Number(match[1]) + 1; });
  return bands;
})()`;

const DRAG = `(async () => {
  const viewport = document.getElementById('graph-scroll');
  const frames = [];
  let last = performance.now();
  for (let step = 0; step < 60; step++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const now = performance.now();
    frames.push(now - last);
    last = now;
    viewport.scrollLeft = Math.max(0, viewport.scrollLeft + 20);
  }
  frames.sort((a, b) => a - b);
  return { p50: +frames[Math.floor(frames.length * 0.5)].toFixed(1), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(1), max: +frames.at(-1).toFixed(1) };
})()`;

try {
  await connect();
  const started = Date.now();
  for (let attempt = 0; attempt < 80; attempt++) {
    await wait(200);
    if (await evaluate("Boolean(document.getElementById('graph') && document.getElementById('graph').children.length)")) break;
  }
  const firstPaint = Date.now() - started;

  // 缩放 1 时总览没有可滚距离,平移测的是空操作;先放大到有横向余量。
  const zoomSteps = Number(process.argv.includes('--zoom') ? process.argv[process.argv.indexOf('--zoom') + 1] : 3);
  for (let step = 0; step < zoomSteps; step++) {
    await evaluate("document.getElementById('review-in').click()");
    await wait(320);
  }
  const scrollable = await evaluate("(() => { const v = document.getElementById('graph-scroll'); return { width: v.scrollWidth, client: v.clientWidth, scale: document.getElementById('review-state') ? document.getElementById('review-state').textContent : '' }; })()");
  const before = await evaluate(READINGS);
  await evaluate(`document.getElementById('graph-scroll').scrollLeft += ${pan}`);
  await wait(220);
  const after = await evaluate(READINGS);

  const keysBefore = Object.keys(before).sort();
  const keysAfter = Object.keys(after).sort();
  const sameMembers = keysBefore.length === keysAfter.length && keysBefore.every((key, index) => key === keysAfter[index]);
  const textChanged = keysBefore.filter(key => before[key].text !== after[key]?.text);
  const shifts = keysBefore.filter(key => after[key]).map(key => after[key].offset - before[key].offset);
  const drift = shifts.length ? Math.max(...shifts) - Math.min(...shifts) : 0;
  const expected = -pan;
  const meanShift = shifts.length ? shifts.reduce((sum, value) => sum + value, 0) / shifts.length : 0;

  const bands = await evaluate(BANDS);
  const drag = await evaluate(DRAG);

  const report = {
    target,
    zoomSteps,
    scrollable,
    nodes: keysBefore.length,
    firstPaintMs: firstPaint,
    pan,
    panInvariant: sameMembers && textChanged.length === 0,
    textChanged: textChanged.slice(0, 5),
    memberDrift: keysBefore.length - keysAfter.length,
    meanShift: +meanShift.toFixed(1),
    shiftError: +(meanShift - expected).toFixed(1),
    shiftSpread: drift,
    bands: bands.length,
    worstBandTurns: bands.length ? Math.max(...bands) : 0,
    bandTurns: bands,
    drag,
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`nodes ${report.nodes}  first paint ${report.firstPaintMs}ms`);
    console.log(`pan ${report.pan}px -> invariant ${report.panInvariant}  shift ${report.meanShift} (want ${expected})  spread ${report.shiftSpread}  textChanged ${report.textChanged.length}`);
    console.log(`bands ${report.bands}  worst ${report.worstBandTurns} turns  ${JSON.stringify(report.bandTurns)}`);
    console.log(`drag frames p50 ${drag.p50}ms p95 ${drag.p95}ms max ${drag.max}ms`);
  }
  if (!report.panInvariant) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  browser.kill();
}
