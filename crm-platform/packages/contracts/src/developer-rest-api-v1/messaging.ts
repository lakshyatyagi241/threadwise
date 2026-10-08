/**
 * developer-rest-api-v1 (API), group `messaging`: sending one message, the message history, media upload, conversations and devices
 * (WD-API-110 to 120). Field names are WaDesk's snake_case; ids are uuids; every timestamp is ISO-8601 in UTC (WaDesk answered two
 * different forms depending on the endpoint).
 */
import { z } from 'zod';

// --- vocabulary ---------------------------------------------------------------------------------------------------------------------

/** `type` of a send. */
export const V1_SEND_TYPES = ['text', 'image', 'video', 'document', 'audio', 'location'] as const;
export type V1SendType = (typeof V1_SEND_TYPES)[number];

/** The kinds that carry a file: they need `media` or `media_url`. */
export const V1_MEDIA_SEND_TYPES = ['image', 'video', 'document', 'audio'] as const;

/**
 * What a client can read in `status` (WD-API-120). WaDesk's `pending` is our `queued`; `received` is an inbound message, which the message
 * history lists as well; `scheduled` is WaDesk's and cannot happen here (v1 never schedules).
 */
export const V1_MESSAGE_STATUSES = [
  'pending',
  'scheduled',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
] as const;
export type V1MessageStatus = (typeof V1_MESSAGE_STATUSES)[number];

/** What a send is refused with when the whole request is understood but cannot go out: `error.code = send_failed`, `error.message` is one of these. */
export const V1_SEND_FAILURES = [
  'empty_message',
  'invalid_media',
  'media_fetch_failed',
  'wrong_channel',
  'out_of_credits',
  'no_connected_device',
  'service_window_closed',
  'channel_disconnected',
  'channel_capability_unsupported',
  'send_blocked',
] as const;
export type V1SendFailure = (typeof V1_SEND_FAILURES)[number];

export const V1_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export const V1_TEXT_MAX = 4096;
export const V1_TO_MAX = 32;
/** WaDesk allowed 40: its ids were short numbers. A uuid is 36 characters, so `<engine>:<uuid>` needs more room. */
export const V1_DEVICE_ID_MAX = 64;
export const V1_MEDIA_URL_MAX = 2048;

// --- request: POST /messages --------------------------------------------------------------------------------------------------------

/** Laravel's middleware trimmed every string and turned an empty one into null before validation; clients rely on `""` meaning "not sent". */
const blankToNull = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? null : t;
};

const optionalString = (max: number, field: string) =>
  z.preprocess(
    blankToNull,
    z
      .string({ invalid_type_error: `The ${field} field must be a string.` })
      .max(max, `The ${field} field must not be greater than ${max} characters.`)
      .nullable()
      .optional(),
  );

/** A coordinate arrives as a JSON number or, in a multipart form, as a numeric string. */
const coordinate = (field: string, limit: number) =>
  z.preprocess(
    (v) => {
      const b = blankToNull(v);
      if (typeof b === 'string' && b !== '' && Number.isFinite(Number(b))) return Number(b);
      return b;
    },
    z
      .number({ invalid_type_error: `The ${field} field must be a number.` })
      .min(-limit, `The ${field} field must be between -${limit} and ${limit}.`)
      .max(limit, `The ${field} field must be between -${limit} and ${limit}.`)
      .nullable()
      .optional(),
  );

export const v1SendMessageSchema = z.object({
  to: z.preprocess(
    blankToNull,
    z
      .string({
        required_error: 'The to field is required.',
        invalid_type_error: 'The to field must be a string.',
      })
      .max(V1_TO_MAX, `The to field must not be greater than ${V1_TO_MAX} characters.`),
  ),
  /** A number is accepted and read as text. */
  device_id: z.preprocess(
    (v) => blankToNull(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v),
    z
      .string()
      .max(
        V1_DEVICE_ID_MAX,
        `The device id field must not be greater than ${V1_DEVICE_ID_MAX} characters.`,
      )
      .nullable()
      .optional(),
  ),
  type: z.preprocess(
    blankToNull,
    z
      .enum(V1_SEND_TYPES, { errorMap: () => ({ message: 'The selected type is invalid.' }) })
      .nullable()
      .optional(),
  ),
  text: optionalString(V1_TEXT_MAX, 'text'),
  media_url: z.preprocess(
    blankToNull,
    z
      .string({ invalid_type_error: 'The media url field must be a valid URL.' })
      .url('The media url field must be a valid URL.')
      .max(
        V1_MEDIA_URL_MAX,
        `The media url field must not be greater than ${V1_MEDIA_URL_MAX} characters.`,
      )
      .nullable()
      .optional(),
  ),
  latitude: coordinate('latitude', 90),
  longitude: coordinate('longitude', 180),
});
export type V1SendMessageInput = z.infer<typeof v1SendMessageSchema>;

// --- the message (WD-API-120) -------------------------------------------------------------------------------------------------------

export const v1MessageSchema = z.object({
  id: z.string().uuid(),
  /** The recipient's number as digits; for an inbound message the business number. A send answers the string exactly as it was sent. */
  to: z.string().nullable(),
  /** `text`, `image`, `video`, `document`, `audio`, `location` or another stored kind (`sticker`, `voice`, `contact`). */
  type: z.string(),
  status: z.enum(V1_MESSAGE_STATUSES),
  failure_reason: z.string().nullable(),
  /** The provider's typed code (Meta: 131047) as a number, a platform code (`AUTH_SEND_HALTED`) as text; null when there is none. */
  error_code: z.union([z.number().int(), z.string()]).nullable(),
  body: z.string().nullable(),
  /** The stored file, fetched with the same key (`GET /media/...`); null when the message has no file. */
  media_url: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type V1Message = z.infer<typeof v1MessageSchema>;

// --- lists --------------------------------------------------------------------------------------------------------------------------

/**
 * WaDesk clamped a bad `limit` instead of refusing it (`limit=abc` is 1, `limit=500` is the maximum), so a list here does too. `per_page` is
 * the alias the paged endpoints used; `page` is refused with a message that names the cursor.
 */
export function v1ClampedListQuery(opts: { defaultLimit: number; maxLimit: number }) {
  return z
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
      const raw = limit ?? per_page;
      const parsed =
        raw === undefined
          ? opts.defaultLimit
          : Number.parseInt(String(Array.isArray(raw) ? NaN : raw), 10);
      const int = Number.isNaN(parsed) ? 0 : parsed;
      return { limit: Math.min(Math.max(int, 1), opts.maxLimit), cursor };
    });
}

export const V1_MESSAGES_DEFAULT_LIMIT = 50;
export const V1_MESSAGES_MAX_LIMIT = 200;
export const v1ListMessagesQuerySchema = v1ClampedListQuery({
  defaultLimit: V1_MESSAGES_DEFAULT_LIMIT,
  maxLimit: V1_MESSAGES_MAX_LIMIT,
});
export type V1ListMessagesQuery = z.infer<typeof v1ListMessagesQuerySchema>;

export const V1_CONVERSATIONS_DEFAULT_LIMIT = 25;
export const V1_CONVERSATIONS_MAX_LIMIT = 100;
export const v1ListConversationsQuerySchema = v1ClampedListQuery({
  defaultLimit: V1_CONVERSATIONS_DEFAULT_LIMIT,
  maxLimit: V1_CONVERSATIONS_MAX_LIMIT,
});
export type V1ListConversationsQuery = z.infer<typeof v1ListConversationsQuerySchema>;

// --- conversations (WD-API-114) -----------------------------------------------------------------------------------------------------

export const V1_CHANNEL_CODES = { whatsapp_qr: 'W', whatsapp_cloud: 'WB' } as const;

export const v1ConversationSchema = z.object({
  id: z.string().uuid(),
  /** Digits of the peer's number (`null` when there are none). */
  contact: z.string().nullable(),
  name: z.string().nullable(),
  last_message: z.string().nullable(),
  last_message_at: z.string().datetime().nullable(),
  unread: z.number().int().nonnegative(),
  /** The send state of the thread: `pending`, `sent` or `failed` (WaDesk's queue status, not the inbox's open/resolved). */
  status: z.string(),
  /** WaDesk's engine code: `W` unofficial WhatsApp, `WB` WhatsApp Cloud; any other channel is its kind (`telegram`, `instagram`). */
  channel: z.string(),
});
export type V1Conversation = z.infer<typeof v1ConversationSchema>;

// --- devices (WD-API-116, 117) ------------------------------------------------------------------------------------------------------

export const V1_DEVICE_ENGINES = ['unofficial', 'whatsapp_cloud', 'twilio', 'unknown'] as const;

export const v1DeviceSchema = z.object({
  /** The device's uuid (unofficial number) or the connection's uuid (Cloud API, Twilio): either is a valid `device_id` of a send. */
  id: z.string().uuid(),
  name: z.string(),
  /** Digits; empty text for an unofficial number without one, null for a connection without one (WaDesk). */
  phone: z.string().nullable(),
  engine: z.enum(V1_DEVICE_ENGINES),
  /** Unofficial numbers: `connected`, `disconnected`, `needs_pair`, `failed`. Connections: `connected` or `disconnected`. */
  status: z.string(),
  active: z.boolean(),
  last_seen_at: z.string().datetime().nullable(),
});
export type V1Device = z.infer<typeof v1DeviceSchema>;

// --- media (WD-API-113) -------------------------------------------------------------------------------------------------------------

export const v1MediaUploadSchema = z.object({
  /** Where this file is read (`GET /media/<token>`), with the same key; it works for minutes and is minted again by each read of a message. */
  url: z.string(),
  path: z.string(),
  type: z.enum(['image', 'video', 'audio', 'document']),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});
export type V1MediaUpload = z.infer<typeof v1MediaUploadSchema>;
