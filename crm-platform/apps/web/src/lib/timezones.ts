/**
 * ICU lists a few zones under their old canonical names (Asia/Calcutta, Europe/Kiev, ...), and some engines leave out the
 * modern one. This maps each old name to the modern id; the modern id is shown and stored, the old one is still accepted.
 */
export const MODERN_ZONE: Readonly<Record<string, string>> = {
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

/** Zones the browser may leave out of its list; always offered so a saved value can be picked again. */
const ALWAYS_OFFERED = ['Asia/Kolkata'];

/**
 * Zones in modern spelling, sorted, with the always-offered ones added and no repeats. When `current` is a legacy name,
 * its modern id is left out, because `current` already stands for that zone in the list.
 */
export function modernZoneList(zones: readonly string[], current?: string): string[] {
  const alias = current ? MODERN_ZONE[current] : undefined;
  return [...new Set([...zones.map((z) => MODERN_ZONE[z] ?? z), ...ALWAYS_OFFERED])]
    .filter((z) => z !== alias)
    .sort();
}

/**
 * The IANA time zones a person can pick (a dropdown, never a typed name): the browser's own list, with the current value
 * kept in it when it is not on that list (an older saved name, or a browser that cannot list zones), UTC always present.
 */
export function timezoneList(current?: string): string[] {
  const engine =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = modernZoneList(engine, current);
  const base = all.includes('UTC') ? all : ['UTC', ...all];
  return current && !base.includes(current) ? [current, ...base] : base;
}
