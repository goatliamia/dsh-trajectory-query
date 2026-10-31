import { loadPortableSource } from './sources.mjs';
import { PortableService } from './service.mjs';
import { listCodexThreads } from '../../analyzers/codex-reader.mjs';

export function sourceOptions(args) {
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const host = option('--host'), file = option('--file'), thread = option('--thread') || (!file && host === 'codex' ? process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID : undefined);
  if (!['pi', 'codex', 'claude'].includes(host) || ['pi', 'claude'].includes(host) && !file) throw Error('Use --host pi|claude --file session.jsonl, or --host codex [--file snapshot.json / --thread ID]');
  return { host, file, thread, bindThread: !!option('--thread'), leafId: option('--leaf'), captureFile: option('--capture'), rollout: option('--rollout'), apiOnly: args.includes('--api-only'), synthetic: args.includes('--synthetic') };
}
export function fileService(spec, options = {}) {
  let knownId;
  return new PortableService({ ...options,
    catalog: (args, signal) => spec.host === 'codex' && !spec.file && !spec.bindThread ? listCodexThreads({ cwd: args.cwd, query: args.query, cursor: args.cursor, limit: args.limit, signal }) : [{ session: knownId || spec.thread || 'current', host: spec.host, source: spec.file || 'official-app-server' }],
    load: async (session, signal) => {
      const unboundCodex = spec.host === 'codex' && !spec.bindThread && !spec.file, thread = session && session !== 'current' ? session : spec.thread;
      if (unboundCodex && !thread) throw Error('Provide a Codex thread ID in session, or start with --thread / --file');
      const data = await loadPortableSource(unboundCodex ? { ...spec, thread } : spec, signal);
      if (!unboundCodex && session && !['current', data.session, spec.thread, spec.file].includes(session)) throw Error('Session is not bound to this server');
      knownId = data.session; return data;
    },
  });
}
