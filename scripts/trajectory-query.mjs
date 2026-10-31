import { readFile } from 'node:fs/promises';
import { fileService, sourceOptions } from '../plugin/portable-tools/runtime.mjs';
import { executeTool, TOOLS } from '../plugin/portable-tools/tools.mjs';
const argv = process.argv.slice(2), option = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
if (argv.includes('--help')) {
  console.log('node scripts/trajectory-query.mjs --host pi|codex|claude --file <native-session.jsonl|official-snapshot.json> [--thread ID] [--capture file] [--leaf ID] [--api-only] [--tool schema|trajectory_inspect|trajectory_read|trajectory_search|trajectory_graph] [--request args.json | --args JSON]');
} else if (option('--tool') === 'schema') {
  console.log(JSON.stringify({tools:TOOLS.map(({name,description,inputSchema})=>({name,description,inputSchema}))}));
} else {
  const service = fileService(sourceOptions(argv), { rebuildSnapshots: true });
  try {
    const args = JSON.parse(option('--request') ? await readFile(option('--request'), 'utf8') : option('--args') || '{}');
    console.log(JSON.stringify(await executeTool(service, option('--tool') || 'trajectory_inspect', args)));
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  finally { service.dispose(); }
}
