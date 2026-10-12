import { z } from 'zod';

/** Channels a consent is recorded for. WhatsApp Cloud and the QR number are one phone, so one consent: `whatsapp`. */
export const CONSENT_CHANNELS = [
  'whatsapp',
  'sms',
  'telegram',
  'email',
  'facebook',
  'instagram',
  'webchat',
] as const;
export const consentChannelSchema = z.enum(CONSENT_CHANNELS);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

/** `utility` is reserved: recorded, never enforced. */
export const CONSENT_PURPOSES = ['marketing', 'utility'] as const;
export const consentPurposeSchema = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const CONSENT_ACTIONS = ['granted', 'withdrawn'] as const;
export const consentActionSchema = z.enum(CONSENT_ACTIONS);
export type ConsentAction = z.infer<typeof consentActionSchema>;

export const CONSENT_SOURCES = [
  'form',
  'keyword',
  'manual',
  'import',
  'api',
  'flow',
  'inbound_message',
  'contact_request',
  'legacy',
] as const;
export const consentSourceSchema = z.enum(CONSENT_SOURCES);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

/** The state of a contact for one channel and purpose. `unknown` = no event yet ("No consent recorded"). */
export const CONSENT_STATES = ['granted', 'withdrawn', 'unknown'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** A channel kind (`whatsapp_cloud`, `whatsapp_qr`, ...) to the channel consent is recorded on; null for kinds with no marketing. */
export function consentChannelOfKind(kind: string): ConsentChannel | null {
  switch (kind) {
    case 'whatsapp_cloud':
    case 'whatsapp_qr':
    case 'whatsapp':
      return 'whatsapp';
    case 'telegram':
    case 'email':
    case 'facebook':
    case 'instagram':
    case 'webchat':
    case 'sms':
      return kind;
    default:
      return null;
  }
}

/** One event as the ledger returns it. Evidence holds ids and hashes, never an IP or free personal text. */
export interface ConsentEvent {
  id: string;
  contactId: string | null;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  action: ConsentAction;
  source: ConsentSource;
  evidence: Record<string, unknown>;
  actor: { id: string; name: string | null } | null;
  note: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface ConsentStateRow {
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  state: ConsentState;
  since: string | null;
}

export interface ContactConsent {
  contactId: string;
  /** Roll-up the sending paths read: true when any marketing channel is withdrawn. */
  optedOut: boolean;
  states: ConsentStateRow[];
  events: ConsentEvent[];
}

/** Evidence keys a caller may supply, per source. Anything else is dropped; the values are short strings. */
export const CONSENT_EVIDENCE_KEYS = [
  'consentText',
  'consentVersion',
  'consentHash',
  'formId',
  'submissionId',
  'messageId',
  'keyword',
  'fileName',
  'apiKeyId',
  'flowId',
  'reference',
] as const;

export const recordConsentSchema = z.object({
  channel: consentChannelSchema.default('whatsapp'),
  purpose: consentPurposeSchema.default('marketing'),
  action: consentActionSchema,
  source: z.enum(['manual', 'api', 'contact_request']).default('manual'),
  /** Why: required for a grant (what the contact said or signed, where). */
  note: z.string().trim().max(500).optional(),
  evidence: z.record(z.enum(CONSENT_EVIDENCE_KEYS), z.string().max(300)).default({}),
  occurredAt: z.string().datetime().optional(),
});
export type RecordConsentInput = z.infer<typeof recordConsentSchema>;

export const consentEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  channel: consentChannelSchema.optional(),
  action: consentActionSchema.optional(),
  source: consentSourceSchema.optional(),
});
export type ConsentEventsQuery = z.infer<typeof consentEventsQuerySchema>;
