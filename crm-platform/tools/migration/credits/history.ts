import { createHash } from 'node:crypto';
import { badText, docKeysWith, bool, str, toDate, uuidv5, type Doc } from '../util';
import { plainDecimal } from './decimal';
import { clip, workspaceOf } from './rules';

/**
 * The wallet HISTORY of a client: what Waboo's "Track Expenses" and top-up logs show, as a complete, chained WaDesk ledger. Pure: documents in,
 * rows out (load/wallethistory.ts writes them; reconcile/oracle-history.ts recomputes them on its own).
 *
 * Why: the first credits design posted ONE confirmed opening balance and only the AI charges, so a client's WaDesk statement showed 4 rows
 * where Waboo shows thousands (message charges, refunds, purchases, top-ups). The money is all in the dump, and it adds up: Rhythm Watches'
 * charges, top-ups and purchases reproduce Waboo's live balance to the paisa. So the ledger is rebuilt from them.
 *
 * Rows (amounts are exact 4-decimal text; numeric(20,4) holds Waboo's 1.525 / 5.956 as they are):
 *  - message charges: `whatsapp_broadcasting_data` rows that were not reverted, summed per LOCAL DAY and category: one `spend`
 *    "Balance Deducted For Whatsapp <Category>" (Waboo's list has exactly this granularity: ISKM 2026-10-14 utility = 6 x 1.525 = 9.15);
 *  - a charge that Waboo later reverted (`revert` with a `reverted_at`) is a deduction on its day AND a `refund` "Balance Reverted For
 *    Whatsapp <Category>" on the day it was reverted (Waboo lists only the revert; the balance needs both). A reverted row with no
 *    `reverted_at` was refused at send time and is worth nothing (counted);
 *  - `credit_logs` (AI): one `spend` per document, amount at 4 decimals (a charge of 0.004132 is a row of 0.0041);
 *  - top-ups and removals (geta_core `reseller_credit_logs`) and purchases (`credits_expenses`): from core.json `walletEvents`, each with
 *    its signed delta: `topup` in, `admin_adjust` out (with the reason), a purchase debit `spend`;
 *  - the opening entry: target (the live Waboo balance) minus everything above, one second before the first row. It is the balance the
 *    wallet had before the oldest record (free credit and anything Waboo never logged). It must not be negative.
 * Only rows up to `asOfMs` (the moment the live balance was read) take part, so the chain ends exactly at the target.
 * Refused (nothing written): an opening below zero, or a chain that dips deeper than MAX_OVERDRAFT. A small dip below zero is real (Waboo
 * lets a wallet overdraw by a few messages): it is kept and reported.
 */
export class HistoryError extends Error {}

export interface CoreWalletEvent {
  src: 'reseller' | 'expense';
  id: string;
  at: string;
  /** signed money in (+) / out (-) for THIS workspace */
  delta: number | string;
  /** balance of this workspace before the event (reseller log only) */
  prev?: number | null;
  reason?: string | null;
  invoice?: string | null;
}

export interface HistoryInput {
  client: string;
  /** target balance in 1e-4 units */
  targetMinor: bigint;
  asOfMs: number;
  /** IANA zone of the workspace: the "day" of a charge */
  timezone: string;
  creditLogs: Doc[];
  charges: Doc[];
  events: CoreWalletEvent[];
  /** only credit_logs of this Waboo workspace_id load (the credits step's switch); null = all */
  workspaceId: string | null;
}

export type HistoryType = 'spend' | 'refund' | 'topup' | 'admin_adjust';

export interface HistoryRow {
  /** idempotency_key */
  key: string;
  uuid: string;
  atMs: number;
  type: HistoryType;
  /** signed, 1e-4 */
  minor: bigint;
  description: string;
  note: string | null;
  source: string;
  actorType: 'system' | 'platform_operator';
  meta: Record<string, unknown>;
  balanceAfter: bigint;
}

export interface HistoryPlan {
  rows: HistoryRow[];
  openingMinor: bigint;
  stats: {
    chargeDocs: number;
    deductionRows: number;
    revertedRows: number;
    refundRows: number;
    neutralReverted: number;
    aiRows: number;
    eventRows: number;
    skippedAfterAsOf: number;
    unreadable: number;
  };
  /** reseller checkpoints whose logged balance differs from the chain by more than 1.00 */
  checkpointMisses: Array<{ id: string; at: string; logged: string; chain: string }>;
  checkpoints: number;
  /** the lowest balance_after of the chain, and how many rows end below zero (Waboo lets a wallet overdraw by a few messages) */
  lowest: bigint;
  belowZero: number;
  fingerprint: string;
}

/** A chain that dips deeper than this (1e-4 units, 1,000.00) is not an overdraft: the logs and the balance do not belong together. */
export const MAX_OVERDRAFT = 10_000_000n;

/** A decimal text rounded half away from zero to 4 fraction digits, as 1e-4 units. */
export function to4(v: unknown): bigint | null {
  const p = plainDecimal(v);
  if (p === null) return null;
  const neg = p.startsWith('-');
  const [i, f = ''] = (neg ? p.slice(1) : p).split('.');
  let n = BigInt(i! + f.slice(0, 4).padEnd(4, '0'));
  if (f.length > 4 && f.charCodeAt(4) >= 53) n += 1n;
  return neg ? -n : n;
}

export function text4(m: bigint): string {
  const neg = m < 0n;
  const a = (neg ? -m : m).toString().padStart(5, '0');
  return `${neg ? '-' : ''}${a.slice(0, -4)}.${a.slice(-4)}`;
}

// one formatter per zone: building one per charge (tens of thousands) exhausts native memory long before the JS heap limit
const formatters = new Map<string, Intl.DateTimeFormat | null>();
const dayIn = (ms: number, tz: string): string => {
  let f = formatters.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = null;
    }
    formatters.set(tz, f);
  }
  return f ? f.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
};

const title = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();

interface Group {
  day: string;
  cat: string;
  minor: bigint;
  n: number;
  atMs: number;
}

const add = (m: Map<string, Group>, day: string, cat: string, minor: bigint, atMs: number): void => {
  const k = `${day}:${cat}`;
  const g = m.get(k) ?? { day, cat, minor: 0n, n: 0, atMs: 0 };
  g.minor += minor;
  g.n++;
  if (atMs > g.atMs) g.atMs = atMs;
  m.set(k, g);
};

export function planHistory(i: HistoryInput): HistoryPlan {
  const stats: HistoryPlan['stats'] = {
    chargeDocs: 0,
    deductionRows: 0,
    revertedRows: 0,
    refundRows: 0,
    neutralReverted: 0,
    aiRows: 0,
    eventRows: 0,
    skippedAfterAsOf: 0,
    unreadable: 0,
  };
  const prefix = `waboo:${i.client}:`;
  const rows: Omit<HistoryRow, 'balanceAfter'>[] = [];
  // every single effect on the balance (a charge, a refund ...) with its own instant: the daily rows lose the order inside a day, so the
  // top-up checkpoints are judged on these
  const fine: Array<{ atMs: number; minor: bigint }> = [];

  // ---- message charges
  const spend = new Map<string, Group>();
  const spendReverted = new Map<string, Group>();
  const refund = new Map<string, Group>();
  const seen = new Set<string>();
  for (const doc of i.charges) {
    const key = docKeysWith(doc)[0]?.key;
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    if (badText(doc)) continue;
    const at = toDate(doc.created_time);
    const minor = to4(doc.amount);
    if (!at || minor === null) {
      stats.unreadable++;
      continue;
    }
    if (minor <= 0n) continue;
    stats.chargeDocs++;
    const atMs = at.getTime();
    if (atMs > i.asOfMs) {
      stats.skippedAfterAsOf++;
      continue;
    }
    const cat = title(str(doc.template_category) ?? str(doc.origin) ?? 'message');
    if (!bool(doc.revert)) {
      fine.push({ atMs, minor: -minor });
      add(spend, dayIn(atMs, i.timezone), cat, minor, atMs);
      continue;
    }
    const back = toDate(doc.reverted_at);
    if (!back) {
      stats.neutralReverted++; // refused at send time: charged and given back in the same breath, no trace in the balance
      continue;
    }
    fine.push({ atMs, minor: -minor });
    add(spendReverted, dayIn(atMs, i.timezone), cat, minor, atMs);
    if (back.getTime() <= i.asOfMs) fine.push({ atMs: back.getTime(), minor });
    if (back.getTime() <= i.asOfMs)
      add(refund, dayIn(back.getTime(), i.timezone), cat, minor, back.getTime());
  }
  const groupRows = (
    m: Map<string, Group>,
    kind: 'chg' | 'rchg' | 'rev',
    sign: 1n | -1n,
    type: HistoryType,
    label: (cat: string) => string,
  ): void => {
    for (const g of m.values()) {
      const key = `${prefix}wa:${kind}:${g.day}:${g.cat.toLowerCase()}`;
      rows.push({
        key,
        uuid: uuidv5(`${i.client}|wallet_history|${key}`),
        atMs: g.atMs,
        type,
        minor: sign * g.minor,
        description: label(g.cat),
        note: null,
        source: 'waboo_whatsapp',
        actorType: 'system',
        meta: {
          legacy: {
            waboo: {
              kind: kind === 'rev' ? 'whatsapp_revert' : 'whatsapp_charge',
              day: g.day,
              category: g.cat,
              messages: g.n,
              timezone: i.timezone,
            },
          },
        },
      });
    }
  };
  groupRows(spend, 'chg', -1n, 'spend', (c) => `Balance Deducted For Whatsapp ${c}`);
  groupRows(
    spendReverted,
    'rchg',
    -1n,
    'spend',
    (c) => `Balance Deducted For Whatsapp ${c} (messages reverted later)`,
  );
  groupRows(refund, 'rev', 1n, 'refund', (c) => `Balance Reverted For Whatsapp ${c}`);
  stats.deductionRows = spend.size;
  stats.revertedRows = spendReverted.size;
  stats.refundRows = refund.size;

  // ---- AI charges
  const ai = new Set<string>();
  for (const doc of i.creditLogs) {
    const k = docKeysWith(doc)[0]?.key;
    if (k === undefined || ai.has(k)) continue;
    ai.add(k);
    if (badText(doc)) continue;
    if (i.workspaceId !== null && workspaceOf(doc) !== i.workspaceId) continue;
    const at = toDate(doc.created_time);
    const minor = to4(doc.credits_deducted);
    if (!at || minor === null || minor <= 0n) continue;
    if (at.getTime() > i.asOfMs) {
      stats.skippedAfterAsOf++;
      continue;
    }
    stats.aiRows++;
    fine.push({ atMs: at.getTime(), minor: -minor });
    rows.push({
      key: `${prefix}credit_log:${k}`,
      uuid: uuidv5(`${i.client}|credit_logs|${k}`),
      atMs: at.getTime(),
      type: 'spend',
      minor: -minor,
      description: clip(doc.description, 500) ?? 'AI usage',
      note: null,
      source: 'waboo_ai',
      actorType: 'system',
      meta: {
        legacy: {
          waboo: {
            id: k,
            credits_deducted: plainDecimal(doc.credits_deducted),
            action: clip(doc.action, 120),
            module: clip(doc.module, 60),
          },
        },
      },
    });
  }

  // ---- top-ups, removals and purchases
  const evSeen = new Set<string>();
  for (const e of i.events) {
    const ek = `${e.src}:${e.id}`;
    if (evSeen.has(ek)) continue;
    evSeen.add(ek);
    const at = toDate(e.at);
    const minor = to4(e.delta);
    if (!at || minor === null || minor === 0n) {
      stats.unreadable++;
      continue;
    }
    if (at.getTime() > i.asOfMs) {
      stats.skippedAfterAsOf++;
      continue;
    }
    stats.eventRows++;
    fine.push({ atMs: at.getTime(), minor });
    const key = `${prefix}${e.src}:${e.id}`;
    const reason = (e.reason ?? '').trim();
    const money = minor < 0n;
    const purchase = e.src === 'expense';
    rows.push({
      key,
      uuid: uuidv5(`${i.client}|wallet_history|${key}`),
      atMs: at.getTime(),
      type: !money ? 'topup' : purchase ? 'spend' : 'admin_adjust',
      minor,
      description: money
        ? purchase
          ? 'Credits debited'
          : 'Credits removed'
        : purchase
          ? `Credits purchased${e.invoice ? ` (invoice ${e.invoice})` : ''}`
          : 'Wallet top-up',
      note:
        money && !purchase
          ? `Credits removed in Waboo${reason ? `: ${reason}` : ' (no reason logged)'}`
          : reason || null,
      source: purchase ? 'waboo_purchase' : 'waboo_topup',
      actorType: money && !purchase ? 'platform_operator' : 'system',
      meta: {
        legacy: {
          waboo: {
            kind: purchase ? 'credits_expense' : 'reseller_credit_log',
            id: e.id,
            reason: reason || null,
            invoice: e.invoice ?? null,
            loggedBalanceBefore: e.prev ?? null,
          },
        },
      },
    });
  }

  // ---- the chain
  rows.sort((a, b) =>
    a.atMs !== b.atMs ? a.atMs - b.atMs : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const sum = rows.reduce((s, r) => s + r.minor, 0n);
  const opening = i.targetMinor - sum;
  if (opening < 0n)
    throw new HistoryError(
      `HISTORY_OPENING_NEGATIVE: the logs add up to ${text4(sum)} but the live balance is ${text4(i.targetMinor)}, so the wallet would have started at ${text4(opening)}. The logs and the balance do not belong together (a missing top-up, or a log from another workspace). Nothing was written`,
    );
  const out: HistoryRow[] = [];
  let bal = 0n;
  if (opening > 0n) {
    bal = opening;
    out.push({
      key: `${prefix}opening`,
      uuid: uuidv5(`${i.client}|credit_opening|opening`),
      atMs: (rows[0]?.atMs ?? i.asOfMs) - 1000,
      type: 'admin_adjust',
      minor: opening,
      description: 'Opening balance (migrated from Waboo)',
      note: `Balance the Waboo wallet held before its oldest logged entry: the live balance ${text4(i.targetMinor)} minus every logged charge, refund, top-up and purchase`,
      source: 'waboo_migration',
      actorType: 'platform_operator',
      meta: {
        legacy: {
          waboo: {
            openingBalance: { target: text4(i.targetMinor), loggedNet: text4(sum), derived: true },
          },
        },
      },
      balanceAfter: bal,
    });
  }
  const checkpointMisses: HistoryPlan['checkpointMisses'] = [];
  let checkpoints = 0;
  let lowest = bal;
  let belowZero = 0;
  const prevOf = new Map<string, number>();
  for (const e of i.events)
    if (e.src === 'reseller' && typeof e.prev === 'number') prevOf.set(`${prefix}reseller:${e.id}`, e.prev);
  fine.sort((a, b) => a.atMs - b.atMs);
  let fi = 0;
  let fineBal = opening;
  for (const r of rows) {
    const logged = prevOf.get(r.key);
    if (logged !== undefined) {
      checkpoints++;
      while (fi < fine.length && fine[fi]!.atMs < r.atMs) fineBal += fine[fi++]!.minor;
      const lm = to4(logged)!;
      const diff = lm > fineBal ? lm - fineBal : fineBal - lm;
      if (diff > 10_000n)
        checkpointMisses.push({
          id: r.key.slice(prefix.length),
          at: new Date(r.atMs).toISOString(),
          logged: text4(lm),
          chain: text4(fineBal),
        });
    }
    bal += r.minor;
    if (bal < lowest) lowest = bal;
    if (bal < 0n) belowZero++;
    if (bal < -MAX_OVERDRAFT) {
      const lead = out
        .slice(Math.max(0, out.length - 5))
        .concat([{ ...r, balanceAfter: bal }])
        .map((x) => `${new Date(x.atMs).toISOString().slice(0, 16)} ${x.description} ${text4(x.minor)} -> ${text4(x.balanceAfter)}`)
        .join(' | ');
      throw new HistoryError(
        `HISTORY_NEGATIVE: the balance would fall to ${text4(bal)} at ${new Date(r.atMs).toISOString()} on "${r.description}" (opening ${text4(opening)}), deeper than any overdraft. The logs do not reproduce a valid wallet. Rows before it: ${lead}. Nothing was written`,
      );
    }
    out.push({ ...r, balanceAfter: bal });
  }
  if (bal !== i.targetMinor)
    throw new HistoryError(`HISTORY_CHAIN: internal error, the chain ends at ${text4(bal)} not ${text4(i.targetMinor)}`);

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(out.map((r) => [r.key, r.atMs, r.minor.toString(), r.type])))
    .digest('hex')
    .slice(0, 16);
  return { rows: out, openingMinor: opening, stats, checkpointMisses, checkpoints, lowest, belowZero, fingerprint };
}
