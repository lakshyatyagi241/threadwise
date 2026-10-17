import type { ContactSendWindow } from '@crm/contracts';

/**
 * The key of the sentence that says where a contact's clock comes from (BL-193). A zone stored on the contact says who set it (a
 * person, a CSV import, the API); an older time zone property says so too; otherwise the clock is worked out and the sentence names
 * where from: the country of the number, the fallback zone chosen in Compliance center, the workspace's own zone, or UTC.
 */
export type TimezoneSourceKey =
  | 'staff'
  | 'import'
  | 'api'
  | 'contact_field'
  | 'phone_country'
  | 'window_setting'
  | 'workspace'
  | 'utc';

export function sourceKey(
  w: Pick<ContactSendWindow, 'timezone' | 'timezoneSource' | 'clock'>,
): TimezoneSourceKey {
  if (w.timezone !== null && w.timezoneSource !== null) return w.timezoneSource;
  return w.clock.source;
}
