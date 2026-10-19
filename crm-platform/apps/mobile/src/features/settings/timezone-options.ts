import type { SelectOption } from '@/components/ui/select-field';

/** Used where the phone's own list is missing (an engine without `Intl.supportedValuesOf`): the common zones. */
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

/** A few zones that engines list under their old names; the modern id is shown and stored (the server accepts both). */
const MODERN_ID: Readonly<Record<string, string>> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
};

const accepts = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Every time zone the phone knows (its own ICU list), the common ones when it has none; the saved zone is always in the list so it
 * shows as chosen even if the engine spells it differently.
 */
export function timezoneOptions(current: string): SelectOption[] {
  const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = typeof list === 'function' ? list.call(Intl, 'timeZone') : FALLBACK_ZONES;
  const set = new Set(zones.map((z) => (MODERN_ID[z] && accepts(MODERN_ID[z]) ? MODERN_ID[z] : z)));
  set.add('UTC');
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b)).map((zone) => ({ value: zone, label: zone }));
}
