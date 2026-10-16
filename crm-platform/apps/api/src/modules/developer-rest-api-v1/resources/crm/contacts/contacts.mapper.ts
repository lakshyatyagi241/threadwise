import type { ContactResponse, V1Contact } from '@crm/contracts';

/** Reference shows `+` and digits only, whatever was stored; a number with no digits is no phone. */
export function toE164(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '');
  return digits === '' ? null : `+${digits}`;
}

/** `ContactResponse` (the dashboard's shape, read with its groups) to Reference's public contact. */
export function toV1Contact(c: ContactResponse, isMinor = false): V1Contact {
  return {
    id: c.id,
    name: c.name,
    phone: toE164(c.phone),
    email: c.email,
    tags: (c.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
    attributes: c.customFields ?? {},
    date_of_birth: c.dateOfBirth,
    is_minor: isMinor,
    created_at: c.createdAt,
  };
}
