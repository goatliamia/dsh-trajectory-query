// Local evidence rehearsal; reports stay in ignored .dsh by default.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadSession } from '../analyzers/load-session.mjs';
import { buildInspection, inspectionPage } from '../plugin/trajectory-tools/lib/inspect.js';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--source')) throw Error('Use --source <session.v4.jsonl.zstd> [--view cost] [--out .dsh/inspect-session.json]');
const loaded = loadSession(arg('--source'));
const start = performance.now(), index = buildInspection(loaded, loaded.id);
const report = inspectionPage(index, process.argv.includes('--view') ? arg('--view') : 'cost');
const output = resolve(process.argv.includes('--out') ? arg('--out') : '.dsh/inspect-session.json');
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, milliseconds: performance.now() - start, retainedEstimateBytes: JSON.stringify(index).length * 2,
  steps: index.summary.steps, coverage: index.coverage, definitions: index.summary.toolDefinitions.definitions.length,
  uncalledDefinitions: index.definitionItems.length, entries: report.totalEntries }));
