import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeHostTracePage } from './host-trace-page.mjs';
import { adaptCodexThread, commandReadEvidence } from '../analyzers/codex-adapter.mjs';

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
const input = resolve(args.includes('--snapshot') ? option('--snapshot') : '.dsh/codex-review/current-thread.json');
const snapshot = JSON.parse(readFileSync(input, 'utf8'));
const rolloutPath = args.includes('--rollout') ? option('--rollout') : snapshot.thread.path;
const rollout = !args.includes('--api-only') && rolloutPath && existsSync(rolloutPath) ? readFileSync(rolloutPath, 'utf8') : null;
const skillPaths = [...new Set(snapshot.thread.turns.flatMap(t => t.items).filter(i => i.type === 'commandExecution' && i.exitCode === 0).flatMap(i => commandReadEvidence(i.command, i.commandActions).map(r => r.path)).filter(path => /SKILL\.md$/i.test(path)))];
const skillMaterials = skillPaths.filter(existsSync).map(path => ({ path, text: readFileSync(path, 'utf8') }));
const payload = adaptCodexThread(snapshot, { rollout, skillMaterials });
mkdirSync(resolve('.dsh/codex-review'), { recursive: true });
writeFileSync(resolve('.dsh/codex-review/graph-data.json'), JSON.stringify(payload));
const output = resolve(args.includes('--out') ? option('--out') : '.dsh/codex-review/current-thread.html');
mkdirSync(resolve(output, '..'), { recursive: true });
const result = writeHostTracePage(payload, output);
console.log(JSON.stringify({ ...result, turns: payload.sessions[0].totals, timingMatched: payload.evidence.timingMatched, files: payload.context.fileOperations.length, skillEvents: payload.context.skillEvents.length, localRollout: !!rollout }));
