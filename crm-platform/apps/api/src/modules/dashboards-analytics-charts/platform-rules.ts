import type { AdminOverviewWindow } from '@crm/contracts';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const money2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

/** `prev > 0 ? round((now - prev) / prev * 100, 2) : (now > 0 ? 100 : 0)` (TW-DASH-035). */
export const changePct = (now: number, prev: number): string =>
  prev > 0 ? money2(((now - prev) / prev) * 100) : now > 0 ? '100.00' : '0.00';

export const WINDOW_DAYS: Record<AdminOverviewWindow, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export interface OverviewWindow {
  from: Date;
  to: Date;
  prevFrom: Date;
  days: number;
}

/**
 * [from, to) ends at the end of today (UTC) and spans exactly N days; the previous window is the N days before it.
 * Deliberate: Reference's snapping made "24h" two days and "7d" eight; these are the exact spans the picker names.
 */
export function overviewWindow(w: AdminOverviewWindow, now: Date): OverviewWindow {
  const days = WINDOW_DAYS[w];
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - days * DAY);
  return { from, to, prevFrom: new Date(from.getTime() - days * DAY), days };
}

export interface Bucket {
  start: Date;
  end: Date;
  label: string;
}

/**
 * Up to 12 buckets of `ceil(days / 12)` days that cover the WHOLE window (Reference's fixed 12 stopped short for 30d, 90d and 1y, so the
 * newest revenue was missing from the chart). Label "Mon d" under 28 days a step, else "Mon yyyy".
 */
export function revenueBuckets(win: OverviewWindow): Bucket[] {
  const step = Math.max(1, Math.ceil(win.days / 12));
  const out: Bucket[] = [];
  for (let t = win.from.getTime(); t < win.to.getTime(); t += step * DAY) {
    const start = new Date(t);
    const end = new Date(Math.min(t + step * DAY, win.to.getTime()));
    out.push({
      start,
      end,
      label:
        step < 28
          ? `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`
          : `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    });
  }
  return out;
}

/** A synthetic 10% growth benchmark, never below 100: bucket 0 is `revenue x 0.9 x 1.1`, later ones `previous x 1.1`. */
export function revenueTargets(series: readonly number[]): number[] {
  return series.map((v, i) => {
    const base = i === 0 ? v * 0.9 * 1.1 : series[i - 1]! * 1.1;
    return Math.max(100, Math.round(base * 100) / 100);
  });
}

/** The label colour of Reference's workspace table: >= 500 Good, >= 50 Active, > 0 Low, else Idle. */
export function healthOf(messages7d: number): 'good' | 'active' | 'low' | 'idle' {
  return messages7d >= 500 ? 'good' : messages7d >= 50 ? 'active' : messages7d > 0 ? 'low' : 'idle';
}

/** A spike alert fires when the last hour is at least three times a positive hourly average (7-day count / 168). */
export function spikeRatio(lastHour: number, count7d: number): number | null {
  const avg = count7d / 168;
  return avg > 0 && lastHour >= 3 * avg ? Math.round((lastHour / avg) * 10) / 10 : null;
}

/** Converts amounts into the platform's default currency; an unknown currency is taken at par rather than dropped. */
export class Fx {
  constructor(
    readonly base: string,
    private readonly rates: ReadonlyMap<string, number>,
  ) {}
  toBase(amount: number | string, currency: string): number {
    const a = Number(amount);
    const from = this.rates.get(currency.toUpperCase());
    const to = this.rates.get(this.base);
    return from && to ? (a / from) * to : a;
  }
}

/** Calendar dates (UTC, yyyy-mm-dd) from `from` for `days` days: the zero-fill spine of the signup charts. */
export function dateSpine(from: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    new Date(from.getTime() + i * DAY).toISOString().slice(0, 10),
  );
}

/** The ten-entry country name map of Reference, plus the six regions the radar rolls them into. */
export const COUNTRY_NAMES: Record<string, string> = {
  AU: 'Australia',
  ID: 'Indonesia',
  TH: 'Thailand',
  DE: 'Germany',
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  BR: 'Brazil',
  PH: 'Philippines',
  JP: 'Japan',
};
export const REGIONS: Record<string, readonly string[]> = {
  Europe: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'PL', 'RU', 'CH'],
  Americas: ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO'],
  Africa: ['ZA', 'NG', 'KE', 'EG', 'MA', 'GH'],
  'Middle East': ['AE', 'SA', 'IL', 'TR', 'IR', 'QA', 'KW'],
  Pacific: ['AU', 'NZ', 'FJ'],
  Asia: ['IN', 'CN', 'JP', 'KR', 'ID', 'TH', 'VN', 'MY', 'PH', 'SG', 'BD', 'PK', 'LK'],
};

export function regionCounts(
  byCode: ReadonlyMap<string, number>,
): Array<{ region: string; count: number }> {
  return Object.entries(REGIONS).map(([region, codes]) => ({
    region,
    count: codes.reduce((a, c) => a + (byCode.get(c) ?? 0), 0),
  }));
}

/** Dial prefixes of the countries the radar knows, so a signup that stored "91" instead of "IN" still lands (Reference stored the prefix). */
export const DIAL_TO_ISO: Record<string, string> = {
  '1': 'US',
  '7': 'RU',
  '20': 'EG',
  '27': 'ZA',
  '30': 'GR',
  '31': 'NL',
  '33': 'FR',
  '34': 'ES',
  '39': 'IT',
  '41': 'CH',
  '44': 'GB',
  '46': 'SE',
  '47': 'NO',
  '48': 'PL',
  '49': 'DE',
  '52': 'MX',
  '54': 'AR',
  '55': 'BR',
  '56': 'CL',
  '57': 'CO',
  '60': 'MY',
  '61': 'AU',
  '62': 'ID',
  '63': 'PH',
  '64': 'NZ',
  '65': 'SG',
  '66': 'TH',
  '81': 'JP',
  '82': 'KR',
  '84': 'VN',
  '86': 'CN',
  '90': 'TR',
  '91': 'IN',
  '92': 'PK',
  '94': 'LK',
  '98': 'IR',
  '212': 'MA',
  '233': 'GH',
  '234': 'NG',
  '254': 'KE',
  '880': 'BD',
  '965': 'KW',
  '971': 'AE',
  '972': 'IL',
  '974': 'QA',
  '966': 'SA',
  '679': 'FJ',
};

/** An ISO alpha-2 code from what a profile stored: the ISO country if it is one, else the dial prefix mapped, else null. */
export function isoCountry(country: string | null, code: string | null): string | null {
  for (const v of [country, code]) {
    const s = (v ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) return s;
  }
  const dial = (code ?? '').replace(/\D/g, '');
  return DIAL_TO_ISO[dial] ?? null;
}

/** TW-DASH-037: the top four countries by signups; the share is of those four (Reference's rule), one decimal. */
export function countryRows(
  byCode: ReadonlyMap<string, number>,
): Array<{ code: string; name: string; count: number; pct: string }> {
  const top = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4);
  const sum = top.reduce((a, [, n]) => a + n, 0);
  return top.map(([code, count]) => ({
    code,
    name: COUNTRY_NAMES[code] ?? code,
    count,
    pct: sum > 0 ? ((count / sum) * 100).toFixed(1) : '0.0',
  }));
}

/** TW-DASH-029: the country of a phone number by its longest known dial prefix (1 to 3 digits); null when none matches. */
export function countryOfPhone(digits: string): string | null {
  for (const n of [3, 2, 1]) {
    const iso = DIAL_TO_ISO[digits.slice(0, n)];
    if (iso && digits.length >= n + 4) return iso;
  }
  return null;
}
