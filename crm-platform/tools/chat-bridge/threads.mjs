// Bounded in-memory map fingerprint -> { threadKey, startedAt, peak, diagnosis }. Size cap + TTL; lost on restart on purpose
// (a resolved alert with no known start still posts, see bridge.mjs). Memory: at most `max` small entries.
export function createThreads({ max = 500, ttlMs = 7 * 86400e3, now = Date.now } = {}) {
  const m = new Map();
  const prune = () => { const t = now(); for (const [k, v] of m) if (t - v.seen > ttlMs) m.delete(k); while (m.size > max) m.delete(m.keys().next().value); };
  return {
    get(fp) { prune(); return m.get(fp); },
    put(fp, v) { m.delete(fp); m.set(fp, { ...v, seen: now() }); prune(); return m.get(fp); },
    delete: (fp) => m.delete(fp),
    get size() { return m.size; },
  };
}
export const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
