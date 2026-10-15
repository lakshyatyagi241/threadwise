import { z } from 'zod';
import type { ContactPrivacy } from './privacy';

/** Channels a consent is recorded for. WhatsApp Cloud and the QR number are one phone, so one consent: `whatsapp`. */
export const CONSENT_CHANNELS = [
  'whatsapp',
  'sms',
  'telegram',
  'email',
  'facebook',
  'instagram',
  'webchat',
  'line',
  'viber',
  'wechat',
  // Added with the purpose registry (BL-140): a voice call and RCS are consent channels too. The ledger column is free text with a
  // pattern check, so older rows and the older API calls are unaffected.
  'voice',
  'rcs',
] as const;
export const consentChannelSchema = z.enum(CONSENT_CHANNELS);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

/**
 * The two purposes the ledger STORES. `marketing` and `utility` stay the stored values; the purpose registry
 * (`privacy/purposes.ts`) maps every registry id onto one of them (`marketing_messaging` -> `marketing`, `service_messaging` ->
 * `utility`) and the ConsentGate enforces both.
 */
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
  // Intake sources (BL-167, migration 20261203090000): the agreement was given on the website chat widget, on a booking page, or at a
  // store checkout (Shopify / WooCommerce marketing consent).
  'widget',
  'booking',
  'commerce',
  // Lead capture (BL-168, migration 20261205090000): the agreement was given on a lead form or ad that a connector or the generic lead
  // webhook delivered, and the sender passed the proof (wording, version, time, form or ad) along with the lead.
  'lead',
] as const;
export const consentSourceSchema = z.enum(CONSENT_SOURCES);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

/** How a message or call reaches the person. A channel has a default modality (`modalityOfChannel`). */
export const CONSENT_MODALITIES = ['text', 'voice', 'video', 'email'] as const;
export const consentModalitySchema = z.enum(CONSENT_MODALITIES);
export type ConsentModality = z.infer<typeof consentModalitySchema>;

/** The default modality of a consent channel. */
export function modalityOfChannel(channel: ConsentChannel): ConsentModality {
  if (channel === 'voice') return 'voice';
  if (channel === 'email') return 'email';
  return 'text';
}

/**
 * Who the consent is about. The ledger today holds `contact` rows; the other subject types are the vocabulary the generalised model
 * (spec privacy-and-data-governance section 4.2) will store once its migration is built. A visitor or an unknown caller is identified
 * by a keyed hash, never raw.
 */
export const CONSENT_SUBJECT_TYPES = [
  'contact',
  'lead',
  'visitor',
  'call_participant',
  'staff',
] as const;
export const consentSubjectTypeSchema = z.enum(CONSENT_SUBJECT_TYPES);
export type ConsentSubjectType = z.infer<typeof consentSubjectTypeSchema>;

/**
 * A regime hint selects defaults (opt in versus opt out, quiet hours, calling windows); it never lowers what the platform requires.
 * Vocabulary only for now: nothing reads it yet.
 */
export const CONSENT_REGIMES = [
  'gdpr',
  'eprivacy',
  'tcpa_ctia',
  'trai_dlt',
  'dpdp',
  'uae_pdpl',
  'ksa_pdpl',
  'wa_business',
  'none',
] as const;
export const consentRegimeSchema = z.enum(CONSENT_REGIMES);
export type ConsentRegime = z.infer<typeof consentRegimeSchema>;

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
    case 'line':
    case 'viber':
    case 'wechat':
    case 'sms':
    case 'rcs':
    case 'voice':
      return kind;
    case 'call':
    case 'calling':
      return 'voice';
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
  /** The minor and Do Not Sell or Share flags of the contact (BL-180). */
  privacy: ContactPrivacy;
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
  // Intake evidence (BL-167): the version and address of the notice the person saw, and where they agreed.
  'noticeVersion',
  'noticeUrl',
  'widgetId',
  'bookingTypeId',
  'integrationId',
  'storeFlag',
  // Lead capture evidence (BL-168): the lead source (our uuid), the provider's own lead form and ad ids.
  'leadSourceId',
  'leadFormId',
  'adId',
  // Minors (BL-180): a REFERENCE to how a parent or guardian agreed (a signed form number, a document id). Evidence of the agreement
  // only: it never makes a marketing grant by itself and is never a name or free text about the guardian.
  'guardianConsentRef',
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
