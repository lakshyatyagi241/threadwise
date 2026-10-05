import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardFreshness,
  mostPressing,
  quarterBounds,
} from '../../../src/modules/wallet-message-billing/meta-card-freshness';
import {
  ALL_MARKETS,
  REGION_MARKETS,
  STANDALONE_MARKETS,
  countriesOf,
  marketOf,
} from '../../../src/modules/wallet-message-billing/meta-markets';
import {
  MetaCardFileError,
  parseMetaCardFile,
} from '../../../src/modules/wallet-message-billing/meta-rate-card-file';
import { readXlsx, XlsxError } from '../../../src/modules/wallet-message-billing/xlsx-lite';

/** The two files Meta published for 1 October 2026, exactly as downloaded (they are Excel workbooks despite the CSV label). */
const file = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
const USD = file('meta-usd-2026-10.xlsx');
const INR = file('meta-inr-2026-10.xlsx');

const cost = (card: ReturnType<typeof parseMetaCardFile>, market: string, category: string) =>
  card.rows.find((r) => r.market === market && r.category === category)?.costMicros;

describe('reading Meta’s workbook', () => {
  it('opens the first sheet as rows of text, title first', () => {
    const rows = readXlsx(USD);
    expect(rows[0]?.[0]).toBe(
      'Cost per message in USD on the WhatsApp Business Platform, effective October 1, 2026',
    );
    expect(rows.find((r) => r[0] === 'Market')).toBeTruthy();
    expect(rows.find((r) => r[0] === 'India')?.slice(0, 3)).toEqual(['India', 'USD', '0.0118']);
  });

  it('refuses bytes that are not a workbook, and a damaged one', () => {
    expect(() => readXlsx(Buffer.from('just some text, not a zip file at all'))).toThrow(XlsxError);
    expect(() => readXlsx(USD.subarray(0, 3000))).toThrow(XlsxError);
  });
});

describe('parsing the real USD and INR cards', () => {
  const usd = parseMetaCardFile(USD);
  const inr = parseMetaCardFile(INR);

  it('reads the currency and the date Meta gives', () => {
    expect([usd.currency, usd.effectiveOn]).toEqual(['USD', '2026-10-01']);
    expect([inr.currency, inr.effectiveOn]).toEqual(['INR', '2026-10-01']);
  });

  it('reads every market with no problem, and the same markets in both currencies', () => {
    expect(usd.problems).toEqual([]);
    expect(inr.problems).toEqual([]);
    const names = (c: typeof usd) => [...new Set(c.rows.map((r) => r.market))].sort();
    expect(names(usd)).toEqual([...ALL_MARKETS].sort());
    expect(names(inr)).toEqual(names(usd));
  });

  it('keeps Meta’s own INR price for each market, not a figure derived from the USD one', () => {
    expect(cost(usd, 'India', 'marketing')).toBe(11_800);
    expect(cost(inr, 'India', 'marketing')).toBe(863_100);
    expect(cost(inr, 'India', 'utility')).toBe(115_000);
    // About 73 rupees to the dollar, but Meta rounds each row on its own, so the ratio is not one constant.
    const ratio = (m: string) => cost(inr, m, 'marketing')! / cost(usd, m, 'marketing')!;
    expect(ratio('India')).toBeGreaterThan(70);
    expect(ratio('India')).toBeLessThan(76);
    expect(ratio('India')).not.toBe(ratio('Germany'));
  });

  it('reads a value written in scientific notation (8.0E-4)', () => {
    expect(cost(usd, 'Colombia', 'utility')).toBe(800);
  });

  it('skips "n/a" (no authentication-international rate for that market) rather than reading it as zero', () => {
    expect(cost(usd, 'Argentina', 'authentication_international')).toBeUndefined();
    expect(cost(usd, 'India', 'authentication_international')).toBe(30_400);
  });

  it('ignores the Meta Business Agent column, which is priced per million tokens in dollars', () => {
    expect(usd.rows.every((r) => r.category !== ('meta_business_agent' as string))).toBe(true);
  });
});

describe('a CSV saved from the workbook reads the same', () => {
  it('gives the same card', () => {
    const csv = [
      'Cost per message in INR on the WhatsApp Business Platform, effective October 1, 2026',
      '',
      'Market,Currency,Marketing,Utility,Authentication,"Authentication-\nInternational",Service',
      'India,INR,0.8631,0.115,0.115,2.4971,0.115',
      'Other,INR,4.4248,0.5641,0.5641,n/a,0.5641',
    ].join('\n');
    const card = parseMetaCardFile(Buffer.from(csv, 'utf8'));
    expect(card.currency).toBe('INR');
    expect(card.effectiveOn).toBe('2026-10-01');
    expect(cost(card, 'India', 'authentication_international')).toBe(2_497_100);
    expect(cost(card, 'Other', 'marketing')).toBe(4_424_800);
    expect(cost(card, 'Other', 'authentication_international')).toBeUndefined();
  });
});

describe('refusing a file that is not trustworthy', () => {
  const sheet = (lines: string[]) => Buffer.from(lines.join('\n'), 'utf8');
  const head = 'Market,Currency,Marketing,Utility,Authentication,Service';

  it('refuses a file with no header', () => {
    expect(() => parseMetaCardFile(sheet(['hello', 'world']))).toThrow(MetaCardFileError);
  });

  it('refuses a card that does not say when it takes effect', () => {
    expect(() => parseMetaCardFile(sheet([head, 'India,INR,1,1,1,1']))).toThrow(/takes effect/);
  });

  it('refuses a file that mixes currencies', () => {
    const lines = [
      'Cost per message, effective July 1, 2026',
      head,
      'India,INR,1,1,1,1',
      'Brazil,USD,1,1,1,1',
    ];
    expect(() => parseMetaCardFile(sheet(lines))).toThrow(/mixes currencies/);
  });

  it('reports a market it does not know and a bad amount, and still reads the rest', () => {
    const lines = [
      'Cost per message, effective July 1, 2026',
      head,
      'India,INR,1,x,1,1',
      'Atlantis,INR,1,1,1,1',
    ];
    const card = parseMetaCardFile(sheet(lines));
    expect(card.problems.join(' ')).toMatch(/"x" is not an amount/);
    expect(card.problems.join(' ')).toMatch(
      /Atlantis: Meta lists a market this platform does not know/,
    );
    expect(cost(card, 'India', 'marketing')).toBe(1_000_000);
    expect(card.rows.some((r) => r.market === 'Atlantis')).toBe(false);
  });

  it('refuses a card with no usable row', () => {
    const lines = ['Cost per message, effective July 1, 2026', head, 'Atlantis,INR,1,1,1,1'];
    expect(() => parseMetaCardFile(sheet(lines))).toThrow(/No usable rate row/);
  });
});

describe('Meta’s market map', () => {
  it('puts a country in the market Meta prices it in', () => {
    expect(marketOf('IN')).toBe('India');
    expect(marketOf('in')).toBe('India');
    expect(marketOf('US')).toBe('North America');
    expect(marketOf('CA')).toBe('North America');
    expect(marketOf('TH')).toBe('Rest of Asia Pacific');
    expect(marketOf('CH')).toBe('Rest of Western Europe');
    expect(marketOf('KE')).toBe('Rest of Africa');
  });

  it('prices a country Meta names nowhere, and a missing country, as Other', () => {
    expect(marketOf('ZZ')).toBe('Other');
    expect(marketOf('')).toBe('Other');
    expect(marketOf(null)).toBe('Other');
    expect(marketOf(undefined)).toBe('Other');
  });

  it('puts no country in two markets, and lists 39 standalone countries', () => {
    const all = [...Object.values(STANDALONE_MARKETS), ...Object.values(REGION_MARKETS).flat()];
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(STANDALONE_MARKETS)).toHaveLength(39);
    expect(ALL_MARKETS).toHaveLength(47);
  });

  it('lists the countries of a market, and none for Other', () => {
    expect(countriesOf('India')).toEqual(['IN']);
    expect(countriesOf('North America')).toEqual(['CA', 'US']);
    expect(countriesOf('Other')).toEqual([]);
  });
});

describe('the quarterly reminder', () => {
  const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

  it('finds the quarter we are in and the next one', () => {
    expect(quarterBounds(day('2026-10-04'))).toEqual({ start: '2026-10-01', next: '2027-01-01' });
    expect(quarterBounds(day('2026-12-31'))).toEqual({ start: '2026-10-01', next: '2027-01-01' });
    expect(quarterBounds(day('2027-01-01'))).toEqual({ start: '2027-01-01', next: '2027-04-01' });
    expect(quarterBounds(day('2026-05-17'))).toEqual({ start: '2026-04-01', next: '2026-07-01' });
  });

  it('is current when the card was checked this quarter and the next one is far off', () => {
    expect(cardFreshness('2026-10-04', day('2026-11-02')).state).toBe('current');
  });

  it('is due once a quarter has begun since the card was checked', () => {
    expect(cardFreshness('2026-09-30', day('2026-10-01')).state).toBe('due');
    expect(cardFreshness('2026-07-02', day('2026-10-04')).state).toBe('due');
  });

  it('is due when there is no card at all', () => {
    expect(cardFreshness(null, day('2026-10-04')).state).toBe('due');
  });

  it('warns in the two weeks before Meta can change prices', () => {
    expect(cardFreshness('2026-10-04', day('2026-12-17')).state).toBe('current');
    const soon = cardFreshness('2026-10-04', day('2026-12-18'));
    expect([soon.state, soon.daysUntilNext]).toEqual(['upcoming', 14]);
    expect(cardFreshness('2026-10-04', day('2026-12-31')).daysUntilNext).toBe(1);
  });

  it('says the most pressing thing across several cards, and due when there are none', () => {
    const today = day('2026-10-04');
    const current = cardFreshness('2026-10-04', today);
    const due = cardFreshness('2026-06-01', today);
    expect(mostPressing([current, due, current], today).state).toBe('due');
    expect(mostPressing([current], today).state).toBe('current');
    expect(mostPressing([], today).state).toBe('due');
  });
});
