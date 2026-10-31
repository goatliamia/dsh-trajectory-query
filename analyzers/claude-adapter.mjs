// Project only recorded visible messages and tool blocks. This intermediate
// structure reuses the Pi renderer; it does not imply Pi request semantics.
import { createHash } from 'node:crypto';
import { resolve, win32, posix } from 'node:path';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function visible(value, parameters = false) {
  if (Array.isArray(value)) return value.map(v => visible(v, parameters)).filter(v => v !== undefined);
  if (!value || typeof value !== 'object') return value;
  if (!parameters && /^(thinking|reasoning|redacted_thinking)$/.test(value.type || '')) return undefined;
  if (!parameters && /^(image|audio|video)$/.test(value.type || '')) return { type: value.type, mediaOmitted: true };
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '__trajectoryLine' && (parameters || !/^(signature|encrypted_content|encryptedContent)$/.test(k))).map(([k, v]) => [k, visible(v, parameters || k === 'input')]).filter(([, v]) => v !== undefined));
}
export function projectClaudeTranscript(native) {
  const entries = [], seenCalls = new Set(); let parentId = null, started = false, serial = 0;
  const add = (row, message, block = null) => {
    const id = 'claude-' + (++serial), timestamp = row.timestamp || null;
    entries.push({ type: 'message', id, parentId, timestamp, message: { ...message, timestamp: timestamp ? Date.parse(timestamp) : null }, claudeRow: row, claudeBlock: block }); parentId = id;
  };
  for (const row of native.rows) {
    if (!['user', 'assistant'].includes(row.type) || !row.message) continue;
    const content = typeof row.message.content === 'string' ? [{ type: 'text', text: row.message.content }] : Array.isArray(row.message.content) ? row.message.content : [];
    if (row.type === 'user') {
      for (const b of content.filter(b => b.type === 'tool_result')) add(row, { role: 'toolResult', toolCallId: b.tool_use_id, content: typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content || []), isError: !!b.is_error }, b);
      const visible = content.filter(b => b.type === 'text');
      if (visible.length) { add(row, { role: 'user', content: visible }); started = true; }
    } else if (started) {
      const blocks = content.filter(b => {
        if (b.type !== 'tool_use') return b.type === 'text';
        const key = (row.message.id || row.uuid || 'line:' + row.__trajectoryLine) + ':' + b.id;
        if (seenCalls.has(key)) return false;
        seenCalls.add(key); return true;
      }).map(b => b.type === 'tool_use' ? { type: 'toolCall', id: b.id, name: b.name, arguments: b.input || {} } : b);
      if (blocks.length) add(row, { role: 'assistant', content: blocks, model: row.message.model || null });
    }
  }
  return { header: { type: 'session', version: 3, id: native.sessionId, cwd: native.rows.find(r => r.cwd)?.cwd || '/' }, entries, source: native.source, capturedAt: native.capturedAt };
}

export function finalizeClaudeDataset(data, native, projected = projectClaudeTranscript(native)) {
  data.host = 'claude'; data.payload.host = 'claude';
  const session = data.payload.sessions[0]; session.source.host = 'claude';
  data.fingerprint = hash(JSON.stringify({ host: 'claude', session: data.session, sha256: native.source.sha256 }));
  data.logId = 'claude:' + data.session + ':' + data.fingerprint.slice(0, 16);
  data.payload.evidence = { source: native.source, context: { estimate: false, incomplete: true, excluded: ['system prompt', 'tool definitions', 'hidden context', 'request serialization', 'branch selection'] }, agents: 'Only the explicitly selected transcript is included.' };
  data.payload.context.source = { name: 'Claude Code local transcript: visible records only' };
  data.payload.context.requests = []; data.payload.context.current = null;
  data.payload.officialStats = null;
  for (const event of data.payload.events) event.source = 'claude-transcript';
  for (const episode of session.overview.episodes) { episode.id = episode.id.replace(/^pi-/, 'claude-'); episode.condition = 'CLAUDE_TOOL_ERROR'; episode.source = 'claude-transcript'; }
  session.overview.representatives = session.overview.episodes.map(e => e.id);
  const byEntry = new Map(projected.entries.map(e => [e.id, e]));
  const events = new Map(data.payload.events.map(e => [e.seq, e]));
  const calls = new Map(), results = new Map();
  for (const entry of projected.entries) {
    for (const b of entry.claudeRow.message?.content || []) if (b.type === 'tool_use' && !calls.has(b.id)) calls.set(b.id, { entry, block: b });
    if (entry.claudeBlock) results.set(entry.claudeBlock.tool_use_id, { entry, block: entry.claudeBlock });
  }
  for (const fact of Object.values(data.payload.context.callFacts || {})) {
    fact.detail = 'Claude Code · 会话记录'; fact.source = 'claude-transcript';
  }
  for (const record of data.records) {
    let item = byEntry.get(record.native?.entryId), block;
    if (record.kind === 'call') { const found = calls.get(record.native?.callId); item = found?.entry; block = found?.block; }
    if (record.kind === 'result') { const found = results.get(record.native?.callId); item = found?.entry; block = found?.block; }
    if (!item) { const event = events.get(record.seq); item = byEntry.get(event?.id); }
    if (!item) continue;
    const row = item.claudeRow, body = block || row;
    record.body = visible(body); record.nativeHash = hash(body); record.source = 'claude-transcript';
    record.native = { uuid: row.uuid || null, parentUuid: row.parentUuid || null, line: row.__trajectoryLine, messageId: row.message?.id || null, ...(block?.id || block?.tool_use_id ? { callId: block.id || block.tool_use_id } : {}) };
    if (record.kind === 'call') { record.name = block.name; record.arguments = visible(block.input || {}, true); }
  }
  const usageById = new Map();
  for (const row of native.rows) if (row.type === 'assistant' && row.message?.usage) {
    const id = row.message.id || row.uuid || 'line:' + row.__trajectoryLine;
    usageById.set(id, { ...usageById.get(id), ...row.message.usage });
  }
  const assigned = new Set(), usages = [];
  for (const turn of session.turns) for (const step of turn.steps) {
    step.semanticUnit = 'claude-assistant-record';
    const entry = byEntry.get(events.get(step.seq)?.id), row = entry?.claudeRow, id = row?.message?.id || row?.uuid || (row && 'line:' + row.__trajectoryLine);
    const u = usageById.get(id);
    if (u && !assigned.has(id)) {
      assigned.add(id); const number = v => Number.isFinite(v) ? v : null;
      const usage = { input: number(u.input_tokens), output: number(u.output_tokens), cacheRead: number(u.cache_read_input_tokens), cacheWrite: number(u.cache_creation_input_tokens) };
      usages.push({ turn: turn.number, turnId: turn.id, step: step.number, seq: step.seq, time: step.start, usage, source: 'claude-transcript', semanticUnit: 'assistant-message-usage' });
      step.inTok = usage.input; step.cacheTok = usage.cacheRead; step.outTok = usage.output;
    }
    for (const call of step.calls) {
      call.source = 'claude-transcript'; call.timingSource = 'unrecorded-start'; if (call.error) call.error.code = 'CLAUDE_TOOL_ERROR';
      const b = calls.get(call.id)?.block, path = b?.input?.file_path;
      call.semanticKind = ({ Read: 'read', Write: 'write', Edit: 'write', Bash: 'run' })[call.nativeName] || 'other';
      if (path && ['Read', 'Write', 'Edit'].includes(call.nativeName)) {
        call.target = path;
        const cwd = projected.header.cwd, impl = /^[A-Za-z]:[\\/]/.test(path) || cwd.includes('\\') ? win32 : posix;
        data.payload.context.fileOperations.push({ seq: call.seq, turn: turn.number, step: step.number, path: impl.resolve(cwd, path), kind: call.nativeName === 'Read' ? 'read' : 'change', status: call.status, time: call.start, end: call.end, source: 'claude-transcript', nativeKind: call.nativeName });
      }
    }
  }
  data.payload.context.usage = usages;
  for (const file of data.payload.context.fileOperations) if (file.source === 'pi-session-v3') file.source = 'claude-transcript';
  for (const skill of data.payload.context.skillEvents) skill.source = 'claude-transcript';
  return data;
}
