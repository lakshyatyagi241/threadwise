import {
  SUMMARY_WINDOW_DAYS,
  SUMMARY_WINDOW_DEFAULT,
  type CampaignSummary,
  type SummaryCaveat,
  type SummaryPerson,
} from '@crm/contracts';

/**
 * The director summary (owner walkthrough item 23): everything the screen decides before it draws, as pure functions so the plain
 * words, the percentages, the window in the address and the CSV are tested without a browser.
 */

export type SummaryKind = 'campaign' | 'broadcast';
export type PeopleKind = 'came_back' | 'filled_form' | 'not_reached';
export const PEOPLE_KINDS: readonly PeopleKind[] = ['came_back', 'filled_form', 'not_reached'];

/* ----------------------------------------------------------------- the window in the address */

export const WINDOWS: readonly number[] = SUMMARY_WINDOW_DAYS;
export const DEFAULT_WINDOW: number = SUMMARY_WINDOW_DEFAULT;

/** `?window=14` to 14; anything else (missing, 5, "abc") to the default of 7. */
export function parseWindow(raw: string | null | undefined): number {
  const n = Number(raw);
  return WINDOWS.includes(n) ? n : DEFAULT_WINDOW;
}

/** The query string with `window` set and every other parameter (the tab, a filter) kept; no leading `?`. */
export function searchWithWindow(search: string, days: number): string {
  const p = new URLSearchParams(search);
  p.set('window', String(parseWindow(String(days))));
  return p.toString();
}

/** A stable cache key for the picked forms: de-duplicated and sorted, so the same choice never refetches. */
export function formKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',');
}

/** What was stored for the picked forms, cleaned: only strings that look like ids, no more than the API takes. */
export function cleanFormIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ok = raw.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{32,40}$/i.test(v));
  return [...new Set(ok)].slice(0, 50);
}

/* ------------------------------------------------------------------------------- percentages */

export type PctWords =
  { key: 'zero' } | { key: 'everyone' } | { key: 'less' } | { key: 'of'; pct: number };

/**
 * "13% of the people you messaged" as a choice of wording: nobody, everybody, under one percent, or a whole percent. A number is
 * never rounded up to 100% unless it really is everyone, and never down to 0% when somebody is in it.
 */
export function pctWords(count: number, base: number): PctWords {
  if (count <= 0 || base <= 0) return { key: 'zero' };
  if (count >= base) return { key: 'everyone' };
  const pct = (count / base) * 100;
  if (pct < 1) return { key: 'less' };
  return { key: 'of', pct: Math.min(99, Math.round(pct)) };
}

/* ---------------------------------------------------------------------------------- headline */

export interface HeadlinePart {
  /** A key under `campaigns.detail.summary.headline`. */
  key: string;
  values: Record<string, number>;
}
export interface Headline {
  /** `none`: nothing has been sent; `notReceived`: sent but no phone has it yet; `full`: the whole sentence. */
  kind: 'none' | 'notReceived' | 'full';
  first: HeadlinePart;
  /** The clauses of the second sentence, in reading order; empty unless `full`. */
  clauses: HeadlinePart[];
}

/**
 * The one-sentence headline as parts the screen turns into words: "You messaged 1,240 people." then "1,150 received it, 810 opened it,
 * 164 wrote back within 7 days and 31 filled in an application form." A person who may not see forms gets a sentence without that clause.
 */
export function buildHeadline(s: CampaignSummary): Headline {
  const p = s.people;
  if (p.messaged <= 0) {
    return { kind: 'none', first: { key: 'none', values: {} }, clauses: [] };
  }
  const first: HeadlinePart = { key: 'messaged', values: { count: p.messaged } };
  if (p.delivered <= 0) return { kind: 'notReceived', first, clauses: [] };
  const clauses: HeadlinePart[] = [
    { key: 'received', values: { count: p.delivered } },
    { key: 'opened', values: { count: p.read } },
    { key: 'wroteBack', values: { count: s.cameBack.count, days: s.window.days } },
  ];
  if (s.filledForm) clauses.push({ key: 'filledForm', values: { count: s.filledForm.count } });
  return { kind: 'full', first, clauses };
}

/** Anything that turns a key and values into a sentence (next-intl's `t`). */
export type Say = (key: string, values?: Record<string, string | number>) => string;
/** Locale-aware "a, b and c" (next-intl's `format.list`). */
export type JoinList = (items: string[]) => string;

/** The headline as one string; `t` is scoped to `campaigns.detail.summary.headline`. */
export function headlineText(s: CampaignSummary, say: Say, join: JoinList): string {
  const h = buildHeadline(s);
  const first = say(h.first.key, h.first.values);
  if (h.kind === 'none') return first;
  if (h.kind === 'notReceived') return say('notReceived', { messaged: first });
  const clauses = join(h.clauses.map((c) => say(c.key, c.values)));
  return say('full', { messaged: first, rest: say('rest', { clauses }) });
}

/* ----------------------------------------------------------------------------------- tiles */

export type TileKey = 'messaged' | 'received' | 'opened' | 'wroteBack' | 'filledForm';
export interface Tile {
  key: TileKey;
  count: number;
  pct: PctWords | null;
}

/** The five tiles in order. `filledForm` is left out when the viewer may not read form submissions. */
export function buildTiles(s: CampaignSummary): Tile[] {
  const base = s.people.messaged;
  const tiles: Tile[] = [
    { key: 'messaged', count: base, pct: null },
    { key: 'received', count: s.people.delivered, pct: pctWords(s.people.delivered, base) },
    { key: 'opened', count: s.people.read, pct: pctWords(s.people.read, base) },
    { key: 'wroteBack', count: s.cameBack.count, pct: pctWords(s.cameBack.count, base) },
  ];
  if (s.filledForm) {
    tiles.push({
      key: 'filledForm',
      count: s.filledForm.count,
      pct: pctWords(s.filledForm.count, base),
    });
  }
  return tiles;
}

/** Messaged to filled a form, for the single calm funnel. */
export function funnelRows(s: CampaignSummary): Array<{ key: TileKey; value: number }> {
  return buildTiles(s).map((t) => ({ key: t.key, value: t.count }));
}

/* ---------------------------------------------------------------------------------- caveats */

export interface CaveatLine {
  code: SummaryCaveat;
  /** A key under `campaigns.detail.summary.caveats`. */
  key: SummaryCaveat;
  values: Record<string, number>;
}

/** Each caveat code as a plain sentence key with its numbers. Codes from a newer API than this build are not shown. */
export function caveatLines(s: CampaignSummary): CaveatLine[] {
  const known: SummaryCaveat[] = [
    'recipients_without_contact',
    'contact_match_only',
    'opted_out_excluded',
    'counted_in_other_campaigns',
  ];
  return s.caveats
    .filter((c, i, all) => known.includes(c) && all.indexOf(c) === i)
    .map((code) => ({ code, key: code, values: { count: s.people.notTrackable } }));
}

/* -------------------------------------------------------------------------------- the states */

/** Nothing has gone out yet, so there is nothing to summarise. */
export function isNotSent(s: CampaignSummary): boolean {
  return s.people.messaged <= 0;
}

const SENDING = new Set(['running', 'processing', 'queued', 'sending', 'in_progress']);
/** Messages are still going out, so the numbers will grow. */
export function isStillSending(status: string): boolean {
  return SENDING.has(status);
}

const FINISHED = new Set(['completed', 'cancelled', 'failed', 'ended']);
/** The tab a campaign opens on when the address names none: the Summary once it is finished, the Overview while it is live. */
export function defaultTab(status: string): 'summary' | 'overview' {
  return FINISHED.has(status) ? 'summary' : 'overview';
}

/** The busiest day of the line chart, for its text alternative; null when nobody wrote back. */
export function busiestDay(
  byDay: ReadonlyArray<{ day: string; count: number }>,
): { day: string; count: number } | null {
  let best: { day: string; count: number } | null = null;
  for (const d of byDay) if (d.count > 0 && (!best || d.count > best.count)) best = d;
  return best;
}

export const totalCameBack = (byDay: ReadonlyArray<{ count: number }>): number =>
  byDay.reduce((a, d) => a + d.count, 0);

/* ----------------------------------------------------------------------------------- the CSV */

/** Written first so Excel reads the file as UTF-8. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Text a spreadsheet would run as a formula (a name someone typed into a form, a phone that starts with a plus) gets a
 * leading apostrophe so it opens as text; a cell with a comma, quote or line break is quoted with the quotes doubled.
 */
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvLabels {
  headers: { group: string; name: string; phone: string; when: string; form: string };
  group: Record<PeopleKind, string>;
}

/** The names file: one row per person, with the list they came from in the first column. */
export function peopleCsv(
  lists: ReadonlyArray<{ kind: PeopleKind; rows: readonly SummaryPerson[] }>,
  labels: CsvLabels,
): string {
  const h = labels.headers;
  const lines = [[h.group, h.name, h.phone, h.when, h.form].map(csvCell).join(',')];
  for (const list of lists) {
    for (const r of list.rows) {
      lines.push(
        [labels.group[list.kind], r.name, r.phone, r.at, r.formName].map(csvCell).join(','),
      );
    }
  }
  return `${BYTE_ORDER_MARK}${lines.join('\r\n')}\r\n`;
}

/** A file name from the campaign's name: letters and digits of any script, dashes between, never empty. */
export function csvFileName(name: string): string {
  const slug = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'campaign'}-names.csv`;
}
