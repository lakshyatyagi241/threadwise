/**
 * Wall-clock times in a chosen IANA zone (TW-CMS-040). A `datetime-local` value has no zone; the announcement form lets the
 * operator pick one, and the API stores the instant. Reference stored the wall time as if it were server time, so a non-default
 * zone was off by the difference; here the conversion is exact, including across daylight-saving changes.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}

/** `2030-01-01T09:00` read in `zone` as an ISO instant; null for an empty or unreadable value. */
export function localToInstant(local: string, zone: string): string | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  try {
    // Two passes settle the offset when the guess lands on the other side of a daylight-saving change.
    let guess = naive - offsetMinutes(naive, zone) * 60_000;
    guess = naive - offsetMinutes(guess, zone) * 60_000;
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

/** An ISO instant as the `datetime-local` value it has in `zone`; empty for null. */
export function instantToLocal(iso: string | null, zone: string): string {
  if (!iso) return '';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const shifted = new Date(at + offsetMinutes(at, zone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The zones the browser knows, with the given one first; a short list where `Intl.supportedValuesOf` is missing. */
export function zoneList(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf?.('timeZone') ?? [
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Sao_Paulo',
  ];
  return [current, ...all.filter((z) => z !== current)];
}

export const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
