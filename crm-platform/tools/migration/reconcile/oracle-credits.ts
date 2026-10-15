/**
 * INDEPENDENT oracle for the credits step (credit_logs -> wallet_transactions + ai_token_usage, the non-broadcast rows of
 * whatsapp_broadcasting_data -> usage_charges), written for the verifier. It imports nothing from transform/, credits/ or load/: spec B
 * section 3 is written down a second time here, with its own decimal reader (a regular expression and BigInt shifts, not the loader's
 * digit walker), so a bug or a "fix" in the loader's rules makes the target disagree with this one and reconcile fails. Shared on purpose:
 * `uuidv5` of util.ts and this folder's text / date helpers (reconcile/oracle.ts, itself independent of the loader).
 */
import { dateOf, text } from './oracle';

type Doc = Record<string, unknown>;

const E18 = 10n ** 18n;
const E16 = 10n ** 16n;
const MAX_MINOR = 1_000_000_000n;
const INT4 = 2_147_483_647;

/** value x 10^18 (truncated), or null when it is not a finite number / numeric string. */
export function scaled18(v: unknown): bigint | null {
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = v.toString();
  } else if (typeof v === 'string') s = v.trim();
  else return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const mant = BigInt(`${m[2] ?? ''}${m[3] ?? ''}` || '0');
  const shift = 18 - (m[3] ?? '').length + Number(m[4] ?? 0);
  if (Math.abs(shift) > 500) return null;
  const mag = shift >= 0 ? mant * 10n ** BigInt(shift) : mant / 10n ** BigInt(-shift);
  return m[1] === '-' ? -mag : mag;
}

/** hundredths, rounded half away from zero */
export function minorOf(s18: bigint): bigint {
  const neg = s18 < 0n;
  const a = neg ? -s18 : s18;
  let q = a / E16;
  if (a % E16 >= 5n * 10n ** 15n) q += 1n;
  return neg ? -q : q;
}

export const text4 = (minor: bigint): string => {
  const neg = minor < 0n;
  const a = (neg ? -minor : minor).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}00`;
};
export const text2 = (minor: bigint): string => text4(minor).slice(0, -2);
export const exactText = (s18: bigint, keep = 12): string => {
  const neg = s18 < 0n;
  const a = (neg ? -s18 : s18).toString().padStart(19, '0');
  const frac = a.slice(-18).slice(0, keep).replace(/0+$/, '');
  return `${neg ? '-' : ''}${a.slice(0, -18)}${frac ? `.${frac}` : ''}`;
};
/** the shortest plain decimal text of a number / numeric string (what the loader keeps in meta), or null */
export function plainText(v: unknown): string | null {
  const s = scaled18(v);
  return s === null ? null : exactText(s, 18);
}

function counterOf(v: unknown): number | null {
  const s = scaled18(v);
  if (s === null || s < 0n || s % E18 !== 0n) return null;
  const n = s / E18;
  return n > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(n);
}

function badText(v: unknown): boolean {
  if (typeof v === 'string') {
    if (v.includes('\u0000')) return true;
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = v.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) i++;
        else return true;
      } else if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  }
  if (Array.isArray(v)) return v.some(badText);
  if (v !== null && typeof v === 'object' && !(v instanceof Date))
    return Object.entries(v as Doc).some(([k, x]) => badText(k) || badText(x));
  return false;
}

export interface CreditOracleSettings {
  wallet: boolean;
  workspaceId: string | null;
  /** B in hundredths, the unit and when it was confirmed; null when there is no opening file */
  openingMinor: bigint | null;
  unit: string | null;
  asOfMs: number | null;
  /** dump time: the partition window is measured from it */
  referenceAt: string;
}

export type OVerdict = { kind: 'load' | 'exclude' | 'quarantine'; code: string };

export interface OWallet extends OVerdict {
  minor: bigint;
  atMs: number;
  exact: string;
  balanceAfter: bigint;
  residual: bigint;
}
export interface OToken extends OVerdict {
  atMs: number;
  provider: string;
  model: string | null;
  prompt: number;
  completion: number;
  total: number;
}
export interface OUsage extends OVerdict {
  atMs: number;
  wamid: string;
  category: string | null;
  source: string | null;
  amounts: Record<string, string | null>;
  revert: boolean | null;
  legacyId: string | null;
}

export interface CreditOracle {
  wallet: Map<string, OWallet>;
  tokens: Map<string, OToken>;
  usage: Map<string, OUsage>;
  /** per verdict tally, "wallet load", "wallet exclude BELOW_LEDGER_PRECISION" ... */
  tally: Record<string, number>;
  /** scaled 10^18 */
  exactAll: bigint;
  postedSum: bigint;
  roundedResidual: bigint;
  roundedRows: number;
  belowSum: bigint;
  belowRows: number;
  overLimitSum: bigint;
  /** spends in hundredths, the opening entry (hundredths) and when it is dated */
  spendMinor: bigint;
  opening: { minor: bigint; atMs: number } | null;
  /** token sums per UTC month of the rows that load */
  tokenMonths: Map<string, { n: number; prompt: number; completion: number; total: number }>;
  workspaces: Record<string, number>;
  /** last migrated credit row (ms) */
  lastRowMs: number | null;
  cachedTokenDocs: number;
}

const providerOf = (type: unknown, model: unknown): string => {
  const t = text(type).toLowerCase();
  if (t === 'openai_api') return 'openai';
  const m = /^([a-z0-9][a-z0-9_.-]{0,40})\//i.exec(text(model));
  return m ? m[1]!.toLowerCase() : 'unknown';
};

export async function oracleCredits(
  creditDocs: AsyncIterable<Doc> | Iterable<Doc>,
  billingDocs: AsyncIterable<Doc> | Iterable<Doc>,
  s: CreditOracleSettings,
): Promise<CreditOracle> {
  const ref = new Date(s.referenceAt);
  const lo = Date.UTC(ref.getUTCFullYear() - 10, ref.getUTCMonth(), 1);
  const hi = Date.UTC(ref.getUTCFullYear() + 1, ref.getUTCMonth() + 1, 1);
  const inWindow = (d: Date): boolean => {
    const m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return m >= lo && m < hi;
  };
  const o: CreditOracle = {
    wallet: new Map(),
    tokens: new Map(),
    usage: new Map(),
    tally: {},
    exactAll: 0n,
    postedSum: 0n,
    roundedResidual: 0n,
    roundedRows: 0,
    belowSum: 0n,
    belowRows: 0,
    overLimitSum: 0n,
    spendMinor: 0n,
    opening: null,
    tokenMonths: new Map(),
    workspaces: {},
    lastRowMs: null,
    cachedTokenDocs: 0,
  };
  const bump = (k: string): void => {
    o.tally[k] = (o.tally[k] ?? 0) + 1;
  };

  const seen = new Set<string>();
  const posted: Array<{ key: string; atMs: number; minor: bigint }> = [];
  for await (const doc of creditDocs as AsyncIterable<Doc>) {
    const key = text(doc._id) || text(doc.id);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    if (badText(doc)) continue;
    const ws = text(doc.workspace_id) || '(none)';
    o.workspaces[ws] = (o.workspaces[ws] ?? 0) + 1;
    const otherWs = s.workspaceId !== null && text(doc.workspace_id) !== s.workspaceId;
    const raw = doc.created_time;
    const at = raw === null || raw === undefined || raw === '' ? null : dateOf(raw);

    // tokens
    {
      const base = {
        atMs: at ? at.getTime() : 0,
        provider: '',
        model: null,
        prompt: 0,
        completion: 0,
        total: 0,
      };
      if (otherWs) {
        o.tokens.set(key, { ...base, kind: 'quarantine', code: 'OTHER_WORKSPACE' });
        bump('tokens quarantine OTHER_WORKSPACE');
      } else if (!at) {
        o.tokens.set(key, { ...base, kind: 'quarantine', code: 'NO_DATE' });
        bump('tokens quarantine NO_DATE');
      } else if (!inWindow(at)) {
        o.tokens.set(key, { ...base, kind: 'quarantine', code: 'BAD_DATE' });
        bump('tokens quarantine BAD_DATE');
      } else {
        const ok = (v: unknown): number | null => {
          if (v === null || v === undefined || v === '') return null;
          const n = counterOf(v);
          return n === null || n > INT4 ? null : n;
        };
        let prompt = ok(doc.input_tokens) ?? 0;
        let completion = ok(doc.output_tokens) ?? 0;
        const used = ok(doc.tokens_used);
        let total = prompt + completion;
        if (total > INT4) {
          prompt = 0;
          completion = 0;
          total = 0;
        } else if (used !== null && used >= total) total = used;
        const model = text(doc.model).slice(0, 200) || null;
        o.tokens.set(key, {
          kind: 'load',
          code: '',
          atMs: at.getTime(),
          provider: providerOf(doc.type, doc.model),
          model,
          prompt,
          completion,
          total,
        });
        bump('tokens load');
        const d = new Date(at.getTime());
        const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const b = o.tokenMonths.get(mk) ?? { n: 0, prompt: 0, completion: 0, total: 0 };
        b.n++;
        b.prompt += prompt;
        b.completion += completion;
        b.total += total;
        o.tokenMonths.set(mk, b);
        if (doc.cached_input_tokens !== undefined && doc.cached_input_tokens !== null)
          o.cachedTokenDocs++;
      }
    }

    // wallet
    {
      const empty = {
        minor: 0n,
        atMs: at ? at.getTime() : 0,
        exact: '',
        balanceAfter: 0n,
        residual: 0n,
      };
      const rej = (kind: 'exclude' | 'quarantine', code: string): void => {
        o.wallet.set(key, { ...empty, kind, code });
        bump(`wallet ${kind} ${code}`);
      };
      if (!s.wallet) {
        rej('exclude', 'WALLET_NOT_MIGRATED');
        continue;
      }
      if (otherWs) {
        rej('quarantine', 'OTHER_WORKSPACE');
        continue;
      }
      if (!at) {
        rej('quarantine', 'NO_DATE');
        continue;
      }
      if (!inWindow(at)) {
        rej('quarantine', 'BAD_DATE');
        continue;
      }
      const x = scaled18(doc.credits_deducted);
      if (x === null) {
        rej('quarantine', 'NOT_A_NUMBER');
        continue;
      }
      if (x < 0n) {
        rej('quarantine', 'NEGATIVE_DEDUCTION');
        continue;
      }
      o.exactAll += x;
      const minor = minorOf(x);
      if (minor === 0n) {
        if (x === 0n) rej('exclude', 'ZERO_AMOUNT');
        else {
          o.belowSum += x;
          o.belowRows++;
          rej('exclude', 'BELOW_LEDGER_PRECISION');
        }
        continue;
      }
      if (minor > MAX_MINOR) {
        o.overLimitSum += x;
        rej('quarantine', 'AMOUNT_OVER_LIMIT');
        continue;
      }
      const residual = x - minor * E16;
      if (residual !== 0n) {
        o.roundedResidual += residual;
        o.roundedRows++;
      }
      o.postedSum += minor * E16;
      o.spendMinor += minor;
      o.wallet.set(key, {
        kind: 'load',
        code: '',
        minor,
        atMs: at.getTime(),
        exact: exactText(x, 18),
        balanceAfter: 0n,
        residual,
      });
      bump('wallet load');
      posted.push({ key, atMs: at.getTime(), minor });
    }
  }

  // the chain: the opening entry, then the spends in time order (ties by key)
  posted.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (posted.length > 0) o.lastRowMs = posted[posted.length - 1]!.atMs;
  if (s.wallet && s.openingMinor !== null) {
    let bal = s.openingMinor + o.spendMinor;
    const start = bal;
    for (const p of posted) {
      bal -= p.minor;
      o.wallet.get(p.key)!.balanceAfter = bal;
    }
    if (start > 0n)
      o.opening = {
        minor: start,
        atMs: posted.length > 0 ? posted[0]!.atMs - 1000 : (s.asOfMs ?? 0),
      };
  }

  // the billing log
  const seenB = new Set<string>();
  const wamids = new Set<string>();
  for await (const doc of billingDocs as AsyncIterable<Doc>) {
    const key = text(doc._id) || text(doc.id);
    if (key === '' || seenB.has(key)) continue;
    seenB.add(key);
    if (badText(doc)) continue;
    const nonBroadcast =
      text(doc.source).toLowerCase() !== 'broadcast' || text(doc.broadcast_id) === '';
    if (!nonBroadcast) continue;
    const wamid = text(doc.message_id);
    const at =
      doc.created_time === null || doc.created_time === undefined || doc.created_time === ''
        ? null
        : dateOf(doc.created_time);
    const base = {
      atMs: at ? at.getTime() : 0,
      wamid,
      category: null,
      source: null,
      amounts: {},
      revert: null,
      legacyId: null,
    };
    const put = (kind: OVerdict['kind'], code: string, extra: Partial<OUsage> = {}): void => {
      o.usage.set(key, { ...base, kind, code, ...extra });
      bump(`usage ${kind}${code ? ` ${code}` : ''}`);
    };
    if (wamid === '') {
      put('quarantine', 'NO_MESSAGE_ID');
      continue;
    }
    if (!at) {
      put('quarantine', 'NO_DATE');
      continue;
    }
    if (!inWindow(at)) {
      put('quarantine', 'BAD_DATE');
      continue;
    }
    if (wamids.has(wamid)) {
      put('exclude', 'DUPLICATE_WAMID');
      continue;
    }
    wamids.add(wamid);
    const cat = text(doc.template_category).toLowerCase();
    const amounts: Record<string, string | null> = {};
    for (const f of ['amount', 'reseller_amount', 'reseller_margin', 'cost'])
      amounts[f] = plainText(doc[f]);
    const rv = doc.revert;
    put('load', '', {
      category: ['marketing', 'utility', 'authentication', 'service'].includes(cat) ? cat : null,
      source: text(doc.source).toLowerCase().slice(0, 40) || null,
      amounts,
      revert:
        rv === undefined || rv === null
          ? null
          : typeof rv === 'boolean'
            ? rv
            : typeof rv === 'string'
              ? ['true', '1', 'yes', 'y', 't'].includes(rv.trim().toLowerCase())
              : typeof rv === 'number'
                ? rv !== 0
                : false,
      legacyId: text(doc.id).slice(0, 80) || null,
    });
  }
  return o;
}
