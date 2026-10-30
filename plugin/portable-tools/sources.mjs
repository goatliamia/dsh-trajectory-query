import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { adaptPiSession, piSessionPath } from '../../analyzers/pi-adapter.mjs';
import { readPiSession } from '../../analyzers/pi-reader.mjs';
import { adaptCodexThread } from '../../analyzers/codex-adapter.mjs';
import { readCodexThread } from '../../analyzers/codex-reader.mjs';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function visible(value, parameters = false) {
  if (Array.isArray(value)) return value.map(v => visible(v, parameters)).filter(v => v !== undefined);
  if (!value || typeof value !== 'object') return value;
  if (!parameters && /^(thinking|reasoning|redacted_thinking)$/.test(value.type || '')) return undefined;
  if (/^(?:input_|output_)?(?:image|audio|video)(?:_url)?$/.test(value.type || '')) return { type: value.type, mimeType: value.mimeType, path: value.path, mediaOmitted: true };
  return Object.fromEntries(Object.entries(value).filter(([k]) => parameters || !/^(encrypted_content|encryptedContent|signature)$/.test(k)).map(([k, v]) => [k, visible(v, parameters || k === 'arguments')]).filter(([, v]) => v !== undefined));
}
const strings = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(strings).join('\n') : value && typeof value === 'object' ? Object.values(value).map(strings).filter(Boolean).join('\n') : '';
export const recordText = record => strings(record.body);

export function datasetFromNative(host, native, options = {}) {
  const payload = host === 'pi' ? adaptPiSession(native) : adaptCodexThread(native, options);
  const session = payload.sessions[0], records = new Map();
  function add(seq, body, metadata = {}, original = body) {
    if (!Number.isSafeInteger(seq)) return;
    const safe = visible(body);
    const { arguments: _arguments, ...rest } = metadata;
    records.set(seq, { seq, body: safe, nativeHash: hash(original), ...rest });
  }
  if (host === 'pi') {
    const path = piSessionPath(native.entries, native.leafId), byId = new Map(path.map(e => [e.id, e]));
    const calls = new Map(), results = new Map();
    for (const entry of path) {
      if (entry.message?.role === 'assistant') for (const call of entry.message.content.filter(c => c.type === 'toolCall')) calls.set(call.id, { call, entry });
      if (entry.message?.role === 'toolResult') results.set(entry.message.toolCallId, entry);
    }
    for (const event of payload.events) {
      const entry = byId.get(event.id);
      add(event.seq, entry, { kind: entry.message?.role || entry.type, time: event.time, native: { entryId: entry.id, parentId: entry.parentId }, source: 'pi-session-v3' });
    }
    for (const turn of session.turns) {
      const user = byId.get(turn.id);
      for (const prompt of turn.prompts) add(prompt.seq, user, { kind: 'user', turn: turn.number, time: turn.start, native: { entryId: user.id }, source: 'pi-session-v3' });
      for (const step of turn.steps) {
        const event = payload.events.find(e => e.seq === step.seq), entry = event && byId.get(event.id);
        if (entry) add(step.seq, entry, { kind: 'assistant', turn: turn.number, step: step.number, time: step.start, native: { entryId: entry.id }, source: 'pi-session-v3' });
        for (const call of step.calls) {
          const actual = calls.get(call.id), result = results.get(call.id);
          add(call.seq, { name: actual.call.name, arguments: actual.call.arguments }, { kind: 'call', name: call.nativeName, turn: turn.number, step: step.number, time: call.start, resultSeq: call.resultSeq, arguments: visible(actual.call.arguments), native: { entryId: actual.entry.id, callId: call.id }, source: 'pi-session-v3' }, actual.call);
          if (result) add(call.resultSeq, result.message, { kind: 'result', name: call.nativeName, turn: turn.number, step: step.number, time: call.end, callSeq: call.seq, native: { entryId: result.id, callId: call.id }, source: 'pi-session-v3' }, result);
        }
      }
    }
  } else {
    const items = new Map(native.thread.turns.flatMap(t => t.items.map(item => [item.id, { item, turnId: t.id }])));
    const localCalls = new Map(), localResults = new Map();
    for (const [line, text] of String(options.rollout || '').split(/\r?\n/).entries()) {
      if (!text.trim()) continue;
      let row; try { row = JSON.parse(text); } catch { continue; }
      if (native.capturedAt && Date.parse(row.timestamp) > Date.parse(native.capturedAt)) continue;
      const item = row.payload;
      if (row.type !== 'response_item' || !item) continue;
      if (item.type === 'function_call' && item.namespace === 'collaboration') localCalls.set(item.id || item.call_id, { item, line: line + 1 });
      if (item.type === 'function_call_output') localResults.set(item.call_id, { item, line: line + 1 });
    }
    for (const turn of session.turns) {
      const original = native.thread.turns.find(t => t.id === turn.id), { items: _, ...metadata } = original;
      add(turn.seq, metadata, { kind: 'turn-boundary', turn: turn.number, native: { turnId: turn.id }, source: 'official-api' });
      for (const step of turn.steps.filter(s => s.semanticUnit === 'turn-boundary')) add(step.seq, metadata, { kind: 'turn-boundary', turn: turn.number, step: step.number, native: { turnId: turn.id }, source: 'official-api' });
    }
    for (const event of payload.events) {
      const actual = items.get(event.id);
      if (actual) add(event.seq, actual.item, { kind: actual.item.type, turn: event.turn, time: event.start, native: { itemId: event.id, turnId: actual.turnId }, source: 'official-api' });
    }
    for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
      const actual = items.get(call.id);
      if (!actual) {
        const local = localCalls.get(call.id); if (!local) continue;
        const returned = localResults.get(local.item.call_id);
        let args = local.item.arguments; try { args = JSON.parse(args); } catch {}
        const metadata = { name: 'collaboration.' + local.item.name, turn: turn.number, step: step.number, source: 'local-rollout', native: { callId: local.item.call_id, line: local.line, turnId: turn.id } };
        add(call.seq, { name: metadata.name, arguments: args }, { ...metadata, kind: 'call', time: call.start, arguments: visible(args), resultSeq: call.resultSeq }, local.item);
        if (returned && call.resultSeq != null) add(call.resultSeq, { result: returned.item.output }, { ...metadata, kind: 'result', time: call.end, callSeq: call.seq, native: { ...metadata.native, line: returned.line } }, returned.item);
        continue;
      }
      const item = actual.item;
      const args = item.type === 'commandExecution' ? { command: item.command, cwd: item.cwd, commandActions: item.commandActions } : item.arguments ?? (item.type === 'fileChange' ? { changes: item.changes } : item);
      const result = item.type === 'commandExecution' ? { output: item.aggregatedOutput, exitCode: item.exitCode } : item.type === 'mcpToolCall' ? item.result : item.type === 'dynamicToolCall' ? item.contentItems : item.changes ?? item.results ?? item.states ?? item.agentsStates;
      const metadata = { name: call.nativeName, turn: turn.number, step: step.number, native: { itemId: item.id, turnId: actual.turnId }, source: 'official-api' };
      add(call.seq, { type: item.type, arguments: args, status: item.status }, { ...metadata, kind: 'call', time: step.endObserved ? call.start : null, arguments: visible(args), resultSeq: call.resultSeq }, item);
      if (call.resultSeq != null) add(call.resultSeq, { result, status: item.status, error: item.error ?? null }, { ...metadata, kind: 'result', time: step.endObserved ? call.end : null, callSeq: call.seq }, item);
    }
  }
  const scope = payload.context.scope;
  for (const declaration of payload.context.declarations || []) {
    add(session.lastSeq + 1 + records.size, declaration, { kind: 'declaration', source: declaration.source, native: { line: declaration.line }, time: declaration.time });
    const appendDefinitions = (tools, prefix = '') => {
      for (const tool of Array.isArray(tools) ? tools : []) {
        if (tool.type === 'namespace' && Array.isArray(tool.tools)) { appendDefinitions(tool.tools, prefix + tool.name + '.'); continue; }
        const body = tool.function || tool, name = prefix + (body.name || tool.type || 'unidentified');
        add(session.lastSeq + 1 + records.size, tool, { kind: 'historical-definition', name, source: declaration.source, native: { line: declaration.line, tool: name }, time: declaration.time });
      }
    };
    appendDefinitions(declaration.tools);
  }
  if (scope) {
    const scopeHash = hash(scope), { tools, ...metadata } = scope;
    add(session.lastSeq + 1, { ...metadata, configuredTools: tools.map(t => ({ name: t.name, active: t.active, exposure: t.exposure })) }, { kind: 'scope', source: scope.source || 'pi-sdk-current-scope', native: { scopeHash, observedAt: scope.observedAt } });
    tools.forEach((tool, i) => add(session.lastSeq + 2 + i, tool, { kind: 'definition', name: tool.name, source: scope.source || 'pi-sdk-current-scope', native: { scopeHash, tool: tool.name, observedAt: scope.observedAt } }));
  }
  const all = [...records.values()].sort((a, b) => a.seq - b.seq);
  // Tools retain full native bodies above. The renderer's duplicated excerpts
  // and diffs are unnecessary in this query cache; keep their exact sizes.
  const compactExcerpt = value => value == null ? value : { text: '', omitted: (value.text?.length || 0) + (value.omitted || 0) };
  for (const turn of session.turns) {
    turn.prompts = turn.prompts.map(p => ({ ...p, text: p.text.slice(0, 1000), omitted: (p.omitted || 0) + Math.max(0, p.text.length - 1000) }));
    for (const step of turn.steps) { step.reply = compactExcerpt(step.reply); for (const call of step.calls) { call.args = compactExcerpt(call.args); call.result = compactExcerpt(call.result); } }
  }
  delete payload.context.callFacts;
  delete payload.context.declarations;
  for (const file of payload.context.fileOperations) if (file.diff) { file.diffCharacters = (file.diff.text?.length || 0) + (file.diff.omitted || 0); delete file.diff; }
  const fingerprint = hash({ host, session: session.id, records: all.map(r => [r.seq, r.nativeHash]), usage: payload.context.usage, current: payload.context.current });
  return { host, session: session.id, payload, records: all, fingerprint, logId: host + ':' + session.id + ':' + fingerprint.slice(0, 16), synthetic: payload.synthetic === true };
}

async function boundedRead(file, maxBytes = 128 * 1024 * 1024) {
  if ((await stat(file)).size > maxBytes) throw Error('Source exceeds input budget');
  const bytes = await readFile(file); if (bytes.length > maxBytes) throw Error('Source exceeds input budget');
  return bytes.toString('utf8');
}
export async function loadPortableSource(spec, signal) {
  signal?.throwIfAborted();
  if (spec.host === 'pi') return datasetFromNative('pi', spec.input || await readPiSession(spec.file, { ...spec, signal }));
  if (spec.host !== 'codex') throw Error('Supported hosts: pi, codex');
  const snapshot = spec.snapshot || (spec.file ? JSON.parse(await boundedRead(resolve(spec.file))) : await readCodexThread(spec.thread, { signal }));
  let rollout = spec.rolloutText;
  if (!spec.apiOnly && rollout === undefined) {
    const path = spec.rollout || snapshot.thread.path;
    if (path) {
      try { rollout = await boundedRead(path); }
      catch (error) { if (spec.rollout || error.code !== 'ENOENT') throw error; }
    }
  }
  if (rollout) {
    const first = JSON.parse(rollout.split(/\r?\n/).find(line => line.trim()));
    if (first.type !== 'session_meta' || first.payload?.id !== snapshot.thread.id) throw Error('Local rollout identity does not match official thread');
  }
  return datasetFromNative('codex', snapshot, { rollout: spec.apiOnly ? null : rollout });
}
