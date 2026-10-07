/**
 * developer-rest-api-v1, automation group: message templates and flows as WaDesk's `/api/v1` shows them (WD-API-030 to 037, 044 to 047).
 * Field names are WaDesk's snake_case; ids are our uuids; timestamps are ISO-8601.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

// --- templates ---------------------------------------------------------------------------------------------------------------

/** WaDesk accepts a JSON string where an array is expected (form posts); a string that does not decode stays a string and fails the type. */
const jsonLike = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, inner);

/** A request field that Laravel's middleware turns from `""` into null. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const V1_TEMPLATE_TYPES = ['standard', 'carousel', 'media', 'auth'] as const;

/** One CTA button as WaDesk reads it; anything that is not an object is skipped later, not refused. */
const rawButtonsSchema = jsonLike(z.array(z.unknown()));
const rawQuickRepliesSchema = jsonLike(z.array(z.unknown()));

const coordinate = (min: number, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number({ invalid_type_error: 'Must be a number.' }).min(min).max(max).optional(),
  );

const templateFields = {
  template_name: z.string().trim().min(1, 'Required.').max(191),
  template_type: z.preprocess(blankToUndefined, z.enum(V1_TEMPLATE_TYPES).optional()),
  /** Meta numeric id 1/2/3, a Meta slug or an industry bucket: anything but blank is read, so no enum here. */
  category: z.union([z.string().trim().min(1, 'Required.'), z.number()]),
  header: z.preprocess(blankToUndefined, z.string().max(255).optional()),
  template_body: z.preprocess(blankToUndefined, z.string().max(4096).optional()),
  footer: z.preprocess(blankToUndefined, z.string().max(255).optional()),
  language: z.preprocess(blankToUndefined, z.string().max(16).optional()),
  buttons: z.preprocess(blankToUndefined, rawButtonsSchema.optional()),
  quick_replies: z.preprocess(blankToUndefined, rawQuickRepliesSchema.optional()),
  carousel_data: z.preprocess(blankToUndefined, jsonLike(z.unknown()).optional()),
  code_expiration_minutes: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(90).optional(),
  ),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  location_name: z.preprocess(blankToUndefined, z.string().max(191).optional()),
  location_address: z.preprocess(blankToUndefined, z.string().max(255).optional()),
};

const needsBothCoordinates = (
  v: { latitude?: number; longitude?: number },
  ctx: z.RefinementCtx,
) => {
  if (v.latitude !== undefined && v.longitude === undefined)
    ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'Required with latitude.' });
  if (v.longitude !== undefined && v.latitude === undefined)
    ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Required with longitude.' });
};

/**
 * `POST /templates`. QUIRK kept: `template_body` is required only when `template_type` is literally `standard`; with the type omitted the
 * server treats it as standard but stores an empty body.
 */
export const v1CreateTemplateSchema = z.object(templateFields).superRefine((v, ctx) => {
  needsBothCoordinates(v, ctx);
  if (v.template_type === 'standard' && v.template_body === undefined)
    ctx.addIssue({ code: 'custom', path: ['template_body'], message: 'Required.' });
});
export type V1CreateTemplate = z.infer<typeof v1CreateTemplateSchema>;

/** `PUT /templates/{id}`: the create rules, with the body always required. */
export const v1UpdateTemplateSchema = z.object(templateFields).superRefine((v, ctx) => {
  needsBothCoordinates(v, ctx);
  if (v.template_body === undefined)
    ctx.addIssue({ code: 'custom', path: ['template_body'], message: 'Required.' });
});
export type V1UpdateTemplate = z.infer<typeof v1UpdateTemplateSchema>;

/** The numeric ids WaDesk's `GET /templates/categories` lists, which `category` accepts on create and update. */
export const V1_TEMPLATE_CATEGORIES = [
  { id: 1, name: 'Marketing' },
  { id: 2, name: 'Authentication' },
  { id: 3, name: 'Utility' },
] as const;

export const v1TemplateButtonSchema = z.object({
  type: z.string(),
  text: z.string().nullable(),
  value: z.string().nullable(),
});

/** A template as a client sees it (WD-API-030). `header_location` and `carousel_data` are null until the template domain stores them. */
export const v1TemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: z.string(),
  category: z.string().nullable(),
  language: z.string(),
  header: z.string().nullable(),
  header_location: z
    .object({
      latitude: z.string(),
      longitude: z.string(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(z.record(z.unknown())),
  carousel_data: z.unknown().nullable(),
  attachment_type: z.enum(['image', 'video', 'audio', 'document', 'location']).nullable(),
  status: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type V1Template = z.infer<typeof v1TemplateSchema>;

/** A value of `body` in a template send, always text (WaDesk refuses numbers and booleans). */
const sendValue = z.string({ invalid_type_error: 'Must be a string.' }).max(1024);

/**
 * `POST /templates/{id}/send` (JSON or multipart). `body` is a list or a 1-indexed map; the map is sorted by number and re-indexed to a
 * list. Multipart bodies carry arrays as JSON text, so each structured field also decodes a JSON string.
 */
export const v1SendTemplateSchema = z.object({
  to: z.string().trim().min(1, 'Required.').max(32),
  body: z.preprocess(
    blankToUndefined,
    jsonLike(z.union([z.array(sendValue), z.record(sendValue)])).optional(),
  ),
  header_text: z.preprocess(blankToUndefined, z.string().max(1024).optional()),
  header_media_url: z.preprocess(blankToUndefined, z.string().url().max(2048).optional()),
  header_filename: z.preprocess(blankToUndefined, z.string().max(255).optional()),
  buttons: z.preprocess(
    blankToUndefined,
    jsonLike(
      z.array(
        z.object({
          index: z.coerce.number().int().min(0).default(0),
          sub_type: z.string().max(32).default('url'),
          value: z.string().max(2048).default(''),
        }),
      ),
    ).optional(),
  ),
});
export type V1SendTemplate = z.infer<typeof v1SendTemplateSchema>;

/** `POST /templates/{id}/send` answer. The send is queued (the dashboard's pipeline), so there is no provider message id yet. */
export const v1TemplateSendResultSchema = z.object({
  message_id: uuidSchema,
  wamid: z.string().nullable(),
  status: z.literal('queued'),
  template_id: uuidSchema,
  template_name: z.string(),
  to: z.string(),
});
export type V1TemplateSendResult = z.infer<typeof v1TemplateSendResultSchema>;

// --- flows -------------------------------------------------------------------------------------------------------------------

export const V1_FLOW_STATUSES = ['draft', 'live', 'paused'] as const;

export const v1FlowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  trigger: z.string().nullable(),
  status: z.enum(V1_FLOW_STATUSES),
  category: z.string().nullable(),
  subscribers_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type V1Flow = z.infer<typeof v1FlowSchema>;

/** `POST /flows/{id}/enroll`: `contact_id` (our uuid) or `phone`; the id wins when both are sent. */
export const v1EnrollSchema = z
  .object({
    contact_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
    phone: z.preprocess(blankToUndefined, z.string().trim().max(32).optional()),
  })
  .superRefine((v, ctx) => {
    if (!v.contact_id && !v.phone) {
      ctx.addIssue({ code: 'custom', path: ['contact_id'], message: 'Required without phone.' });
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Required without contact_id.' });
    }
  });
export type V1Enroll = z.infer<typeof v1EnrollSchema>;

export const v1EnrollResultSchema = z.object({
  flow_id: uuidSchema,
  contact_id: uuidSchema,
  subscriber_id: uuidSchema,
  status: z.enum(['active', 'paused', 'completed', 'failed']),
  enrolled_at: z.string().datetime().nullable(),
  failure_reason: z.string().nullable(),
});
export type V1EnrollResult = z.infer<typeof v1EnrollResultSchema>;

/** `GET /flows/{id}/subscribers`: `limit` is 1..200 here (WaDesk's own clamp), default 100, and `cursor` pages past it. */
export const v1SubscribersQuerySchema = z
  .object({
    limit: z.unknown().optional(),
    per_page: z.unknown().optional(),
    cursor: z.string().min(1).max(512).optional(),
    page: z.unknown().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.page !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['page'],
        message:
          'Page numbers are not supported. Pass the `cursor` from `meta.next_cursor` of the previous page.',
      });
  })
  .transform(({ limit, per_page, cursor }) => {
    const asked = [limit, per_page].find((v) => v !== undefined && v !== '');
    // WaDesk clamps rather than refuses: 500 becomes 200, 0 or text becomes 1.
    const n = asked === undefined ? 100 : Number(asked);
    const whole = Number.isFinite(n) ? Math.trunc(n) : 1;
    return { limit: Math.min(200, Math.max(1, whole)), cursor };
  });
export type V1SubscribersQuery = z.infer<typeof v1SubscribersQuerySchema>;

export const v1SubscriberSchema = z.object({
  id: uuidSchema,
  contact_id: uuidSchema,
  contact_name: z.string(),
  contact_phone: z.string(),
  status: z.enum(['active', 'paused', 'completed', 'failed']),
  enrolled_at: z.string().datetime().nullable(),
  failed_at: z.string().datetime().nullable(),
  failure_reason: z.string().nullable(),
});
export type V1Subscriber = z.infer<typeof v1SubscriberSchema>;
