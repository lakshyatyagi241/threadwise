/**
 * Calendar-day arithmetic for the range calendar. Pure.
 *
 * A day is the string 'YYYY-MM-DD', never a Date that crosses a time zone: every sum is done on the UTC midnight of the string, which
 * has no daylight-saving change, so "30 days before 2026-03-29" is the same day for everyone. Months are numbered 1..12 (not 0..11).
 */

import { latinDigits } from '@/lib/format/numbers';

const DAY_MS = 86_400_000;
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YearMonth {
  year: number;
  /** 1 (January) to 12 (December). */
  month: number;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** 'YYYY-MM-DD' from its parts (no check that the day exists). */
export const formatDate = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** Days in a month, leap years included. */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The parts of a day, or null when the text is not a real calendar day ('2026-02-30' is not). */
export function parseDate(date: string): { year: number; month: number; day: number } | null {
  const match = SHAPE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && parseDate(value) !== null;

function toUtc(date: string): number {
  const parts = parseDate(date);
  if (!parts) throw new RangeError(`Not a calendar day: ${date}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

const fromUtc = (ms: number): string => {
  const d = new Date(ms);
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/** The day `n` days after `date` (before it when `n` is negative). */
export const addDays = (date: string, n: number): string => fromUtc(toUtc(date) + n * DAY_MS);

/** Whole days from `a` to `b`: positive when `b` is later. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

/** Negative when `a` is earlier than `b`, zero when they are the same day, positive when later. */
export function compareDates(a: string, b: string): number {
  const diff = toUtc(a) - toUtc(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** Both days, earlier first. */
export const orderDates = (a: string, b: string): [string, string] =>
  compareDates(a, b) <= 0 ? [a, b] : [b, a];

/** How many calendar days a range covers, both ends counted: one day is 1, 2026-09-13 to 2026-10-12 is 30. Order does not matter. */
export const spanDays = (a: string, b: string): number => Math.abs(daysBetween(a, b)) + 1;

/** The month a day is in. */
export function monthOf(date: string): YearMonth {
  const parts = parseDate(date);
  if (!parts) throw new RangeError(`Not a calendar day: ${date}`);
  return { year: parts.year, month: parts.month };
}

/** The month `n` months after `from` (before it when negative). */
export function addMonths(from: YearMonth, n: number): YearMonth {
  const index = from.year * 12 + (from.month - 1) + n;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** Negative when month `a` is before `b`, zero when the same, positive when after. */
export const compareMonths = (a: YearMonth, b: YearMonth): number =>
  a.year * 12 + a.month - (b.year * 12 + b.month);

/** Day of the week: 0 is Sunday, 6 is Saturday. */
export const weekdayOf = (date: string): number => new Date(toUtc(date)).getUTCDay();

/** The days of a month as 6 weeks of 7 (Sunday first). A cell outside the month is null, so every month has the same height. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const lead = weekdayOf(formatDate(year, month, 1));
  const count = daysInMonth(year, month);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, column) => {
      const day = week * 7 + column - lead + 1;
      return day >= 1 && day <= count ? formatDate(year, month, day) : null;
    }),
  );
}

function format(
  language: string,
  options: Intl.DateTimeFormatOptions,
  at: Date,
  fallback: string,
): string {
  try {
    return new Intl.DateTimeFormat(latinDigits(language), { timeZone: 'UTC', ...options }).format(
      at,
    );
  } catch {
    return fallback;
  }
}

/** "October 2026". */
export const monthTitle = (ym: YearMonth, language: string): string =>
  format(
    language,
    { month: 'long', year: 'numeric' },
    new Date(Date.UTC(ym.year, ym.month - 1, 1)),
    `${pad(ym.year, 4)}-${pad(ym.month, 2)}`,
  );

/** "Monday, October 12, 2026": the name a screen reader gives a day. */
export const longDateLabel = (date: string, language: string): string =>
  format(
    language,
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    new Date(toUtc(date)),
    date,
  );

/** The seven short weekday names, Sunday first ("Sun" .. "Sat"). 2023-01-01 was a Sunday. */
export const weekdayNames = (language: string): string[] =>
  Array.from({ length: 7 }, (_, i) =>
    format(language, { weekday: 'short' }, new Date(Date.UTC(2023, 0, 1 + i)), String(i)),
  );
