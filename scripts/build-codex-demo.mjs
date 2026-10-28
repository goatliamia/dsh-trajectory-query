import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { adaptCodexThread, commandReadEvidence } from '../analyzers/codex-adapter.mjs';

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
const input = resolve(args.includes('--snapshot') ? option('--snapshot') : '.dsh/codex-review/current-thread.json');
const snapshot = JSON.parse(readFileSync(input, 'utf8'));
const rolloutPath = args.includes('--rollout') ? option('--rollout') : snapshot.thread.path;
const rollout = !args.includes('--api-only') && rolloutPath && existsSync(rolloutPath) ? readFileSync(rolloutPath, 'utf8') : null;
const skillPaths = [...new Set(snapshot.thread.turns.flatMap(t => t.items).filter(i => i.type === 'commandExecution' && i.exitCode === 0).flatMap(i => commandReadEvidence(i.command, i.commandActions).map(r => r.path)).filter(path => /SKILL\.md$/i.test(path)))];
const skillMaterials = skillPaths.filter(existsSync).map(path => ({ path, text: readFileSync(path, 'utf8') }));
const payload = adaptCodexThread(snapshot, { rollout, skillMaterials });
let page = readFileSync(resolve('.dsh/layout-review/geist.html'), 'utf8');
page = page.replace(/<script id="trace-data" type="application\/json">[\s\S]*?<\/script>/, () => '<script id="trace-data" type="application/json">' + JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '</script>');
page = page.replace(/<title>[^<]*<\/title>/, '<title>Codex · 执行路径</title>');
page = page.replace('<body class="geist-review">', '<body class="geist-review codex-review">');
const seam = "  $('review-return').onclick=reviewReturnOverview;";
const bootAt = page.lastIndexOf(seam);
if (bootAt < page.indexOf('</script>', page.indexOf('<script id="trace-data"'))) throw new Error('Shared renderer boot seam changed; build /geist first');
page = page.slice(0, bootAt) + readFileSync(resolve('docs/demo/layout-review/codex-host.js'), 'utf8') + '\n' + page.slice(bootAt);
// The same event graph, file objects, result branches and selection code are
// reused. Only host-specific measurement semantics and explanatory labels vary.
for (const script of page.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
mkdirSync(resolve('.dsh/codex-review'), { recursive: true });
writeFileSync(resolve('.dsh/codex-review/graph-data.json'), JSON.stringify(payload));
const output = resolve(args.includes('--out') ? option('--out') : '.dsh/codex-review/current-thread.html');
mkdirSync(resolve(output, '..'), { recursive: true });
writeFileSync(output, page);
console.log(JSON.stringify({ host: 'codex', turns: payload.sessions[0].totals, timingMatched: payload.evidence.timingMatched, files: payload.context.fileOperations.length, skillEvents: payload.context.skillEvents.length, localRollout: !!rollout, output: '.dsh/codex-review/current-thread.html', bytes: Buffer.byteLength(page) }));
