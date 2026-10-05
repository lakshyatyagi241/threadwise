import type { GetaChatbotRecord, GetaChatbotSummary } from '@crm/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Geta's display format for a record time, in UTC: day first, two-digit day, short English month, 12-hour clock without a leading
 * zero on the hour. `new Date('2026-10-05T16:37:00Z')` is `05 Oct, 2026 4:37:00 PM`; midnight is `12:00:00 AM`.
 */
export function formatGetaModifiedTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h24 = date.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}, ${date.getUTCFullYear()} ${h12}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * The record as it goes to Geta. We do not own it and invent nothing in it: it is sent as the user pasted it, with one exception,
 * the one documented behaviour here: `modified_time` is refreshed to now (only when the record has that field; one that lacks it
 * is not given one). `chatbot_status`, `bot_enabled` and every other field are left alone.
 */
export function recordForUpdate(record: GetaChatbotRecord, now: Date): GetaChatbotRecord {
  return 'modified_time' in record
    ? { ...record, modified_time: formatGetaModifiedTime(now) }
    : { ...record };
}

/** What the screens and API answers may show of a record: its id, name and bot id. */
export function summaryOf(record: GetaChatbotRecord): GetaChatbotSummary {
  const name = record.name;
  return {
    id: record.id,
    name: typeof name === 'string' && name.trim() !== '' ? name : null,
    botId: record.bot_id,
  };
}
