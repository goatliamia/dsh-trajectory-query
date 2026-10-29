// Version pages against DSH's live cut / persistence revision, including child
// logs. A parent seq alone cannot version historical or child sessions.
// Cordis returns a fresh context-bound proxy from get(); compare the owning
// service, not that proxy, or every otherwise-valid cache entry misses.
const ownerOf = service => service?.[Symbol.for("cordis.original")] ?? service;

export async function traceSource(ctx, sessionId, signal) {
  const sessions = ctx.get("sessions");
  const live = sessions?.get?.(sessionId);
  if (typeof live?.seq === "number") return { owner: ownerOf(sessions), revision: "live:" + live.seq };
  const persistence = ctx.get("sessionPersistence");
  if (typeof persistence?.stat !== "function") return null;
  try {
    const stored = await persistence.stat(sessionId, signal ? { signal } : undefined);
    const attached = sessions?.get?.(sessionId);
    if (typeof attached?.seq === "number") return { owner: ownerOf(sessions), revision: "live:" + attached.seq };
    if (stored === undefined) return { owner: ownerOf(persistence), revision: "missing" };
    return typeof stored.revision === "string" ? { owner: ownerOf(persistence), revision: stored.revision } : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function observationSource(ctx, observation, fallback) {
  if (observation.source === "live" && Number.isInteger(observation.cursor)) {
    return { owner: ownerOf(ctx.get("sessions")), revision: "live:" + (observation.cursor + 1) };
  }
  if (typeof observation.revision === "string") {
    return { owner: ownerOf(ctx.get("sessionPersistence")), revision: observation.revision };
  }
  return fallback;
}

export const sameSource = (a, b) => a != null && b != null && a.owner === b.owner && a.revision === b.revision;

export class TraceCache {
  constructor(ctx, capacity = 4, resources) {
    this.ctx = ctx;
    this.capacity = capacity;
    this.entries = new Map();
    this.pending = new Map();
    this.resources = resources;
  }

  async get(sessionId, source, assets) {
    const entry = this.entries.get(sessionId);
    if (!entry || !sameSource(entry.source, source) || entry.assets !== assets || Date.now() >= entry.retryAt) return;
    const valid = await Promise.all([...entry.children].map(async ([id, version]) =>
      sameSource(version, await traceSource(this.ctx, id, AbortSignal.timeout(1200))))).catch(() => [false]);
    if (valid.some(ok => !ok) || this.entries.get(sessionId) !== entry) return;
    this.entries.delete(sessionId);
    this.entries.set(sessionId, entry);
    if (this.resources && this.resources.get(entry.resourceKey) !== entry) { this.entries.delete(sessionId); return; }
    return entry;
  }

  async build(sessionId, source, assets, build) {
    const pending = this.pending.get(sessionId);
    if (pending && pending.assets === assets && sameSource(pending.source, source)) return pending.promise;
    const job = { source, assets };
    job.promise = Promise.resolve().then(build).then(entry => {
      // A slower, older cut must not overwrite a newer in-flight request.
      if (this.pending.get(sessionId) === job) {
        this.entries.delete(sessionId);
        this.entries.set(sessionId, entry);
        if (this.resources) this.resources.retain(entry, () => {
          if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId);
          entry.dispose?.();
        });
        while (this.entries.size > this.capacity) {
          const id = this.entries.keys().next().value, oldest = this.entries.get(id);
          this.entries.delete(id); this.resources?.remove(oldest.resourceKey);
        }
      }
      return entry;
    }).finally(() => {
      if (this.pending.get(sessionId) === job) this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, job);
    return job.promise;
  }
}
