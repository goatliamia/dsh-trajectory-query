// Immutable fragment identities and recorded logical order; no text semantics.
export function validateAssemblyData(data) {
  if (data.kind !== 'context-assembly' || !data.blocks || Array.isArray(data.blocks)) throw Error('Assembly needs recorded structure, not token totals');
  if (!Number.isSafeInteger(data.source?.cut) || data.source.cut < 0) throw Error('Assembly needs a frozen source cut');
  if (!data.rows.length || data.rows.length > 48 || Object.keys(data.blocks).length > 8192) throw Error('Choose at most 48 assembly positions and 8192 distinct fragments');
  let previous = -1;
  for (const row of data.rows) {
    if (!Number.isSafeInteger(row.asOfSeq) || row.asOfSeq < previous || Number.isFinite(data.source.cut) && row.asOfSeq > data.source.cut) throw Error('Assembly positions must follow their source cut');
    previous = row.asOfSeq;
    const all = [];
    for (const region of ['system','tools','history']) {
      const ids = row[region];
      if (!Array.isArray(ids) || ids.length > (region === 'history' ? 4096 : 16)) throw Error('Assembly regions require bounded fragment identities');
      for (const id of ids) {
        const block = data.blocks[id];
        if (!Object.hasOwn(data.blocks,id) || !block || typeof block.category !== 'string') throw Error('Unknown assembly fragment: ' + id);
        if ((block.evidence || []).some(ref => ref.session !== data.source.session || ref.log !== data.source.log || !Number.isSafeInteger(ref.seq) || ref.seq < 0 || ref.seq > row.asOfSeq)) throw Error('Assembly fragment is outside its recorded position');
      }
      all.push(...ids);
    }
    if (new Set(all).size !== all.length) throw Error('A fragment cannot occupy two assembly positions');
  }
  return data;
}

export function assemblyFrames(data, spec = {}) {
  const wanted = spec.rows && new Set(spec.rows);
  const frames = data.rows.filter(row => !wanted || wanted.has(row.id));
  if (!frames.length || wanted && frames.length !== wanted.size) throw Error('Assembly frame selection does not match this dataset');
  if (spec.initialRow && !frames.some(row => row.id === spec.initialRow)) throw Error('Assembly initialRow is outside the selected positions');
  return frames;
}

export function assemblyDiff(before, after) {
  const result = { added: [], removed: [], regions: {}, changed: false, rewrite: false, prefix: 0 };
  for (const region of ['system','tools','history']) {
    const a = before?.[region] || [], b = after[region], old = new Set(a), next = new Set(b);
    let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    const added = b.filter(id => !old.has(id)), removed = a.filter(id => !next.has(id));
    const changed = prefix !== a.length || prefix !== b.length;
    result.regions[region] = { added, removed, prefix, changed, rewrite: !!before && prefix < a.length };
    result.added.push(...added); result.removed.push(...removed); result.changed ||= changed;
    result.rewrite ||= result.regions[region].rewrite;
  }
  result.prefix = result.regions.history.prefix;
  return result;
}

export function assemblyLayout(frame, data, { focus = [], offset = null } = {}) {
  const groups = [];
  frame.history.forEach((id, ordinal) => {
    const block = data.blocks[id], key = block.turn ?? 'unknown';
    if (groups.at(-1)?.key !== key) groups.push({ key, ids: [], start: ordinal });
    groups.at(-1).ids.push(id);
  });
  const focusSet = new Set(focus), hit = groups.findIndex(group => group.ids.some(id => focusSet.has(id)));
  const start = Math.max(0, Math.min(Math.max(0, groups.length - 12), offset ?? (hit >= 0 ? hit - 2 : groups.length - 12)));
  return { groups, start, shown: groups.slice(start, start + 12), before: groups.slice(0,start).reduce((n,g)=>n+g.ids.length,0), after: groups.slice(start+12).reduce((n,g)=>n+g.ids.length,0) };
}
