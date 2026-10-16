/**
 * Second, independent implementation of the wallet HISTORY rules (README "Wallet history"), written from the README, imports nothing from
 * credits/ or load/. The verifier recomputes the ledger from the dump and core.json with it and compares every row of the database.
 *
 * The rules, in short: one ledger row per (local day, category) of the message charges that were not reverted; a reverted charge
 * (revert=true with a reverted_at) is a deduction on its day and a refund on the day it was reverted (a reverted row without
 * reverted_at is refused-at-send, worth nothing); one row per AI charge; one row per top-up / removal / purchase of core.json
 * walletEvents; an opening row = live balance minus everything else, one second before the first row. Only what happened up to the
 * moment the live balance was read counts. Amounts are exact decimals at four fraction digits, half away from zero.
 */
export interface OracleHistoryInput {
  client: string;
  /** live balance as text */
  balanceText: string;
  asOf: string;
  timezone: string;
  creditLogs: Array<Record<string, unknown>>;
  charges: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  workspaceId: string | null;
}

export interface OracleHistoryRow {
  key: string;
  atMs: number;
  type: 'spend' | 'refund' | 'topup' | 'admin_adjust';
  /** signed, x 10^4 */
  amount: bigint;
  balanceAfter: bigint;
}

/** value x 10^4, half away from zero, from a number or a numeric string; null when it is neither */
export function fourDigits(v: unknown): bigint | null {
  let t: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    t = String(v);
  } else if (typeof v === 'string') t = v.trim();
  else return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const neg = m[1] === '-';
  let digits = (m[2] ?? '') + (m[3] ?? '');
  let point = (m[2] ?? '').length + Number(m[4] ?? 0); // digits before the decimal point
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const whole = digits.slice(0, point) || '0';
  const frac = digits.slice(point);
  let n = BigInt(whole + frac.slice(0, 4).padEnd(4, '0'));
  if (frac.length > 4 && frac.charCodeAt(4) >= 53) n += 1n;
  return neg ? -n : n;
}

const asMs = (v: unknown): number | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'string' && v.trim() !== '') {
    const ms = Date.parse(v.trim());
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  return null;
};

const truthy = (v: unknown): boolean =>
  v === true ||
  v === 1 ||
  (typeof v === 'string' && ['true', '1', 'yes', 'y', 't'].includes(v.trim().toLowerCase()));

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

const idOf = (d: Record<string, unknown>): string => text(d._id) || text(d.id);

const zone = new Map<string, Intl.DateTimeFormat | null>();
const localDay = (ms: number, tz: string): string => {
  let f = zone.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      f = null;
    }
    zone.set(tz, f);
  }
  return f ? f.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
};

export function oracleHistory(i: OracleHistoryInput): { rows: OracleHistoryRow[]; opening: bigint } {
  const asOfMs = Date.parse(i.asOf);
  const target = fourDigits(i.balanceText);
  if (target === null || !Number.isFinite(asOfMs))
    throw new Error('oracleHistory: no balance or no read time');
  const p = `waboo:${i.client}:`;
  const out: Array<Omit<OracleHistoryRow, 'balanceAfter'>> = [];

  type Acc = { amount: bigint; at: number };
  const day = (m: Map<string, Acc>, d: string, cat: string, amt: bigint, at: number): void => {
    const k = `${d}:${cat}`;
    const a = m.get(k) ?? { amount: 0n, at: 0 };
    a.amount += amt;
    if (at > a.at) a.at = at;
    m.set(k, a);
  };
  const charged = new Map<string, Acc>();
  const chargedThenReverted = new Map<string, Acc>();
  const reverted = new Map<string, Acc>();
  const seen = new Set<string>();
  for (const d of i.charges) {
    const id = idOf(d);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const at = asMs(d.created_time);
    const amt = fourDigits(d.amount);
    if (at === null || amt === null || amt <= 0n || at > asOfMs) continue;
    const cat = (text(d.template_category) || text(d.origin) || 'message').toLowerCase();
    if (!truthy(d.revert)) {
      day(charged, localDay(at, i.timezone), cat, amt, at);
      continue;
    }
    const back = asMs(d.reverted_at);
    if (back === null) continue;
    day(chargedThenReverted, localDay(at, i.timezone), cat, amt, at);
    if (back <= asOfMs) day(reverted, localDay(back, i.timezone), cat, amt, back);
  }
  const emit = (m: Map<string, Acc>, kind: string, sign: bigint, type: 'spend' | 'refund'): void => {
    for (const [k, a] of m)
      out.push({ key: `${p}wa:${kind}:${k}`, atMs: a.at, type, amount: sign * a.amount });
  };
  emit(charged, 'chg', -1n, 'spend');
  emit(chargedThenReverted, 'rchg', -1n, 'spend');
  emit(reverted, 'rev', 1n, 'refund');

  const aiSeen = new Set<string>();
  for (const d of i.creditLogs) {
    const id = idOf(d);
    if (id === '' || aiSeen.has(id)) continue;
    aiSeen.add(id);
    if (i.workspaceId !== null && text(d.workspace_id) !== i.workspaceId) continue;
    const at = asMs(d.created_time);
    const amt = fourDigits(d.credits_deducted);
    if (at === null || amt === null || amt <= 0n || at > asOfMs) continue;
    out.push({ key: `${p}credit_log:${id}`, atMs: at, type: 'spend', amount: -amt });
  }

  const evSeen = new Set<string>();
  for (const e of i.events) {
    const k = `${text(e.src)}:${text(e.id)}`;
    if (evSeen.has(k)) continue;
    evSeen.add(k);
    const at = asMs(e.at);
    const amt = fourDigits(e.delta);
    if (at === null || amt === null || amt === 0n || at > asOfMs) continue;
    const expense = e.src === 'expense';
    out.push({
      key: `${p}${expense ? 'expense' : 'reseller'}:${text(e.id)}`,
      atMs: at,
      type: amt > 0n ? 'topup' : expense ? 'spend' : 'admin_adjust',
      amount: amt,
    });
  }

  out.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const net = out.reduce((s, r) => s + r.amount, 0n);
  const opening = target - net;
  const rows: OracleHistoryRow[] = [];
  let bal = 0n;
  if (opening > 0n) {
    bal = opening;
    rows.push({
      key: `${p}opening`,
      atMs: (out[0]?.atMs ?? asOfMs) - 1000,
      type: 'admin_adjust',
      amount: opening,
      balanceAfter: bal,
    });
  }
  for (const r of out) {
    bal += r.amount;
    rows.push({ ...r, balanceAfter: bal });
  }
  return { rows, opening };
}
