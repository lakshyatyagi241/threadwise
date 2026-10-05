import type { MetaCardCategory } from '@crm/contracts';
import { parseCsv } from './rate-card-csv';
import { ALL_MARKETS } from './meta-markets';
import { looksLikeXlsx, readXlsx, XlsxError } from './xlsx-lite';

/**
 * Reads the rate card Meta publishes for one currency ("Cost per message in INR on the WhatsApp Business Platform, effective October
 * 1, 2026"): a title that carries the effective date, a header row (Market, Currency, Marketing, Utility, Authentication,
 * Authentication-International, Service, ...) and one row per market. Meta ships it as an Excel workbook even where the link says
 * CSV; a CSV saved from that workbook is read the same way. Pure: bytes in, a card and its problems out.
 *
 * Fatal faults (no header, no date, mixed currencies, no usable row) throw; a row-level fault (an unknown market, a bad amount) is
 * reported and the rest of the card is still read, so one odd row never hides the others.
 */

export interface MetaCardRow {
  market: string;
  category: MetaCardCategory;
  /** Millionths of the currency unit. */
  costMicros: number;
}

export interface ParsedMetaCard {
  currency: string;
  /** YYYY-MM-DD, the date Meta says the card takes effect. */
  effectiveOn: string;
  rows: MetaCardRow[];
  problems: string[];
}

export class MetaCardFileError extends Error {}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const COLUMNS: Readonly<Record<string, MetaCardCategory>> = {
  marketing: 'marketing',
  utility: 'utility',
  authentication: 'authentication',
  'authentication international': 'authentication_international',
  service: 'service',
};

const key = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .trim();

function effectiveDate(rows: string[][]): string | null {
  for (const row of rows.slice(0, 8)) {
    // The whole row, because a CSV export may split the title at its comma ("October 1" | "2026").
    const m = /effective\s+([A-Za-z]+)\s+(\d{1,2})\D{0,3}(\d{4})/i.exec(row.join(' '));
    const month = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
    if (m && month >= 0) {
      return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
    }
  }
  return null;
}

export function parseMetaCardFile(bytes: Buffer): ParsedMetaCard {
  let rows: string[][];
  try {
    rows = looksLikeXlsx(bytes) ? readXlsx(bytes) : parseCsv(bytes.toString('utf8'));
  } catch (err) {
    if (err instanceof XlsxError) throw new MetaCardFileError(err.message);
    throw err;
  }

  const headerAt = rows.findIndex(
    (r) => key(r[0] ?? '') === 'market' && r.some((c) => key(c) === 'currency'),
  );
  if (headerAt < 0) {
    throw new MetaCardFileError(
      'This does not look like Meta’s rate card: no header row with Market and Currency.',
    );
  }
  const header = rows[headerAt]!.map(key);
  const currencyCol = header.indexOf('currency');
  const categoryCols = header
    .map((h, i) => [i, COLUMNS[h]] as const)
    .filter((c): c is readonly [number, MetaCardCategory] => c[1] !== undefined);
  if (categoryCols.length === 0) {
    throw new MetaCardFileError('The header has no Marketing, Utility or Authentication column.');
  }

  const effectiveOn = effectiveDate(rows.slice(0, headerAt));
  if (!effectiveOn) {
    throw new MetaCardFileError(
      'The file does not say when it takes effect. Meta’s card has a title such as "effective October 1, 2026".',
    );
  }

  const known = new Map(ALL_MARKETS.map((m) => [key(m), m]));
  const problems: string[] = [];
  const out: MetaCardRow[] = [];
  const currencies = new Set<string>();
  const seen = new Set<string>();

  for (const row of rows.slice(headerAt + 1)) {
    const name = (row[0] ?? '').trim();
    if (!name) continue;
    const currency = (row[currencyCol] ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      problems.push(`${name}: the currency "${row[currencyCol] ?? ''}" is not a 3-letter code.`);
      continue;
    }
    currencies.add(currency);
    const market = known.get(key(name));
    if (!market) {
      problems.push(
        `${name}: Meta lists a market this platform does not know. Its countries are priced as "Other" until the market map is updated.`,
      );
      continue;
    }
    if (seen.has(market)) {
      problems.push(`${name}: listed twice; the first row was kept.`);
      continue;
    }
    seen.add(market);
    for (const [col, category] of categoryCols) {
      const text = (row[col] ?? '').trim();
      if (text === '' || text.toLowerCase() === 'n/a') continue;
      const amount = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount < 0) {
        problems.push(`${name}: "${text}" is not an amount (${category}).`);
        continue;
      }
      out.push({ market, category, costMicros: Math.round(amount * 1_000_000) });
    }
  }

  if (currencies.size > 1) {
    throw new MetaCardFileError(
      `The file mixes currencies (${[...currencies].sort().join(', ')}). Import one currency’s card at a time.`,
    );
  }
  const currency = [...currencies][0];
  if (!currency || out.length === 0) {
    throw new MetaCardFileError('No usable rate row was found in the file.');
  }
  return { currency, effectiveOn, rows: out, problems };
}
