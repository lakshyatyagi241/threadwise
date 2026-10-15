/**
 * calling-voice (CALL): WhatsApp Business Calling over the Cloud API: the calling switch per number, the customer's call permission,
 * placing and answering calls from the browser, and the record of every call. Everything here crosses the network between the API and
 * the screens. See docs/threadwise-port/inventory/calling-voice.md and docs/api/calling-voice.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export * from './errors';

// --- vocabulary --------------------------------------------------------------------------------------------------------

export const CALL_DIRECTIONS = ['USER_INITIATED', 'BUSINESS_INITIATED'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/** ringing, then connecting (an operator claimed it), active, then ended or failed. */
export const CALL_STATUSES = ['ringing', 'connecting', 'active', 'ended', 'failed'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_HANDLER_TYPES = ['operator', 'ai_agent', 'voicemail', 'none'] as const;
export type CallHandlerType = (typeof CALL_HANDLER_TYPES)[number];

/** What a customer decided about calls (and whether the grant is still alive). */
export const CALL_PERMISSION_STATUSES = ['granted', 'declined', 'expired'] as const;
export type CallPermissionStatus = (typeof CALL_PERMISSION_STATUSES)[number];

/** A grant with no expiry from Meta lasts this long (TW-CALL-006 rule 1). */
export const CALL_PERMISSION_DEFAULT_DAYS = 7;
/** A ringing call older than this is not offered any more (Meta rings for 30 to 60 seconds, TW-CALL-012). */
export const CALL_RING_WINDOW_MINUTES = 2;
/** Both ends of a WhatsApp call must hold an SDP at least this long (TW-CALL-008, 013). */
export const CALL_SDP_MIN_LENGTH = 50;
/** The largest operator recording accepted (TW-CALL-019). */
export const CALL_RECORDING_MAX_BYTES = 50 * 1024 * 1024;

// --- numbers and the calling switch ------------------------------------------------------------------------------------

export const callingNumberSchema = z.object({
  id: uuidSchema,
  phoneNumber: z.string().nullable(),
  displayLabel: z.string().nullable(),
  connectionStatus: z.string(),
  callingEnabled: z.boolean(),
  callingEnabledAt: z.string().nullable(),
});
export type CallingNumber = z.infer<typeof callingNumberSchema>;

export const callingNumberListSchema = z.object({ rows: z.array(callingNumberSchema) });
export type CallingNumberList = z.infer<typeof callingNumberListSchema>;

export const toggleCallingInputSchema = z.object({ enable: z.boolean() });
export type ToggleCallingInput = z.infer<typeof toggleCallingInputSchema>;

export const toggleCallingResultSchema = z.object({
  callingEnabled: z.boolean(),
  callingEnabledAt: z.string().nullable(),
});
export type ToggleCallingResult = z.infer<typeof toggleCallingResultSchema>;

// --- permission --------------------------------------------------------------------------------------------------------

export const requestPermissionInputSchema = z.object({
  numberId: uuidSchema,
  /** The customer's number; digits, with or without a plus. */
  to: z.string().trim().min(3).max(32),
  /** The question the customer sees. Default: "Can we give you a quick call?". */
  body: z.string().trim().max(160).optional(),
});
export type RequestPermissionInput = z.infer<typeof requestPermissionInputSchema>;

export const requestPermissionResultSchema = z.object({
  /** True when the customer had already allowed calls: no request was needed and the call can be placed. */
  alreadyPermitted: z.boolean(),
});
export type RequestPermissionResult = z.infer<typeof requestPermissionResultSchema>;

/** What the inbox needs to show and behave the Call button (TW-CALL-006). `usable` is worked out on the server. */
export const callEligibilitySchema = z.object({
  /** Calling is on for a WhatsApp number this conversation is on, and the customer has a phone number. */
  enabled: z.boolean(),
  /** The calling number to place the call from; null when there is none. */
  numberId: uuidSchema.nullable(),
  contactPhone: z.string().nullable(),
  permission: z.enum(CALL_PERMISSION_STATUSES).nullable(),
  /** A grant that has not run out: the call may be placed without asking. */
  usable: z.boolean(),
});
export type CallEligibility = z.infer<typeof callEligibilitySchema>;

export const callEligibilityQuerySchema = z.object({ conversationId: uuidSchema });
export type CallEligibilityQuery = z.infer<typeof callEligibilityQuerySchema>;

// --- placing and answering ---------------------------------------------------------------------------------------------

export const dialInputSchema = z.object({
  numberId: uuidSchema,
  to: z.string().trim().min(3).max(32),
  /** The browser's SDP offer: Opus only. */
  sdpOffer: z.string().min(CALL_SDP_MIN_LENGTH),
  contactId: uuidSchema.optional(),
  conversationId: uuidSchema.optional(),
});
export type DialInput = z.infer<typeof dialInputSchema>;

export const dialResultSchema = z.object({
  callId: uuidSchema,
  metaCallId: z.string().nullable(),
  correlation: z.string(),
});
export type DialResult = z.infer<typeof dialResultSchema>;

export const dialProgressSchema = z.object({
  status: z.enum(CALL_STATUSES),
  /** Meta's answer to the offer, once the customer picked up. */
  sdpAnswer: z.string().nullable(),
  ended: z.boolean(),
  endReason: z.string().nullable(),
});
export type DialProgress = z.infer<typeof dialProgressSchema>;

export const pendingCallSchema = z.object({
  id: uuidSchema,
  direction: z.enum(CALL_DIRECTIONS),
  fromPhone: z.string(),
  toPhone: z.string(),
  contactId: uuidSchema.nullable(),
  contactName: z.string().nullable(),
  startedAt: z.string().nullable(),
  metaCallId: z.string().nullable(),
  /** The customer's SDP offer, for the browser to answer. */
  sdpOffer: z.string().nullable(),
  /** An AI assistant is answering: the operator is not offered the call. */
  aiHandled: z.boolean(),
});
export type PendingCall = z.infer<typeof pendingCallSchema>;

export const pendingCallListSchema = z.object({ calls: z.array(pendingCallSchema) });
export type PendingCallList = z.infer<typeof pendingCallListSchema>;

export const acceptCallInputSchema = z.object({ sdpAnswer: z.string().min(CALL_SDP_MIN_LENGTH) });
export type AcceptCallInput = z.infer<typeof acceptCallInputSchema>;

export const rejectCallInputSchema = z.object({ reason: z.string().trim().max(64).optional() });
export type RejectCallInput = z.infer<typeof rejectCallInputSchema>;

export const recordingResultSchema = z.object({ url: z.string() });
export type RecordingResult = z.infer<typeof recordingResultSchema>;

// --- ICE servers (TW-CALL-009 rule 1) -------------------------------------------------------------------------------------------

/** One STUN or TURN server as the browser's peer connection takes it. */
export const iceServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

/** `GET /v2/calling/ice-servers`: the operator's list (TURN included); empty means the browser uses the four public STUN servers. */
export const iceServersResponseSchema = z.object({ servers: z.array(iceServerSchema) });
export type IceServersResponse = z.infer<typeof iceServersResponseSchema>;

export * from './logs';
export * from './recording';
export * from './readiness';
