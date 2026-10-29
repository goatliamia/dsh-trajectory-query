// Historical skill text and native surface membership are independent from
// behavioral attribution. No arbitrary tool execution is assigned to a skill.
export function skillContents(text, toolNames = []) {
  const body = text.match(/<skill_instructions>([\s\S]*?)<\/skill_instructions>/)?.[1]?.trim() || text;
  const names = new Set(toolNames), tools = [], scripts = [], seen = new Set();
  for (const line of body.split(/\r?\n/)) {
    for (const match of line.matchAll(/`([a-zA-Z_][\w.-]*)`/g)) {
      if (names.has(match[1]) && !tools.some(t => t.name === match[1])) tools.push({ name: match[1], quote: line.trim(), basis: 'literal-tool-reference' });
    }
    for (const match of line.matchAll(/\b(?:python3?|node|bash|sh|pwsh\s+-File)\s+["']?([^\s"'`<>]+\.(?:py|mjs|js|ps1|sh))\b/gi)) {
      const path = match[1].replace(/\\/g, '/'); if (seen.has(path)) continue; seen.add(path);
      scripts.push({ path, quote: line.trim(), basis: 'documented-command' });
    }
  }
  return { body, tools, scripts };
}

export function directlyInvokedScripts(command) {
  const scripts = [];
  for (const match of command.matchAll(/(?:^|\n|;|&&|\|\|)\s*&?\s*(?:python3?|node|bash|sh|pwsh\s+-File)\s+["']?([^\s"'`<>]+\.(?:py|mjs|js|ps1|sh))\b/gi)) scripts.push(match[1].replace(/\\/g, '/'));
  return scripts;
}

export function replaySkillEvidence(events, loads, requestSeqs, SurfaceManager) {
  const result = { source: '@deepseek-ai/dsh-session/surface', basis: 'canonical-model-visible-history', records: [] };
  if (!loads.length) return result;
  const bySeq = new Map(events.map(e => [e.seq, e])), requests = new Set(requestSeqs);
  const toolNames = [...new Set(events.filter(e => e.type === 'request/header').flatMap(e => (e.data.header?.tools || []).map(t => t.name)))];
  const textOf = message => (message?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
  const records = loads.map(load => ({ ...load, ...skillContents(textOf(bySeq.get(load.resultSeq)?.data.message), toolNames), intervals: [], mentions: [], matches: [] }));
  const log = [], surface = new SurfaceManager(log), open = new Map();
  let replaceGeneration = -1, contentGeneration = -1;
  for (const event of events) {
    if (requests.has(event.seq)) for (const interval of open.values()) interval.requests++;
    log.push(event);
    // The official manager folds the new event. Ordinary appends cannot remove
    // an existing skill body; recheck only its load or a replacement/projection.
    const nodes = surface.nodes;
    const replaced = surface.replaceGeneration, projected = surface.contentGeneration;
    const changed = typeof replaced !== 'number' || typeof projected !== 'number'
      || replaced !== replaceGeneration || projected !== contentGeneration;
    for (const skill of records) {
      if (!changed && event.seq !== skill.resultSeq) continue;
      const retained = nodes.includes(skill.resultSeq) && textOf(surface.deriveEventMessage(bySeq.get(skill.resultSeq))).includes(skill.body);
      if (retained && !open.has(skill.id)) {
        const interval = { from: event.time, fromSeq: event.seq, turn: event.data.turn ?? skill.turn, requests: 0, to: null, toSeq: null, endReason: null };
        open.set(skill.id, interval); skill.intervals.push(interval);
      } else if (!retained && open.has(skill.id)) {
        Object.assign(open.get(skill.id), { to: event.time, toSeq: event.seq, endReason: event.surfaceOp?.op === 'replace' ? 'surface-replaced' : 'content-changed' }); open.delete(skill.id);
      }
    }
    replaceGeneration = replaced; contentGeneration = projected;
  }
  const last = events.at(-1);
  for (const interval of open.values()) Object.assign(interval, { to: last.time, toSeq: last.seq, endReason: 'snapshot-end' });
  const inScope = (skill, time) => skill.intervals.some(i => time >= i.from && time < i.to);
  for (const event of events) for (const skill of records) {
    if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      const text = textOf(event.data.message), index = text.indexOf(skill.name);
      if (index >= 0 && event.seq > skill.resultSeq) skill.mentions.push({ seq: event.seq, turn: event.data.turn, step: event.data.step, time: event.time,
        quote: text.slice(Math.max(0, index - 80), Math.min(text.length, index + 260)), kind: 'explicit-name-mention', retained: inScope(skill, event.time) });
    }
    if (event.type !== 'tool/call' || !inScope(skill, event.time)) continue;
    const direct = skill.tools.find(t => t.name === event.data.name);
    if (direct) skill.matches.push({ seq: event.seq, turn: event.data.turn, step: event.data.step, time: event.time, tool: event.data.name, basis: 'documented-tool-called', quote: direct.quote });
    if (!['pwsh', 'bash', 'exec_command', 'run_code'].includes(event.data.name)) continue;
    let args = event.data.arguments; if (typeof args === 'string') { try { args = JSON.parse(args); } catch { continue; } }
    const command = args?.command ?? args?.cmd ?? args?.code;
    if (typeof command !== 'string') continue;
    // Only executable command positions qualify; a write/grep/echo containing
    // the script name is not evidence that the script was run.
    const executed = directlyInvokedScripts(command);
    for (const script of skill.scripts) if (executed.includes(script.path)) skill.matches.push({ seq: event.seq, turn: event.data.turn, step: event.data.step, time: event.time, tool: event.data.name, basis: 'documented-script-command', path: script.path, quote: script.quote });
  }
  return { ...result, records };
}
