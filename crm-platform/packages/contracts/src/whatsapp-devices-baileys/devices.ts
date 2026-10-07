import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { PERSONAL_WA_NOTICE_ITEM_IDS } from './notice';

/**
 * Personal WhatsApp numbers (the unofficial engine's `devices`): docs/specs/personal-whatsapp-connect.md sections 8 to 10.
 * Every route first runs the engine gate (422 WA_UNOFFICIAL_DISABLED when the platform switch is off or the workspace is not allowed).
 * No schema here ever carries a proxy password, a session, or (outside the pairing read) a QR string or a pairing code.
 */

// --- state -----------------------------------------------------------------------------------------------------------------

/** `devices.connection_state` (spec 8.1). `banned` is deliberately not a state: the runtime cannot tell a ban from an unlink. */
export const DEVICE_CONNECTION_STATES = [
  'created',
  'awaiting_qr',
  'awaiting_pairing_code',
  'connecting',
  'connected',
  'disconnected',
  'logged_out',
  'error',
] as const;
export const deviceConnectionStateSchema = z.enum(DEVICE_CONNECTION_STATES);
export type DeviceConnectionState = z.infer<typeof deviceConnectionStateSchema>;

/** `devices.status`: what the senders and dashboards read. Kept unchanged beside the richer state. */
export const deviceStatusSchema = z.enum(['connected', 'disconnected', 'needs_pair']);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

/**
 * Why the state is what it is: a short code, never free text from the WhatsApp library (spec 8.1, 8.3). The web owns the words.
 * `forbidden` and `unlinked_on_phone` are both "WhatsApp ended the link"; we cannot tell a ban from an unlink.
 */
export const DEVICE_STATE_REASONS = [
  'user',
  'worker_silent',
  'session_incomplete',
  'unlinked_on_phone',
  'forbidden',
  'qr_timeout',
  'pair_failed',
  'code_failed',
  'mismatch',
  'proxy_unreachable',
  'session_conflict',
  'device_limit_reached',
  'worker_unavailable',
] as const;
export const deviceStateReasonSchema = z.enum(DEVICE_STATE_REASONS);
export type DeviceStateReason = z.infer<typeof deviceStateReasonSchema>;

/** The states from which a pairing may start without `relink` (spec 8.2). `disconnected` also needs fewer than 3 saved session rows. */
export const PAIRABLE_STATES: readonly DeviceConnectionState[] = [
  'created',
  'disconnected',
  'logged_out',
  'error',
];
/** A saved session of fewer rows than this was never finished (the runtime's own rule). */
export const HEALTHY_SESSION_ROWS = 3;

// --- limits ----------------------------------------------------------------------------------------------------------------

export const DEVICE_NAME_MIN = 2;
export const DEVICE_NAME_MAX = 191;
export const DEVICE_COUNTRY_CODE_MAX = 8;
export const DEVICE_PHONE_MIN = 5;
export const DEVICE_PHONE_MAX = 32;
export const DEVICE_REGION_MAX = 16;
/** A pairing code is requested for a number of at least this many digits (country code included). */
export const DEVICE_PAIRING_MIN_DIGITS = 8;

// --- reading ---------------------------------------------------------------------------------------------------------------

const personRef = z.object({ id: uuidSchema, name: z.string() });

export const personalDeviceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** `+` and the digits: country code plus number. */
  phone: z.string(),
  countryCode: z.string().nullable(),
  region: z.string().nullable(),
  connectionState: deviceConnectionStateSchema,
  stateReason: deviceStateReasonSchema.nullable(),
  stateChangedAt: z.string().datetime({ offset: true }).nullable(),
  /** The unchanged three-valued status. Branch screens on `connectionState`; this is for compatibility. */
  status: deviceStatusSchema,
  /** "Use for sending". */
  active: z.boolean(),
  activateAfterPairing: z.boolean(),
  lastSeenAt: z.string().datetime({ offset: true }).nullable(),
  assignee: personRef.nullable(),
  createdBy: personRef.nullable(),
  /** Never credentials. */
  proxy: z.object({
    enabled: z.boolean(),
    status: z.string().nullable(),
    egressIp: z.string().nullable(),
  }),
  sent24h: z.number().int(),
  failed24h: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
  rowVersion: z.number().int(),
});
export type PersonalDevice = z.infer<typeof personalDeviceSchema>;

/** `GET /v2/devices/:id`: the list row plus what the detail page adds. */
export const personalDeviceDetailSchema = personalDeviceSchema.extend({
  /** Set when the state is `error` or `logged_out`. */
  lastError: z
    .object({ reason: deviceStateReasonSchema, at: z.string().datetime({ offset: true }) })
    .nullable(),
  /** True once a warm-up profile exists for the number. */
  warmerConfigured: z.boolean(),
  /** True while a saved session exists (the number cannot be edited then). */
  hasSession: z.boolean(),
});
export type PersonalDeviceDetail = z.infer<typeof personalDeviceDetailSchema>;

export const listDevicesQuerySchema = z.object({
  /** One state (the tabs: Connected is `connected`; Disconnected also lists the others via `status`). */
  state: deviceConnectionStateSchema.optional(),
  status: deviceStatusSchema.optional(),
  /** Name or number, `ILIKE` on the plain columns. */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;

export const listDevicesMetaSchema = z.object({
  /** Personal numbers the workspace holds (every state). */
  used: z.number().int(),
  /** The cap that applies: the smaller of the plan's `devices` limit (0 = unlimited) and the pilot cap. */
  limit: z.number().int(),
  planLimit: z.number().int(),
  pilotCap: z.number().int(),
  /** The notice version in force, and whether the CALLER accepted it. */
  noticeVersion: z.string(),
  noticeAccepted: z.boolean(),
  /** Whether a worker is alive to answer pairing commands (the page's "connection service" line). */
  workerRunning: z.boolean(),
});
export type ListDevicesMeta = z.infer<typeof listDevicesMetaSchema>;

export const listDevicesResponseSchema = z.object({
  data: z.array(personalDeviceSchema),
  page: pageInfoSchema,
  meta: listDevicesMetaSchema,
});
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

// --- the risk notice -------------------------------------------------------------------------------------------------------

const noticeItems = z
  .array(z.literal(true))
  .length(PERSONAL_WA_NOTICE_ITEM_IDS.length, 'tick all three statements');

/** The locale the notice was shown in (recorded with the acknowledgement; the hash is always of the English text). */
export const noticeLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a locale such as en or ar');

export const acknowledgementInputSchema = z.object({
  /** Must equal the current version; an older one is refused with PERSONAL_WA_NOTICE_REQUIRED. */
  version: z.string().min(1).max(32),
  /** One `true` per statement, in order. */
  items: noticeItems,
  locale: noticeLocaleSchema.default('en'),
});
export type AcknowledgementInput = z.infer<typeof acknowledgementInputSchema>;

/** `GET /v2/devices/risk-notice`: the caller's own standing. The canonical text is `PERSONAL_WA_NOTICE_ITEMS` in this package. */
export const riskNoticeStatusSchema = z.object({
  version: z.string(),
  accepted: z.boolean(),
  acceptedAt: z.string().datetime({ offset: true }).nullable(),
});
export type RiskNoticeStatus = z.infer<typeof riskNoticeStatusSchema>;

// --- writing ---------------------------------------------------------------------------------------------------------------

export const createDeviceInputSchema = z.object({
  name: z.string().trim().min(DEVICE_NAME_MIN).max(DEVICE_NAME_MAX),
  /** `+91`, `91`: reduced to `+` and its digits. */
  countryCode: z.string().trim().min(1).max(DEVICE_COUNTRY_CODE_MAX),
  /** The local number; spaces, dashes and a repeated country code are tolerated (the API normalises as WaDesk does). */
  phone: z.string().trim().min(DEVICE_PHONE_MIN).max(DEVICE_PHONE_MAX),
  region: z.string().trim().max(DEVICE_REGION_MAX).optional(),
  /** A member of this workspace (uuid); defaults to the creator. */
  assigneeUserId: uuidSchema.optional(),
  activateAfterPairing: z.boolean().default(true),
  /** Only needed when the caller has not accepted the current version yet; records it in the same transaction as the device. */
  acknowledgement: acknowledgementInputSchema.optional(),
});
export type CreateDeviceInput = z.infer<typeof createDeviceInputSchema>;

export const updateDeviceInputSchema = z
  .object({
    name: z.string().trim().min(DEVICE_NAME_MIN).max(DEVICE_NAME_MAX).optional(),
    region: z.string().trim().max(DEVICE_REGION_MAX).nullable().optional(),
    assigneeUserId: uuidSchema.nullable().optional(),
    /** "Use for sending": does not touch the connection state. */
    active: z.boolean().optional(),
    /** The number: editable only while the state is created, error or logged_out and no session exists. */
    countryCode: z.string().trim().min(1).max(DEVICE_COUNTRY_CODE_MAX).optional(),
    phone: z.string().trim().min(DEVICE_PHONE_MIN).max(DEVICE_PHONE_MAX).optional(),
    rowVersion: z.number().int(),
  })
  .refine(
    (v) => Object.entries(v).some(([k, x]) => k !== 'rowVersion' && x !== undefined),
    'nothing to change',
  );
export type UpdateDeviceInput = z.infer<typeof updateDeviceInputSchema>;

// --- pairing ---------------------------------------------------------------------------------------------------------------

export const pairingMethodSchema = z.enum(['qr', 'code']);
export type PairingMethod = z.infer<typeof pairingMethodSchema>;

/** Body of `POST /v2/devices/:id/pairing/qr` and `.../pairing/code`. */
export const startPairingInputSchema = z.object({
  /** "Forget the saved session": required to pair a device that is linked or holds a healthy saved session. */
  relink: z.boolean().default(false),
  /** Only needed when the caller has not accepted the current version of the notice. */
  acknowledgement: acknowledgementInputSchema.optional(),
});
export type StartPairingInput = z.infer<typeof startPairingInputSchema>;

/**
 * One pairing attempt as the wizard reads it (start answer and the 2 s poll). This is the ONLY schema that carries a QR string
 * or a pairing code; the response is `Cache-Control: no-store` and never stored by the idempotency layer.
 */
export const devicePairingSchema = z.object({
  /** The attempt this answer belongs to (changes when a new attempt starts). */
  attempt: uuidSchema,
  method: pairingMethodSchema,
  state: deviceConnectionStateSchema,
  reason: deviceStateReasonSchema.nullable(),
  /** The runtime's last label (`Qr generated`, `Syncing data`, `Ready`): informational, never branch on it. */
  label: z.string().nullable(),
  /** 0 to 100 (WaDesk's progress strip). */
  progress: z.number().int().min(0).max(100),
  /** The QR string to draw client-side (it rotates about every 20 s); null when none is showing. */
  qr: z.string().nullable(),
  /** How old the QR is, so the client can run its countdown ring. */
  qrAgeMs: z.number().int().nullable(),
  /** `XXXXXXXX` as WhatsApp issues it (show as XXXX-XXXX); null when none is showing. */
  code: z.string().nullable(),
  codeExpiresIn: z.number().int().nullable(),
  startedAt: z.string().datetime({ offset: true }),
  /** After this the attempt is over (about 90 s for a QR, 3 minutes for a code). */
  deadlineAt: z.string().datetime({ offset: true }),
  /** Whether the attempt was started by the caller; another person's attempt is reported, not hidden. */
  startedByMe: z.boolean(),
});
export type DevicePairing = z.infer<typeof devicePairingSchema>;

/** `POST /v2/devices/:id/disconnect`. */
export const disconnectResultSchema = z.object({
  device: personalDeviceSchema,
  /** False when no worker answered: the saved session was removed here, but the phone may still list the link. */
  unlinked: z.boolean(),
});
export type DisconnectResult = z.infer<typeof disconnectResultSchema>;

/** `DELETE /v2/devices/:id`. */
export const deleteDeviceResultSchema = z.object({
  id: uuidSchema,
  deleted: z.literal(true),
  unlinked: z.boolean(),
});
export type DeleteDeviceResult = z.infer<typeof deleteDeviceResultSchema>;

/** `DELETE /v2/devices/:id/pairing`: whether an attempt was running and has been ended. */
export const cancelPairingResultSchema = z.object({ cancelled: z.boolean() });
export type CancelPairingResult = z.infer<typeof cancelPairingResultSchema>;
