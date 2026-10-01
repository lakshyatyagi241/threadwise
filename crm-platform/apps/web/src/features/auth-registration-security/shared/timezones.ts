/**
 * IANA timezone helpers for the onboarding and profile pickers (WD-AUTH-008/025).
 * WaDesk lists every PHP identifier with its UTC offset; here the browser's own
 * ICU data is the source, so the list never drifts from what `Intl` can format.
 */

/** Fallback when `Intl.supportedValuesOf` is missing (old engines). */
const FALLBACK_ZONES = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Pacific/Auckland',
  'UTC',
];

/**
 * ICU lists a few zones under their old canonical names (Asia/Calcutta,
 * Europe/Kiev, ...), so someone searching "Kolkata" would find nothing. WaDesk
 * hit the same thing and maps the aliases; the modern id is shown and stored,
 * and the old one is still accepted (the server validates with Intl too).
 */
const MODERN_ID: Readonly<Record<string, string>> = {
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** The modern spelling of a zone id when the engine knows it, else the id unchanged. */
export function modernZoneId(zone: string): string {
  const modern = MODERN_ID[zone];
  return modern && utcOffsetMinutes(modern) !== null ? modern : zone;
}

export function supportedTimeZones(): string[] {
  const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = typeof fn === 'function' ? fn.call(Intl, 'timeZone') : FALLBACK_ZONES;
  const set = new Set(zones.map(modernZoneId));
  // Some engines omit UTC from the list although they accept it.
  set.add('UTC');
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Parses an `Intl` offset such as "GMT+5:30", "GMT-08:00" or "GMT" into minutes. */
export function parseOffsetName(name: string): number | null {
  if (name === 'GMT' || name === 'UTC') return 0;
  const m = /^(?:GMT|UTC)([+−-])(\d{1,2})(?::?(\d{2}))?$/.exec(name.trim());
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = Number(m[2]);
  const minutes = m[3] ? Number(m[3]) : 0;
  return sign * (hours * 60 + minutes);
}

/** The zone's UTC offset in minutes at the given moment (DST included), or null for an unknown zone. */
export function utcOffsetMinutes(timeZone: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return parts ? parseOffsetName(parts.value) : null;
  } catch {
    return null;
  }
}

/** "UTC+00:00", "UTC+05:30", "UTC-08:00". */
export function formatUtcOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${minutes < 0 ? '-' : '+'}${hh}:${mm}`;
}

export interface TimezoneOption {
  value: string;
  /** "Asia/Kolkata (UTC+05:30)" */
  label: string;
  offsetMinutes: number | null;
  /** Lower-cased, underscores as spaces: what the search box matches against. */
  search: string;
}

export function timezoneLabel(zone: string, at: Date = new Date()): string {
  const off = utcOffsetMinutes(zone, at);
  return off === null ? zone : `${zone} (${formatUtcOffset(off)})`;
}

/** One option per zone, in name order. `extra` zones (the current value, the default) are always present. */
export function buildTimezoneOptions(
  zones: readonly string[],
  at: Date = new Date(),
  extra: ReadonlyArray<string | null | undefined> = [],
): TimezoneOption[] {
  const all = new Set(zones);
  for (const z of extra) if (z) all.add(modernZoneId(z));
  return [...all]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      const offsetMinutes = utcOffsetMinutes(zone, at);
      const label = offsetMinutes === null ? zone : `${zone} (${formatUtcOffset(offsetMinutes)})`;
      return { value: zone, label, offsetMinutes, search: label.toLowerCase().replace(/_/g, ' ') };
    });
}

/**
 * Options matching a search box: every word must appear somewhere in the label.
 * Better matches come first (label starts with the query, then a word starts
 * with it, then anywhere), so "india" finds India before "British Indian Ocean
 * Territory" and Enter picks what the person meant. Ties keep the list order.
 */
export function filterOptions<T extends { search: string }>(
  options: readonly T[],
  query: string,
): T[] {
  const normalized = query.toLowerCase().replace(/_/g, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];

  const rank = (search: string): number => {
    if (search.startsWith(normalized)) return 0;
    if (search.includes(` ${normalized}`) || search.includes(`/${normalized}`)) return 1;
    return 2;
  };
  return options
    .filter((o) => words.every((w) => o.search.includes(w)))
    .map((option, index) => ({ option, index, score: rank(option.search) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((r) => r.option);
}

let cachedBase: { hour: number; options: TimezoneOption[] } | null = null;

/**
 * The full option list, built once per hour (about 420 `Intl` formatters, too
 * heavy to rebuild on every render). `extra` zones (the saved value, the
 * platform default) are merged in when the engine does not list them.
 */
export function timezoneOptions(
  extra: ReadonlyArray<string | null | undefined> = [],
): TimezoneOption[] {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  if (!cachedBase || cachedBase.hour !== hour) {
    cachedBase = { hour, options: buildTimezoneOptions(supportedTimeZones(), new Date(now)) };
  }
  const known = new Set(cachedBase.options.map((o) => o.value));
  const missing = extra
    .filter((z): z is string => Boolean(z))
    .map(modernZoneId)
    .filter((z) => !known.has(z));
  if (missing.length === 0) return cachedBase.options;
  return [...cachedBase.options, ...buildTimezoneOptions([], new Date(now), missing)].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}
