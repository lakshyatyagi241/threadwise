/** ICU lists a few zones under their old name (Asia/Calcutta), so the modern id has to be added by hand. */
const MODERN_ZONE: Readonly<Record<string, string>> = { 'Asia/Calcutta': 'Asia/Kolkata' };

/** Zones the browser may leave out of its list; always offered so a saved value can be picked again. */
const ALWAYS_OFFERED = ['Asia/Kolkata'];

/**
 * The IANA time zones a person can pick (a dropdown, never a typed name): the browser's own list, with the current value
 * kept in it when it is not on that list (an older saved name, or a browser that cannot list zones), UTC always present.
 */
export function timezoneList(current?: string): string[] {
  const engine =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = [...new Set([...engine.map((z) => MODERN_ZONE[z] ?? z), ...ALWAYS_OFFERED])].sort();
  const base = all.includes('UTC') ? all : ['UTC', ...all];
  return current && !base.includes(current) ? [current, ...base] : base;
}
