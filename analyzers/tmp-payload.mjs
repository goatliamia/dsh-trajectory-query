import { readFileSync } from 'node:fs';

const html = readFileSync(process.argv[2], 'utf8');
const start = html.indexOf('<script id="trace-data" type="application/json">');
const open = html.indexOf('>', start) + 1;
const close = html.indexOf('</script>', open);
const json = html.slice(open, close);
console.log('json bytes', json.length);
const data = JSON.parse(json);
console.log('keys', Object.keys(data).join(','));
console.log('sessions', data.sessions && data.sessions.length);
const main = data.sessions && data.sessions[0];
console.log('turns', main && main.turns.length, 'steps', main && main.turns.reduce((n, t) => n + t.steps.length, 0));
console.log('overview', main && main.overview ? Object.keys(main.overview).join(',') : 'MISSING');
console.log('episodes', main && main.overview && main.overview.episodes ? main.overview.episodes.length : 'n/a');
console.log('totals', main && main.totals ? Object.keys(main.totals).join(',') : 'n/a');
