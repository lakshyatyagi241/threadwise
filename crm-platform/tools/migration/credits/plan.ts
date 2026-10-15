import { createHash } from 'node:crypto';
import type { Source } from '../extract/source';
import { badText, docKeysWith } from '../util';
import { CreditsConfigError, type CreditSettings } from './config';
import { minorText, scaledText } from './decimal';
import {
  isNonBroadcast,
  MAX_MINOR,
  tokensVerdict,
  usageVerdict,
  walletVerdict,
  windowOf,
  workspaceOf,
  type Win,
} from './rules';

/**
 * Pass 1 of the credits step: one read of `credit_logs` and one of the billing log, before anything is written. A wallet row is
 * immutable once posted, so `balance_after` of every row (which depends on the whole history and on the confirmed opening balance)
 * has to be known when the row is inserted.
 *
 *   opening        = B + S             B = the balance confirmed outside the dump, S = the sum of the posted spends (hundredths)
 *   balance_after  = opening - (spends up to and including this row, in created_time then _id order)
 *   wallet.balance = B                 = sum of the ledger, which is the invariant the app's hourly job checks
 *
 * Only documents that WILL load take part (a quarantined or excluded document is no spend), so the chain is exact by construction.
 */
export interface WalletEntry {
  minor: bigint;
  atMs: number;
  /** the balance after this row, hundredths */
  balanceAfter: bigint;
}

export interface CreditsPlan {
  settings: CreditSettings;
  referenceAt: string;
  /** primary key of a credit_logs document -> its posting (documents that load into the wallet) */
  wallet: Map<string, WalletEntry>;
  /** the opening ledger row; null when nothing is posted and the confirmed balance is 0 (or the wallet part is off) */
  opening: { minor: bigint; atMs: number; uuidKey: string } | null;
  /** first-wins: primary keys of billing-log documents that are the FIRST of their wamid (the others are DUPLICATE_WAMID) */
  usageFirst: Set<string>;
  /** months (UTC, first day) that rows of each partitioned table fall in */
  months: { ai_token_usage: string[]; usage_charges: string[] };
  stats: {
    creditDocs: number;
    walletRows: number;
    walletSpend: bigint;
    rounded: number;
    /** sum of (exact - posted) over the rows that load, scaled 10^18 */
    roundedResidual: bigint;
    belowPrecision: number;
    zero: number;
    /** sum of the exact amounts of the BELOW_LEDGER_PRECISION rows, scaled 10^18 */
    belowResidual: bigint;
    tokenRows: number;
    usageRows: number;
    usageDuplicates: number;
    workspaces: Record<string, number>;
    lastRowAt: string | null;
  };
  fingerprint: string;
}

const monthsBetween = (lo: number | null, hi: number | null): string[] => {
  if (lo === null || hi === null) return [];
  const out: string[] = [];
  const a = new Date(lo);
  const b = new Date(hi);
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
};

export async function buildCreditsPlan(a: {
  source: Source;
  client: string;
  settings: CreditSettings;
  referenceAt: string;
}): Promise<CreditsPlan> {
  const { source, client, settings } = a;
  const win: Win = windowOf(a.referenceAt);
  const has = (c: string): boolean => source.collections(client).includes(c);
  const stats: CreditsPlan['stats'] = {
    creditDocs: 0,
    walletRows: 0,
    walletSpend: 0n,
    rounded: 0,
    roundedResidual: 0n,
    belowPrecision: 0,
    zero: 0,
    belowResidual: 0n,
    tokenRows: 0,
    usageRows: 0,
    usageDuplicates: 0,
    workspaces: {},
    lastRowAt: null,
  };

  // credit_logs: the verdict of every document the engine will offer to the handler (first occurrence of a key, readable text)
  const loads: Array<{ key: string; atMs: number; minor: bigint }> = [];
  let tokLo: number | null = null;
  let tokHi: number | null = null;
  if (has('credit_logs')) {
    const seen = new Set<string>();
    for await (const doc of source.read(client, 'credit_logs')) {
      const key = docKeysWith(doc)[0]?.key;
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      if (badText(doc)) continue;
      stats.creditDocs++;
      const ws = workspaceOf(doc) || '(none)';
      stats.workspaces[ws] = (stats.workspaces[ws] ?? 0) + 1;
      const t = tokensVerdict(doc, settings, win);
      if (t.kind === 'load') {
        stats.tokenRows++;
        const ms = t.at.getTime();
        tokLo = tokLo === null ? ms : Math.min(tokLo, ms);
        tokHi = tokHi === null ? ms : Math.max(tokHi, ms);
      }
      const w = walletVerdict(doc, settings, win);
      if (w.kind === 'load') {
        loads.push({ key, atMs: w.at.getTime(), minor: w.minor });
        stats.walletSpend += w.minor;
        if (w.residual !== 0n) {
          stats.rounded++;
          stats.roundedResidual += w.residual;
        }
      } else if (w.kind === 'exclude' && w.code === 'BELOW_LEDGER_PRECISION') {
        stats.belowPrecision++;
        stats.belowResidual += w.unposted ?? 0n;
      } else if (w.kind === 'exclude' && w.code === 'ZERO_AMOUNT') stats.zero++;
    }
  }

  const distinct = Object.keys(stats.workspaces);
  if (settings.wallet && settings.workspaceId === null && distinct.length > 1)
    throw new CreditsConfigError(
      `CREDITS_MULTIPLE_WORKSPACES: credit_logs holds ${distinct.length} different workspace_id values (${distinct
        .map((k) => `${k.slice(0, 6)}...:${stats.workspaces[k]}`)
        .join(
          ', ',
        )}); one organization has one wallet. Pass --credit-workspace-id <the one that belongs to this client> (the other rows are quarantined OTHER_WORKSPACE) or --no-wallet. Nothing was written`,
    );

  // the chain
  loads.sort((x, y) =>
    x.atMs !== y.atMs ? x.atMs - y.atMs : x.key < y.key ? -1 : x.key > y.key ? 1 : 0,
  );
  stats.walletRows = loads.length;
  if (loads.length > 0) stats.lastRowAt = new Date(loads[loads.length - 1]!.atMs).toISOString();
  const wallet = new Map<string, WalletEntry>();
  let opening: CreditsPlan['opening'] = null;
  const o = settings.opening;
  if (settings.wallet && o) {
    if (loads.length > 0 && new Date(o.asOf).getTime() < loads[loads.length - 1]!.atMs)
      throw new CreditsConfigError(
        `CREDITS_OPENING_ASOF: asOf ${o.asOf} is before the newest migrated credit row (${stats.lastRowAt}): the confirmed balance does not include the debits after it. Confirm the balance again after the last row, or fix asOf. Nothing was written`,
      );
    const start = o.minor + stats.walletSpend;
    if (start > MAX_MINOR)
      throw new CreditsConfigError(
        `CREDITS_OPENING_OVER_LIMIT: the opening entry (confirmed balance ${o.amountText} + ${minorText(stats.walletSpend)} of migrated spends) would be above the 10,000,000.00 the wallet accepts in one posting. Nothing was written`,
      );
    let bal = start;
    for (const l of loads) {
      bal -= l.minor;
      wallet.set(l.key, { minor: l.minor, atMs: l.atMs, balanceAfter: bal });
    }
    if (start > 0n)
      opening = {
        minor: start,
        atMs: loads.length > 0 ? loads[0]!.atMs - 1000 : new Date(o.asOf).getTime(),
        uuidKey: 'opening',
      };
  }

  // the billing log of automation / inbox / test sends
  const usageFirst = new Set<string>();
  let useLo: number | null = null;
  let useHi: number | null = null;
  if (has('whatsapp_broadcasting_data')) {
    const wamids = new Set<string>();
    const seen = new Set<string>();
    for await (const doc of source.read(client, 'whatsapp_broadcasting_data')) {
      const key = docKeysWith(doc)[0]?.key;
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      if (badText(doc) || !isNonBroadcast(doc)) continue;
      const v = usageVerdict(doc, win);
      if (v.kind !== 'load') continue;
      if (wamids.has(v.wamid)) {
        stats.usageDuplicates++;
        continue;
      }
      wamids.add(v.wamid);
      usageFirst.add(key);
      stats.usageRows++;
      const ms = v.at.getTime();
      useLo = useLo === null ? ms : Math.min(useLo, ms);
      useHi = useHi === null ? ms : Math.max(useHi, ms);
    }
  }

  const months = {
    ai_token_usage: monthsBetween(tokLo, tokHi),
    usage_charges: monthsBetween(useLo, useHi),
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        w: settings.wallet,
        ws: settings.workspaceId,
        o: o ? [o.minor.toString(), o.currency, o.asOf, o.sha256] : null,
        n: loads.length,
        s: stats.walletSpend.toString(),
        t: stats.tokenRows,
        u: stats.usageRows,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return {
    settings,
    referenceAt: a.referenceAt,
    wallet,
    opening,
    usageFirst,
    months,
    stats,
    fingerprint,
  };
}

/** One printable line of the plan for the run log and the dry-run output. */
export function describePlan(p: CreditsPlan): string {
  const s = p.stats;
  const parts = [
    `${s.creditDocs} credit_logs row(s): ${s.tokenRows} token row(s), ${s.walletRows} wallet posting(s) totalling ${minorText(s.walletSpend)}`,
  ];
  if (s.rounded > 0 || s.belowPrecision > 0)
    parts.push(
      `rounding to 2 decimals: ${s.rounded} row(s) rounded (residual ${scaledText(s.roundedResidual)}), ${s.belowPrecision} below 0.01 not posted (${scaledText(s.belowResidual)} in total), ${s.zero} zero`,
    );
  if (p.settings.wallet && p.settings.opening)
    parts.push(
      `confirmed balance ${p.settings.opening.amountText} ${p.settings.opening.currency} as of ${p.settings.opening.asOf}: opening entry ${p.opening ? minorText(p.opening.minor) : 'none'}`,
    );
  if (!p.settings.wallet) parts.push('WALLET PART OFF (--no-wallet): no wallet row is written');
  parts.push(
    `${s.usageRows} usage charge(s) from the billing log (${s.usageDuplicates} duplicate wamid)`,
  );
  return parts.join('; ');
}
