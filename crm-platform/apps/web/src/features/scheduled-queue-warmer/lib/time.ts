/** Time zone helpers for the composer: times are entered as wall time in the chosen IANA zone (TW-SCHED-003). */

/** Every IANA zone the browser knows, `UTC` first, as Reference's `DateTimeZone::listIdentifiers()` list. */
export function timezoneList(): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
  } catch {
    zones = [];
  }
  return ['UTC', ...zones.filter((z) => z !== 'UTC')];
}

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function partsIn(ms: number, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(new Date(ms)))
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `{ date: 'YYYY-MM-DD', time: 'HH:mm' }` of an instant on the wall clock of `tz`. */
export function localDateTime(ms: number, tz: string): { date: string; time: string } {
  const p = partsIn(ms, tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** `14:30` or `2:30 PM` to minutes after midnight; null when it is neither. */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** The instant (ms) at which the wall clock of `tz` reads `date` `time`; null when either is unreadable. */
export function wallToEpoch(date: string, time: string, tz: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const minutes = parseTime(time);
  if (!dm || minutes === null) return null;
  const asUtc = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), 0, minutes);
  try {
    // The zone's offset depends on the instant, so settle it in two passes (covers daylight saving edges).
    let guess = asUtc;
    for (let i = 0; i < 2; i++) {
      const p = partsIn(guess, tz);
      const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
      guess = asUtc - (shown - Math.floor(guess / 1000) * 1000);
    }
    return guess;
  } catch {
    return null;
  }
}

/** `Oct 3 · 14:30` for an ISO instant on the wall clock of `tz` (the reference's "M j · H:i"). */
export function formatWhen(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
    }).format(new Date(ms));
    return `${p} · ${localDateTime(ms, tz).time}`;
  } catch {
    return `${iso.slice(0, 10)} · ${iso.slice(11, 16)}`;
  }
}
