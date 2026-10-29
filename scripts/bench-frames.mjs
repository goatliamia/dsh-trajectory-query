// 拖动帧时间的稳定测量:同一构建跑多轮,先预热,报告每轮 p50/p95 以及轮间中位数。
// 单次 60 帧的读数在 455 轮页面上抖动极大(18ms 到 55ms),不取中位数没有比较意义。
//
//   node scripts/bench-frames.mjs <page-url> [--runs 5] [--frames 60] [--warmup 20] [--json]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/bench-frames.mjs <page-url> [--runs 5] [--frames 60] [--warmup 20] [--json]');
  process.exit(2);
}
const arg = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const runs = arg('runs', 5), frames = arg('frames', 60), warmup = arg('warmup', 20);
const asJson = process.argv.includes('--json');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => existsSync(path)) ?? 'chrome';
const port = 9200 + Math.floor(Math.random() * 500);
const browser = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/bench-${port}`, '--window-size=1415,826', '--hide-scrollbars', target], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let ws, nextId = 0;
const pending = new Map();
async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(250);
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some(item => item.type === 'page' && item.webSocketDebuggerUrl)) break;
    } catch { /* booting */ }
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
async function evaluate(expression, awaitPromise = false) {
  const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  return message.result?.result?.value;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

try {
  await connect();
  for (let attempt = 0; attempt < 80; attempt++) {
    await wait(200);
    if (await evaluate("Boolean(document.getElementById('graph') && document.getElementById('graph').children.length)")) break;
  }
  await evaluate(`document.getElementById('review-in').click()`);
  await wait(800);

  const samples = [];
  for (let run = 0; run < runs; run++) {
    const result = await evaluate(`(async () => {
      const vp = document.getElementById('graph-scroll');
      vp.scrollLeft = 0;
      await new Promise(r => requestAnimationFrame(r));
      for (let i = 0; i < ${warmup}; i++) { await new Promise(r => requestAnimationFrame(r)); vp.scrollLeft += 12; }
      const deltas = [];
      let last = performance.now();
      for (let i = 0; i < ${frames}; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        vp.scrollLeft = Math.min(2600, vp.scrollLeft + 20);
      }
      deltas.sort((a, b) => a - b);
      return { p50: +deltas[Math.floor(frames * .5)].toFixed(1), p95: +deltas[Math.floor(frames * .95)].toFixed(1), max: +deltas.at(-1).toFixed(1) };
    })()`, true);
    samples.push(typeof result === 'string' ? JSON.parse(result) : result);
  }
  const report = {
    target, runs, frames, warmup,
    p50: median(samples.map(s => s.p50)),
    p95: median(samples.map(s => s.p95)),
    max: median(samples.map(s => s.max)),
    spreadP95: Math.max(...samples.map(s => s.p95)) - Math.min(...samples.map(s => s.p95)),
    samples,
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`runs ${runs} × ${frames} frames (warmup ${warmup})`);
    console.log(`median  p50 ${report.p50}ms   p95 ${report.p95}ms   max ${report.max}ms`);
    console.log(`p95 across runs: ${samples.map(s => s.p95).join(', ')}  (spread ${report.spreadP95}ms)`);
  }
} finally {
  try { ws?.close(); } catch { /* closed */ }
  browser.kill();
}
