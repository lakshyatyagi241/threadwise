/**
 * Redis keys of the send governor. One hash tag per phone number (`{<id>}`) so every key a Lua script touches for a number lives in
 * one cluster slot. Phone number ids are Meta's, unique across workspaces, which is what lets a pacing budget be per number and not
 * per tenant: Meta counts the number's throughput, whoever sends through it.
 */
const P = 'wa:gov';

export const govKeys = {
  global: `${P}:global`,
  cfg: (pn: string) => `${P}:{${pn}}:cfg`,
  slot: (pn: string) => `${P}:{${pn}}:slot`,
  penalty: (pn: string) => `${P}:{${pn}}:pen`,
  second: (pn: string, sec: number) => `${P}:{${pn}}:s:${sec}`,
  minute: (pn: string, min: number) => `${P}:{${pn}}:m:${min}`,
  tier: (pn: string, hour: number) => `${P}:{${pn}}:t:${hour}`,
  events: (pn: string) => `${P}:{${pn}}:ev`,
  eventGate: (pn: string, kind: string) => `${P}:{${pn}}:evk:${kind}`,
  syncLock: `${P}:sync:lock`,
};

/** Retention of the counters the console reads. */
export const SECOND_TTL_S = 180;
export const MINUTE_TTL_S = 3 * 3600;
/** Hour buckets of the daily tier count: 24 are read, one more is kept so the boundary never drops a recipient early. */
export const TIER_BUCKET_TTL_S = 26 * 3600;
export const CFG_TTL_S = 3 * 24 * 3600;
export const EVENTS_MAX = 100;
export const EVENTS_TTL_S = 7 * 24 * 3600;
