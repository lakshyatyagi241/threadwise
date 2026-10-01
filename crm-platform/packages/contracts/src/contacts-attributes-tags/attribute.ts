import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { queryBoolean } from './query-helpers';

/**
 * Attributes (WD-CON-042..049): the workspace's merge variables. They are rows of
 * the typed custom-field registry (`fields`, moduleKey "contacts"), not a second
 * model as in WaDesk, so a contact's values live in `contacts.data` under the key
 * and one registry feeds the contact form, the picker, the preview and the send-time
 * resolver.
 */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const ATTRIBUTE_LABEL_MAX = 120;
export const ATTRIBUTE_DEFAULT_MAX = 255;
export const ATTRIBUTE_DESCRIPTION_MAX = 500;

/**
 * The tokens every workspace has without defining anything (WD-CON-046). A custom
 * attribute may not take one of these keys, nor the contact columns they are
 * aliases of, nor `status` and `source`: at send time the column would win and the
 * attribute would silently never be used.
 */
export const SYSTEM_ATTRIBUTES = [
  { key: 'first_name', name: 'First name', description: "The contact's first name" },
  { key: 'name', name: 'Name', description: "The contact's full name" },
  { key: 'last_name', name: 'Last name', description: "The contact's last name" },
  { key: 'phone_number', name: 'Phone number', description: 'Full number with country code' },
  { key: 'email', name: 'Email', description: "The contact's email address" },
  { key: 'country_code', name: 'Country code', description: 'Dial code, like +91' },
  { key: 'address', name: 'Address', description: "The contact's address" },
  { key: 'language', name: 'Language', description: "The contact's language" },
  { key: 'business_name', name: 'Business name', description: 'Your business name' },
  { key: 'today', name: 'Today', description: "Today's date" },
] as const;

/** Every key that already means something at send time. */
export const RESERVED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  ...SYSTEM_ATTRIBUTES.map((a) => a.key),
  'middle_name',
  'title',
  'phone',
  'mobile',
  'groups',
  'contact_group',
  'company_name',
  'status',
  'source',
  'id',
  'uuid',
  'tags',
  'owner',
]);

export const attributeKeySchema = z
  .string()
  .regex(
    ATTRIBUTE_KEY_PATTERN,
    'key must be lowercase letters, digits and underscores, starting with a letter (max 64)',
  );

/** Types an attribute can have; the ones that need an option list are managed in Contact Properties. */
export const ATTRIBUTE_TYPES = [
  'text',
  'long_text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'url',
  'email',
  'phone',
] as const;
export const attributeTypeSchema = z.enum(ATTRIBUTE_TYPES);

export const attributeResponseSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  type: z.string(),
  /** Fills the token for a contact with no value of their own. */
  defaultValue: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttributeResponse = z.infer<typeof attributeResponseSchema>;

export const createAttributeSchema = z.object({
  name: z.string().trim().min(1).max(ATTRIBUTE_LABEL_MAX),
  key: attributeKeySchema,
  type: attributeTypeSchema.default('text'),
  defaultValue: z.string().max(ATTRIBUTE_DEFAULT_MAX).nullish(),
  description: z.string().max(ATTRIBUTE_DESCRIPTION_MAX).nullish(),
  /** An explicit boolean (WaDesk's unticked checkbox sent nothing and was read as true). */
  isActive: z.boolean().default(true),
});
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;

/** The key and the type never change: templates and stored values reference them. */
export const updateAttributeSchema = z.object({
  name: z.string().trim().min(1).max(ATTRIBUTE_LABEL_MAX).optional(),
  defaultValue: z.string().max(ATTRIBUTE_DEFAULT_MAX).nullish(),
  description: z.string().max(ATTRIBUTE_DESCRIPTION_MAX).nullish(),
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;

export const listAttributesQuerySchema = paginationQuerySchema.extend({
  /** Name, key or description. */
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});
export type ListAttributesQuery = z.infer<typeof listAttributesQuerySchema>;

/** Tile counts: workspace-wide, they ignore the search and the status filter. */
export const attributeCountsSchema = z.object({
  all: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
});

export const attributeListResponseSchema = z.object({
  data: z.array(attributeResponseSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
  counts: attributeCountsSchema,
});
export type AttributeListResponse = z.infer<typeof attributeListResponseSchema>;

/**
 * Deleting an attribute leaves the values stored on contacts. When some hold one,
 * the delete is refused until the caller confirms with `force=true`.
 */
export const deleteAttributeQuerySchema = z.object({
  force: queryBoolean().default(false),
});
export type DeleteAttributeQuery = z.infer<typeof deleteAttributeQuerySchema>;

// --- the picker feed and the catalogue (WD-CON-046, 047) ----------------------------------

export const attributePickerFeedSchema = z.object({
  system: z.array(z.object({ key: z.string(), name: z.string(), description: z.string() })),
  /** ACTIVE attributes only. */
  custom: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      value: z.string().nullable(),
    }),
  ),
});
export type AttributePickerFeed = z.infer<typeof attributePickerFeedSchema>;

export const attributeCatalogGroupSchema = z.enum([
  'contact',
  'custom_field',
  'workspace',
  'system',
]);
export const attributeCatalogSchema = z.object({
  groups: z.array(
    z.object({
      group: attributeCatalogGroupSchema,
      items: z.array(
        z.object({ key: z.string(), label: z.string(), sample: z.string().nullable() }),
      ),
    }),
  ),
});
export type AttributeCatalog = z.infer<typeof attributeCatalogSchema>;

// --- merge-tag resolution (WD-CON-048) ---------------------------------------------------

/** `{{ token }}`: anything but braces, so "{{Phone Number}}" is a token too. */
export const MERGE_TAG_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Key normalisation: trim, lowercase, spaces/dashes/dots to an underscore, drop
 * everything but a-z 0-9 _, trim underscores.
 */
export function normalizeMergeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}

/** Alias -> the key it means. */
export const MERGE_KEY_ALIASES: Readonly<Record<string, string>> = {
  phone_number: 'phone',
  phone_no: 'phone',
  whatsapp_number: 'phone',
  number: 'phone',
  contact_number: 'phone',
  mobile_number: 'mobile',
  mobile_no: 'mobile',
  full_name: 'name',
  customer_name: 'name',
  contact_name: 'name',
  first: 'first_name',
  last: 'last_name',
  surname: 'last_name',
  mail: 'email',
  email_address: 'email',
  e_mail: 'email',
  sender_name: 'business_name',
  sender: 'business_name',
  business: 'business_name',
  brand: 'business_name',
  brand_name: 'business_name',
  whatsapp_name: 'business_name',
  store_name: 'business_name',
  shop_name: 'business_name',
};

export const resolveMergeTagSchema = z.object({
  template: z.string().max(5000),
  contactId: uuidSchema.optional(),
});
export type ResolveMergeTagInput = z.infer<typeof resolveMergeTagSchema>;

export const resolveMergeTagResponseSchema = z.object({
  rendered: z.string(),
  tokens: z.array(
    z.object({
      token: z.string(),
      key: z.string(),
      resolved: z.boolean(),
      /** Where the value came from. */
      source: z.enum(['contact', 'contact_attribute', 'attribute_default', 'system', 'unresolved']),
    }),
  ),
});
export type ResolveMergeTagResponse = z.infer<typeof resolveMergeTagResponseSchema>;

export const POSITIONAL_PLACEHOLDER_MESSAGE =
  'Variable placeholders must be 1-based and contiguous (use {{1}}, {{2}}, {{3}}... no gaps).';

/**
 * Positional placeholders (`{{1}}`, `{{2}}`) must be 1..N with no gap (WD-CON-049).
 * Named tokens are ignored; an empty body is valid. For the templates, broadcast and
 * campaign save paths.
 */
export function validatePositionalPlaceholders(body: string | null | undefined): boolean {
  if (!body) return true;
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]));
  if (found.size === 0) return true;
  const sorted = [...found].sort((a, b) => a - b);
  return sorted.every((n, i) => n === i + 1);
}
