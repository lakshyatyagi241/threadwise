/**
 * The IANA time zones a person can pick (a dropdown, never a typed name): the browser's own list, with the current value
 * kept in it when it is not on that list (an older saved name, or a browser that cannot list zones), UTC always present.
 */
export function timezoneList(current?: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const base = all.includes('UTC') ? all : ['UTC', ...all];
  return current && !base.includes(current) ? [current, ...base] : base;
}
