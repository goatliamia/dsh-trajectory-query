import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [key, tool, ...rest] = process.argv.slice(2);
const config = JSON.parse(readFileSync(resolve('.dsh/diagnostic-experiment-v3/host.json')));
const fileAt = rest.indexOf('--args-file');
const args = fileAt >= 0 ? JSON.parse(readFileSync(rest[fileAt + 1], 'utf8')) : rest[0] && !rest[0].startsWith('--') ? JSON.parse(rest[0]) : {};
const response = await fetch('http://127.0.0.1:' + config.port, { method: 'POST', headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
  body: JSON.stringify({ case: key, tool, args, setup: rest.includes('--setup') }) });
process.stdout.write(await response.text());
if (!response.ok) process.exitCode = 1;
