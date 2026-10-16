import type { ContactResponse, V1Contact } from '@crm/contracts';

/** Reference shows `+` and digits only, whatever was stored; a number with no digits is no phone. */
export function toE164(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '');
  return digits === '' ? null : `+${digits}`;
}

/** `ContactResponse` (the dashboard's shape, read with its groups) to Reference's public contact. */
export function toV1Contact(c: ContactResponse): V1Contact {
  return {
    id: c.id,
    name: c.name,
    phone: toE164(c.phone),
    email: c.email,
    tags: (c.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
    attributes: c.customFields ?? {},
    timezone: c.timezone,
    timezone_source: c.timezoneSource,
    created_at: c.createdAt,
  };
}
