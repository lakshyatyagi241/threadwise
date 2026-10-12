import type { TFunction } from 'i18next';

const pad = (n: number) => String(n).padStart(2, '0');

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "2:05 PM" in the phone's own time zone; AM and PM are translated. */
export function formatClock(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(d.getMinutes())} ${hours < 12 ? t('inbox.time.am') : t('inbox.time.pm')}`;
}

/**
 * The time at the right of a conversation row: the clock for today, "Yesterday", else day/month/year ("09/10/26"). `now` is a
 * parameter so the rule is testable without a clock. An empty string for a thread with no message yet.
 */
export function formatConversationTime(iso: string | null, now: Date, t: TFunction): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return formatClock(iso, t);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return t('inbox.time.yesterday');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)}`;
}
