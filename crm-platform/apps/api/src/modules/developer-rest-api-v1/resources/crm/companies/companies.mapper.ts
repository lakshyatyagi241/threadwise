import type { CompanyResponse, V1Company } from '@crm/contracts';

/** `CompanyResponse` (the dashboard shape) to the customer API flat snake_case company: ids only, no rollup, no embedded people. */
export function toV1Company(c: CompanyResponse): V1Company {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    email: c.email,
    phone: c.phone,
    industry: c.industry,
    size_range: c.sizeRange,
    address: c.address,
    notes: c.notes,
    owner_user_id: c.owner?.id ?? null,
    custom_fields: c.customFields,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}
