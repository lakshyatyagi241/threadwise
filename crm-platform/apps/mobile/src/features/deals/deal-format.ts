import { latinDigits } from '@/lib/format/numbers';

/**
 * Dates for deals. An expected close date is a calendar day ("2026-10-31"), not a moment: it is shown as that day whatever the phone's
 * time zone says, and compared with today's date on the phone.
 */

const DAY_TEXT = /^(\d{4})-(\d{2})-(\d{2})/;

/** The calendar day of a "YYYY-MM-DD" (or longer ISO) text, shown in the language: "31 Oct 2026". Empty when it is not a date. */
export function formatDay(value: string | null | undefined, language: string): string {
  const match = DAY_TEXT.exec(value ?? '');
  if (!match) return '';
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(instant.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(latinDigits(language), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(instant);
  } catch {
    return match[0];
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Today's date on the phone, as "YYYY-MM-DD". */
export const todayText = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

export type DueState = 'overdue' | 'today' | 'upcoming';

/** Where an expected close date stands against today; null when there is none. Plain text comparison: both are YYYY-MM-DD. */
export function dueState(date: string | null | undefined, now: Date = new Date()): DueState | null {
  const match = DAY_TEXT.exec(date ?? '');
  if (!match) return null;
  const day = match[0];
  const today = todayText(now);
  if (day < today) return 'overdue';
  return day === today ? 'today' : 'upcoming';
}

/**
 * The link that opens a WhatsApp chat with a number, or null when there is no number. wa.me wants the digits alone, without the
 * plus sign; it is the same link the web app's "Message" button on a deal uses.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits === '' ? null : `https://wa.me/${digits}`;
}
