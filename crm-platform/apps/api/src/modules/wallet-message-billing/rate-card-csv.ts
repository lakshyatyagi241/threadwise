import {
  WALLET_CATEGORIES,
  majorToMicros,
  microsToMinor,
  normalizeWalletCategory,
  walletMajorToMinor,
} from '@crm/contracts';
import { resolveCountry } from './phone-country';

/**
 * Reads a rate-card CSV (WD-WALLET-006): Meta's own "rates by country" file (wide: one row per country, one column per category)
 * or a long file with a `category` column. Pure: text in, rows and problems out. Converting a row's currency into the platform
 * currency is the caller's job (it needs the currency table), so each row reports the currency it came in.
 */

/** Byte order mark some spreadsheets put in front of a CSV. */
const BOM = String.fromCharCode(0xfeff);

export interface ParsedRate {
  line: number;
  countryCode: string;
  category: string;
  /** Cost in the row's own currency, millionths of a unit; undefined = the file said nothing about cost. */
  costMicros: number | null | undefined;
  currency: string | null;
  /** Customer price, hundredths; undefined = leave the stored price alone. */
  priceMinor: number | undefined;
}

export interface CsvProblem {
  line: number;
  reason: string;
}

export interface ParsedRateCard {
  shape: 'wide' | 'long';
  rows: ParsedRate[];
  problems: CsvProblem[];
}

/** RFC 4180 parser: quotes, doubled quotes, CRLF; strips a BOM; the delimiter (comma, semicolon or tab) is read off the header. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0]!.d;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      out.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

const COUNTRY_HEADERS = ['country_code', 'country code', 'country', 'market'];
const COST_HEADERS = ['meta_cost', 'cost', 'rate', 'price'];

function indexOfAny(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** "0.7846" -> micros; blank or not a number -> undefined (the caller keeps the stored cost). */
function cost(cell: string | undefined): number | undefined {
  const t = (cell ?? '').trim().replace(/^[^\d.]+/, '');
  if (t === '') return undefined;
  const m = majorToMicros(t);
  return m === null ? undefined : m;
}

export function parseRateCardCsv(text: string): ParsedRateCard {
  const table = parseCsv(text);
  if (table.length === 0)
    return { shape: 'long', rows: [], problems: [{ line: 1, reason: 'The file is empty' }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const countryAt = indexOfAny(header, COUNTRY_HEADERS);
  const currencyAt = header.indexOf('currency');
  const categoryAt = header.indexOf('category');
  const priceAt =
    header.indexOf('credits') >= 0 ? header.indexOf('credits') : header.indexOf('you_charge');
  const wide = categoryAt < 0 && WALLET_CATEGORIES.some((c) => header.includes(c));
  const rows: ParsedRate[] = [];
  const problems: CsvProblem[] = [];

  if (countryAt < 0) {
    return {
      shape: wide ? 'wide' : 'long',
      rows,
      problems: [{ line: 1, reason: 'No country column (country_code, country or market)' }],
    };
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r]!;
    const country = resolveCountry(cells[countryAt]);
    if (country === null) {
      problems.push({ line, reason: `Unknown country "${(cells[countryAt] ?? '').trim()}"` });
      continue;
    }
    const currency =
      currencyAt >= 0 ? (cells[currencyAt] ?? '').trim().toUpperCase() || null : null;
    if (wide) {
      let any = false;
      for (const cat of WALLET_CATEGORIES) {
        const at = header.indexOf(cat);
        if (at < 0) continue;
        const c = cost(cells[at]);
        if (c === undefined) continue;
        any = true;
        rows.push({
          line,
          countryCode: country,
          category: cat,
          costMicros: c,
          currency,
          priceMinor: undefined,
        });
      }
      if (!any) problems.push({ line, reason: 'No cost in any category column' });
      continue;
    }
    const rawCategory = (cells[categoryAt] ?? '').trim();
    const category = normalizeWalletCategory(rawCategory);
    if (rawCategory !== '' && category === '') {
      problems.push({ line, reason: `Unknown category "${rawCategory}"` });
      continue;
    }
    const costAt = indexOfAny(header, COST_HEADERS);
    const priceCell = priceAt >= 0 ? (cells[priceAt] ?? '').trim() : '';
    let priceMinor: number | undefined;
    if (priceCell !== '') {
      const p = walletMajorToMinor(priceCell);
      if (p === null) {
        problems.push({
          line,
          reason: `Price "${priceCell}" is not an amount with at most 2 decimals`,
        });
        continue;
      }
      priceMinor = p;
    }
    rows.push({
      line,
      countryCode: country,
      category,
      costMicros: costAt >= 0 ? cost(cells[costAt]) : undefined,
      currency,
      priceMinor,
    });
  }
  return { shape: wide ? 'wide' : 'long', rows, problems };
}

/** A cost in `from` currency to the platform currency, micros. `rate` = units of that currency per 1 USD (WaDesk's table). */
export function convertMicros(micros: number, fromRate: number, toRate: number): number {
  if (!(fromRate > 0) || !(toRate > 0) || fromRate === toRate) return micros;
  return Math.round((micros / fromRate) * toRate);
}

export { microsToMinor };
