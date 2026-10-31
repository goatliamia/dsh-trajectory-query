// Offline experiment host: executes the actual registered tools on frozen logs.
// No connection to the running DSH instance, no logged commands are executed.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply } from '../plugin/trajectory-tools/lib/index.js';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { decodeZstdSession } from '../experiments/corpus/decode-session.mjs';
import { buildInjectionIndex } from '../analyzers/context-evidence.mjs';

const [fixturesArg = '.dsh/diagnostic-pilot', outputArg = '.dsh/diagnostic-experiment-v3', portArg = '3093', reasoningArg = 'max', promptArg = 'docs/diagnostic-analysis-v3.md'] = process.argv.slice(2);
const fixtures = resolve(fixturesArg), output = resolve(outputArg), port = Number(portArg);
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json')));
mkdirSync(output, { recursive: true });
const sdk = createRequire(import.meta.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const imp = file => import(pathToFileURL(file).href);
const tokenRoot = dirname(sdk.resolve('@deepseek-ai/dsh-token-meter/package.json'));
const breakdown = await imp(join(tokenRoot, 'lib/types/breakdown-projection.js'));
const usage = await imp(join(tokenRoot, 'lib/types/usage-projection.js'));
const { SessionQueryEngine } = await imp(sdk.resolve('@deepseek-ai/dsh-session-query'));
const { SurfaceManager } = await imp(sdk.resolve('@deepseek-ai/dsh-session/surface'));
const definitions = [breakdown.contextBreakdownProjectionDefinition, usage.contextPressureProjectionDefinition, usage.tokenUsageProjectionDefinition];
try {
  const contextRoot = join(process.env.USERPROFILE, '.dsh/profiles/web/node_modules/dsh-context');
  const plugin = await imp(join(contextRoot, 'lib/index.js'));
  plugin.apply({ fiber: { name: 'offline-diagnostic-experiment' }, get() {}, inject() {}, on() {}, effect() {},
    sessionProjections: { register(d) { if (d.key === 'contextTimeline') definitions.push(d); return () => {}; } } }, {});
} catch { /* optional community projection */ }

const cases = new Map(), token = randomBytes(24).toString('hex');
function openCase(key) {
  if (cases.has(key)) return cases.get(key);
  const spec = manifest.cases.find(c => c.key === key);
  if (!spec) throw Error('Unknown case');
  const source = readFileSync(join(fixtures, key, 'source.v4.jsonl.zstd'));
  if (createHash('sha256').update(source).digest('hex') !== spec.sourceHash) throw Error('Frozen source hash changed');
  const rows = decodeZstdSession(source).toString('utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));
  const header = rows.find(r => r.type === 'session'), events = rows.filter(r => Number.isSafeInteger(r.seq)).sort((a, b) => a.seq - b.seq);
  if (events.some((e, i) => e.seq !== i)) throw Error('Source is not a contiguous prefix');
  const tools = new Map(), disposers = [], state = { spec, header, events, tools, disposers, observations: 0, responseBytes:0, serial:0 };
  const corpus = { async load(id) { if (id !== spec.session) throw Error('Case scope mismatch'); return { header, events }; },
    async listSessions() { return [{ header, live: false, persisted: true }]; } };
  const query = {
    async observeSession(id) { await corpus.load(id); state.observations++; return { header, events, inheritedEventCount: 0, source: 'persisted', [Symbol.dispose]() {} }; },
    listSessions: corpus.listSessions,
    traceEvent(request, signal) { return SessionQueryEngine.prototype.traceEvent.call({ _corpus: corpus }, request, signal); },
    traceSession(id, signal) { return SessionQueryEngine.prototype.traceSession.call({ _corpus: corpus }, id, signal); },
  };
  const projections = { restore(checkpoint, batch, floor, h, inherited) {
    const next = {}, values = {};
    for (const d of definitions) {
      let value = checkpoint[d.key] ?? d.init(h, inherited);
      for (const e of batch) value = d.apply(value, e);
      next[d.key] = value; values[d.key] = d.wire.view(value);
    }
    return { checkpoint: next, snapshot: { asOfSeq: batch.at(-1)?.seq ?? -1, values } };
  } };
  apply({ tools: { register(t) { tools.set(t.name, t); return () => {}; } }, effect(fn) { disposers.push(fn()); },
    get(name) { return name === 'sessionQuery' ? query : name === 'sessionProjections' ? projections : undefined; } }, { reconcile: false });
  mkdirSync(join(output, key), { recursive: true });
  cases.set(key, state);
  return state;
}
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + token) { res.writeHead(403); res.end(); return; }
  let raw = '',state,request,started=performance.now();
  try {
    for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw Error('Request too large'); }
    request=JSON.parse(raw);
    const { case: key, tool, args = {}, setup = false, origin = 'agent' } = request;
    if (tool === 'shutdown') { res.end('{"ok":true}'); server.close(); return; }
    state = openCase(key);started=performance.now();
    let result;
    if (tool === 'schema') result = { case: key, session: state.spec.session, tools: [...state.tools.values()].map(t => projectToolSchema(t, true)),
      scope: 'Actual registered tool execute functions over frozen sources; offline projection registry replays unchanged installed definitions.',
      notes: ['Only this frozen case is visible.', 'No original task or proposed optimization is executed.', 'Copy snapshot, expand, reads and nextRead from results.'] };
    else if(tool==='report/structure'){
      const {source,cuts}=args;
      if(source?.session!==state.spec.session||!Array.isArray(cuts)||!cuts.length||cuts.length>48||cuts.some((cut,i)=>!Number.isSafeInteger(cut)||cut<0||cut>source.cut||i&&cut<=cuts[i-1]))throw Error('Structure requires bounded increasing cuts for this source');
      const pinned=await state.tools.get('trajectory_inspect').execute({session:state.spec.session,snapshot:source.snapshot,view:'overview',format:'data',limit:1},{signal:new AbortController().signal});
      if(pinned.ok===false||pinned.source?.log!==source.log||pinned.source?.cut!==source.cut)throw Error('Structure source identity changed');
      result={ok:true,snapshots:cuts.map(cut=>{
        const injections=buildInjectionIndex({session:state.spec.session,events:state.events,SurfaceManager,asOfSeq:cut});
        const header=state.events.findLast(e=>e.seq<=cut&&e.type==='request/header'),tools=header?.data.header?.tools;
        const position=state.events.findLast(e=>e.seq<=cut&&e.type==='step/start')?.data||{};
        return {cut:injections.cut,position,injections,structure:{headSystemSeq:injections.slots[0]?.role==='system'?injections.slots[0].seq:null,
          headerSeq:header?.seq??null,toolCount:Array.isArray(tools)?tools.length:null,toolsKey:Array.isArray(tools)?createHash('sha256').update(JSON.stringify(tools)).digest('hex'):null}};
      })};
    } else {
      if (!state.tools.has(tool)) throw Error('Unknown tool');
      if (args.session && args.session !== state.spec.session) throw Error('Cross-case reads are not allowed');
      result = await state.tools.get(tool).execute({ ...args, session: state.spec.session }, { signal: new AbortController().signal });
    }
    const data = JSON.stringify(result), record = { at: new Date().toISOString(), tool, args, setup,origin,
      ms: Math.round(performance.now() - started), returnedCharacters: data.length, ok: result.ok !== false };
    const responseName='response-'+String(++state.serial).padStart(4,'0')+'.json';
    const stored=data.length<=1024*1024&&state.responseBytes+data.length<=20*1024*1024?data:JSON.stringify({excerpt:data.slice(0,20000),omittedCharacters:Math.max(0,data.length-20000)});
    state.responseBytes+=stored.length;writeFileSync(join(output,key,responseName),stored);record.response=responseName;record.responseSha256=createHash('sha256').update(data).digest('hex');
    appendFileSync(join(output, key, 'queries.jsonl'), JSON.stringify(record) + '\n');
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(data);
  } catch (error) {
    if(state)appendFileSync(join(output,state.spec.key,'queries.jsonl'),JSON.stringify({at:new Date().toISOString(),tool:request?.tool,args:request?.args,origin:request?.origin||'agent',ms:Math.round(performance.now()-started),ok:false,error:error.message})+'\n');
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});
server.on('close', () => { for (const state of cases.values()) for (const dispose of state.disposers) dispose?.(); });
server.listen(port, '127.0.0.1', () => {
  writeFileSync(join(output, 'host.json'), JSON.stringify({ port, token, pid: process.pid }));
  const codeFiles = ['index.js', 'inspect.js', 'inspect-service.js', 'linked-read.js', 'usage.js', 'skill.js', 'official-stats.js'];
  const resources = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? resources(join(path, entry.name)) : [join(path, entry.name)]);
  const skillFiles = [...resources('plugin/trajectory-tools/skills'), 'plugin/trajectory-tools/report/WRITING.md'];
  const record = { date: new Date().toISOString(), sourceManifest: manifest, promptSha256: createHash('sha256').update(readFileSync(promptArg)).digest('hex'),
    codeHashes: Object.fromEntries(codeFiles.map(f => [f, createHash('sha256').update(readFileSync(join('plugin/trajectory-tools/lib', f))).digest('hex')])),
    skillHashes: Object.fromEntries(skillFiles.sort().map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])),
    scope: 'Frozen fixture host, real registered execute path; not live DSH/model-protocol or intervention testing', model: 'gpt-6.1-terra', reasoning: reasoningArg };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(record, null, 2));
  writeFileSync(join(output, 'prompt.md'), readFileSync(promptArg));
  console.log('Diagnostic fixture host ready on 127.0.0.1:' + port);
});
