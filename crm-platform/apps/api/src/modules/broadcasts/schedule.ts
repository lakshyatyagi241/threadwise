/**
 * The instant a "send later" broadcast fires (WD-BCAST-015).
 *
 * WaDesk read the date and time in the server's zone and only stored the chosen zone, so 09:00 Asia/Kolkata fired at
 * 09:00 UTC. The inventory makes reading the wall time in the chosen zone the port requirement; that is what this does.
 */

/** UTC offset of `zone` at `instant`, in ms. Throws RangeError for an unknown zone. */
function zoneOffsetMs(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function isKnownTimeZone(zone: string): boolean {
  try {
    zoneOffsetMs(zone, Date.now());
    return true;
  } catch {
    return false;
  }
}

/** Wall time `date` (YYYY-MM-DD) `time` (HH:mm) in `zone`, as a UTC instant. */
export function wallTimeToUtc(date: string, time: string, zone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset when the wall time sits next to a daylight-saving change.
  let utc = naive - zoneOffsetMs(zone, naive);
  utc = naive - zoneOffsetMs(zone, utc);
  return new Date(utc);
}
