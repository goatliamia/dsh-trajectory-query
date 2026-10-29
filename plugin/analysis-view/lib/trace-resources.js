// Shared by HTML and staged responses. One eviction path owns every strong
// cache reference; queued work contains IDs/closures, not another parsed log.
export const abortError = () => new DOMException('Trace view was released', 'AbortError');
export function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason || abortError());
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export class TraceQueue {
  constructor(limit) { this.limit = limit; this.running = 0; this.pending = []; this.closed = false; }
  run(task, signal, priority = 0) {
    if (this.closed) return Promise.reject(abortError());
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const job = { task, signal, priority, resolve, reject, started: false };
      job.stop = () => {
        if (job.started) return;
        this.pending = this.pending.filter(row => row !== job);
        reject(signal.reason || abortError());
      };
      signal?.addEventListener('abort', job.stop, { once: true });
      const at = this.pending.findIndex(row => row.priority > priority);
      if (at < 0) this.pending.push(job); else this.pending.splice(at, 0, job);
      this.pump();
    });
  }
  pump() {
    while (!this.closed && this.running < this.limit && this.pending.length) {
      const job = this.pending.shift();
      job.signal?.removeEventListener('abort', job.stop);
      if (job.signal?.aborted) { job.reject(job.signal.reason || abortError()); continue; }
      job.started = true; this.running++;
      Promise.resolve().then(() => job.task(job.signal)).then(job.resolve, job.reject)
        .finally(() => { this.running--; this.pump(); });
    }
  }
  dispose() {
    this.closed = true;
    for (const job of this.pending.splice(0)) {
      job.signal?.removeEventListener('abort', job.stop); job.reject(abortError());
    }
  }
}

// Conservative retained-data estimate, not a promise about V8's process RSS.
// Shared objects are counted once; serialized JSON is never retained alongside
// the parsed payload once compression has completed.
export function traceBytes(entry) {
  const seen = new Set(), keys = new Set(), stack = [entry.payload, entry.core, entry.actorData, entry.historyData, entry.html];
  let bytes = entry.encodedBytes || 0;
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === 'string') { bytes += 24 + value.length * 2; continue; }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) { bytes += 32 + value.length * 8; for (const field of value) stack.push(field); }
    else {
      bytes += 64;
      for (const [key, field] of Object.entries(value)) {
        if (!keys.has(key)) { keys.add(key); bytes += key.length * 2 + 24; }
        bytes += 16;
        if (field && (typeof field === 'object' || typeof field === 'string')) stack.push(field);
      }
    }
  }
  return bytes;
}

export class TraceResources {
  constructor({ maxEntries = 4, maxBytes = 64 * 1024 * 1024, idleMs = 120000, now = Date.now } = {}) {
    Object.assign(this, { maxEntries, maxBytes, idleMs, now });
    this.entries = new Map(); this.timer = null;
    this.main = new TraceQueue(1); this.actors = new TraceQueue(1); this.children = new TraceQueue(2); this.history = new TraceQueue(1);
    this.encoding = new TraceQueue(2);
  }
  get bytes() { return [...this.entries.values()].reduce((sum, row) => sum + row.bytes, 0); }
  get(key) {
    const row = this.entries.get(key);
    if (!row) return;
    if (this.now() - row.at >= this.idleMs) { this.remove(key); return; }
    this.entries.delete(key); row.at = this.now(); this.entries.set(key, row); this.arm();
    return row.entry;
  }
  retain(entry, evict) {
    this.entries.delete(entry.resourceKey);
    this.entries.set(entry.resourceKey, { entry, evict, at: this.now(), bytes: traceBytes(entry) });
    this.trim(); this.arm();
  }
  update(entry) {
    const row = this.entries.get(entry.resourceKey);
    if (!row || row.entry !== entry) return;
    row.bytes = traceBytes(entry); this.trim();
  }
  remove(key) {
    const row = this.entries.get(key);
    if (!row) return;
    this.entries.delete(key); row.evict?.();
  }
  trim() {
    // A single unusually large current graph can exceed the estimate budget;
    // it never causes several oversized graphs to be retained together.
    while (this.entries.size > this.maxEntries || (this.entries.size > 1 && this.bytes > this.maxBytes)) this.remove(this.entries.keys().next().value);
  }
  arm() {
    clearTimeout(this.timer);
    if (!this.entries.size) return;
    const due = Math.min(...[...this.entries.values()].map(row => row.at + this.idleMs));
    this.timer = setTimeout(() => {
      for (const [key, row] of this.entries) if (this.now() - row.at >= this.idleMs) this.remove(key);
      this.arm();
    }, Math.max(1, due - this.now()));
    this.timer.unref?.();
  }
  dispose() {
    clearTimeout(this.timer);
    for (const key of [...this.entries.keys()]) this.remove(key);
    this.main.dispose(); this.actors.dispose(); this.children.dispose(); this.history.dispose();
    this.encoding.dispose();
  }
}
