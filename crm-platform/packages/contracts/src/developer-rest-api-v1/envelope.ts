/**
 * developer-rest-api-v1 (API): the shapes every `/api/v1` answer shares (TW-API-007).
 *
 * Success is `{ data, meta? }`, failure is `{ error: { code, message, details? } }` with fixed snake_case codes, as in Reference. Three things
 * differ on purpose and are listed in docs/threadwise-port/parity/developer-rest-api-v1.md: ids are uuids, lists are cursor based
 * (`meta.limit`, `meta.next_cursor`, `meta.has_more` instead of page numbers and a total), and validation always answers 422 in this
 * envelope (Reference redirected without `Accept: application/json`).
 */
import { z } from 'zod';

export const V1_ERROR_CODES = {
  MISSING_API_KEY: 'missing_api_key',
  INVALID_API_KEY: 'invalid_api_key',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  VALIDATION_FAILED: 'validation_failed',
  UNPROCESSABLE: 'unprocessable',
  PLAN_FEATURE_DISABLED: 'plan_feature_disabled',
  PLAN_LIMIT: 'plan_limit',
  FORBIDDEN: 'forbidden',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  CONFLICT: 'conflict',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  SERVER_ERROR: 'server_error',
} as const;
export type V1ErrorCode = (typeof V1_ERROR_CODES)[keyof typeof V1_ERROR_CODES];

export const v1ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** `{ field: [messages] }` for validation failures; absent otherwise. */
    details: z.record(z.array(z.string())).optional(),
    requestId: z.string().optional(),
  }),
});
export type V1Error = z.infer<typeof v1ErrorSchema>;

/** `meta` of a list answer. `count` is only present on lists that are not paged (groups, webhooks). */
export const v1PageMetaSchema = z.object({
  limit: z.number().int(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
export type V1PageMeta = z.infer<typeof v1PageMetaSchema>;

export const V1_DEFAULT_LIMIT = 25;
export const V1_MAX_LIMIT = 100;

/**
 * PHP's `(int)` on a request value, which Reference applies to `per_page`: leading numeric text counts ("12abc" is 12, "1.5" is 1, "1e2" is
 * 100), anything else is 0, and a repeated key (`?limit=1&limit=2`) is its last value.
 */
export function phpInt(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return 0;
  const m = /^[ \t\n\r\v\f]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(v);
  if (!m) return 0;
  const n = Math.trunc(Number(m[1]));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Paging query of every v1 list: `limit` (alias `per_page`) and an opaque `cursor`. Exactly like Reference, the size is cast like PHP's
 * `(int)` and pulled into 1 to 100 rather than refused (`abc` and `0` become 1, `1.5` is 1, `1000` is 100); the default 25 applies only
 * when the key is absent. `page` is refused with a message that names the cursor, so a client written for Reference learns why instead of
 * silently getting page one.
 */
export const v1ListQuerySchema = z
  .object({
    limit: z.unknown().optional(),
    per_page: z.unknown().optional(),
    cursor: z.string().min(1).max(512).optional(),
    page: z.unknown().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.page !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page'],
        message:
          'Page numbers are not supported. Pass the `cursor` from `meta.next_cursor` of the previous page.',
      });
    }
  })
  .transform(({ limit, per_page, cursor }) => {
    const raw = limit !== undefined ? limit : per_page;
    return {
      limit:
        raw === undefined ? V1_DEFAULT_LIMIT : Math.min(Math.max(phpInt(raw), 1), V1_MAX_LIMIT),
      cursor,
    };
  });
export type V1ListQuery = z.infer<typeof v1ListQuerySchema>;

/** Scope names a key may carry; an empty list is full access (TW-API-008). `<resource>:read` and `<resource>:write`. */
export const API_SCOPE_RESOURCES = [
  'account',
  'contacts',
  'contact-groups',
  'deals',
  'companies',
  'flows',
  'templates',
  'auto-replies',
  'broadcasts',
  'campaigns',
  'scheduled',
  'messages',
  'media',
  'conversations',
  'devices',
  'webhooks',
] as const;
export type ApiScopeResource = (typeof API_SCOPE_RESOURCES)[number];
export type ApiScope = `${ApiScopeResource}:${'read' | 'write'}`;

/** Every scope a key may carry, resource by resource, `read` before `write`. The console's scope picker lists them in this order. */
export const API_SCOPES = API_SCOPE_RESOURCES.flatMap((resource) => [
  `${resource}:read`,
  `${resource}:write`,
]) as [ApiScope, ...ApiScope[]];
export const apiScopeSchema = z.enum(API_SCOPES);
