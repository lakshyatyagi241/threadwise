import { z } from 'zod';
import {
  CONSENT_CHANNELS,
  CONSENT_EVIDENCE_KEYS,
  type ConsentChannel,
  type ConsentModality,
  type ConsentPurpose,
} from '../contact-consent/vocabulary';

/**
 * The purpose and processing registry (spec docs/specs/privacy-and-data-governance.md section 4.1, backlog BL-140): one typed,
 * code-defined entry per reason the platform processes a person's data or contacts them. Every path that sends, calls or processes
 * asks the ConsentGate with one of these ids, so a new feature must pick a registered purpose (or add one in review).
 *
 * The ledger still STORES `marketing` and `utility` (`ledgerPurpose`); the registry ids are the vocabulary of the gate and the API.
 * The two stored values stay valid ids everywhere (`resolvePurposeId`).
 */
export const PURPOSE_IDS = [
  'marketing_messaging',
  'service_messaging',
  'call_recording',
  'voice_ai_conversation',
  'ai_content_processing',
  'analytics_profiling',
  'third_party_sharing',
  'push_notifications',
  'cookies_analytics',
  'staff_ai_assist',
] as const;
export type PurposeId = (typeof PURPOSE_IDS)[number];

/** The ids a caller may pass: the registry ids and the two older ledger values. */
export const PURPOSE_INPUTS = [...PURPOSE_IDS, 'marketing', 'utility'] as const;
export type PurposeInput = (typeof PURPOSE_INPUTS)[number];
export const purposeInputSchema = z.enum(PURPOSE_INPUTS);

/** `marketing` and `utility` (the ledger values) are the registry ids `marketing_messaging` and `service_messaging`. */
export function resolvePurposeId(input: PurposeInput): PurposeId {
  if (input === 'marketing') return 'marketing_messaging';
  if (input === 'utility') return 'service_messaging';
  return input;
}

export const LAWFUL_BASES = [
  'consent',
  'contract',
  'legitimate_interest',
  'legal_obligation',
] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export type ConsentEvidenceKeyName = (typeof CONSENT_EVIDENCE_KEYS)[number];

export interface RetentionRule {
  /** What is kept (`consent_events`, `recordings`, `transcripts`, ...). */
  dataClass: string;
  /** Days to keep it by default; null = kept until erased or the workspace's own policy says otherwise. */
  days: number | null;
}

export interface PurposeDefinition {
  id: PurposeId;
  /** The default basis; a workspace may be stricter, never looser. */
  lawfulBasis: LawfulBasis;
  /**
   * True when the purpose needs a recorded opt-in by default (the regime hint can only make this stricter). `marketing_messaging` is
   * mandatory in the registry but ENFORCED as a grant only when the workspace switch "require consent for marketing" is on, so
   * today's behaviour (withdrawn contacts skipped, everyone else allowed) is the default.
   */
  consentMandatory: boolean;
  /** The ledger purpose that stores this purpose's events; null = no ledger rows yet (the generalised ledger is a later migration). */
  ledgerPurpose: ConsentPurpose | null;
  modalities: readonly ConsentModality[];
  /** Consent channels it applies to; `*` = all of them. */
  channels: readonly ConsentChannel[] | '*';
  defaultRetention: readonly RetentionRule[];
  /** Evidence keys the ledger should store with a grant. */
  evidenceRequired: readonly ConsentEvidenceKeyName[];
  /** The notice shown or spoken (versioned in the locale files); null = no notice. */
  noticeKey: string | null;
  /** The notice must be delivered before the processing starts (the gate answers `needs_notice`). */
  noticeRequired: boolean;
  /** Locale keys (namespace `contact-consent`) for the name and the one-line explanation. */
  labelKey: string;
  descriptionKey: string;
}

const TEXT_AND_EMAIL: readonly ConsentModality[] = ['text', 'email'];

const def = (d: Omit<PurposeDefinition, 'labelKey' | 'descriptionKey'>): PurposeDefinition => ({
  ...d,
  labelKey: `purposes.${d.id}.label`,
  descriptionKey: `purposes.${d.id}.description`,
});

export const PURPOSE_REGISTRY: Readonly<Record<PurposeId, PurposeDefinition>> = {
  marketing_messaging: def({
    id: 'marketing_messaging',
    lawfulBasis: 'consent',
    consentMandatory: true,
    ledgerPurpose: 'marketing',
    modalities: ['text', 'email', 'voice'],
    channels: '*',
    defaultRetention: [{ dataClass: 'consent_events', days: null }],
    evidenceRequired: ['consentText', 'consentVersion', 'consentHash'],
    noticeKey: 'notices.marketing_messaging',
    noticeRequired: false,
  }),
  service_messaging: def({
    id: 'service_messaging',
    lawfulBasis: 'contract',
    consentMandatory: false,
    ledgerPurpose: 'utility',
    modalities: [...TEXT_AND_EMAIL, 'voice'],
    channels: '*',
    defaultRetention: [{ dataClass: 'messages', days: null }],
    evidenceRequired: [],
    noticeKey: null,
    noticeRequired: false,
  }),
  call_recording: def({
    id: 'call_recording',
    lawfulBasis: 'consent',
    consentMandatory: true,
    ledgerPurpose: null,
    modalities: ['voice', 'video'],
    channels: ['voice', 'whatsapp'],
    defaultRetention: [
      { dataClass: 'recordings', days: 90 },
      { dataClass: 'transcripts', days: 90 },
    ],
    evidenceRequired: ['consentText', 'consentVersion', 'messageId'],
    noticeKey: 'notices.call_recording',
    noticeRequired: true,
  }),
  voice_ai_conversation: def({
    id: 'voice_ai_conversation',
    lawfulBasis: 'legitimate_interest',
    consentMandatory: false,
    ledgerPurpose: null,
    modalities: ['voice'],
    channels: ['voice', 'whatsapp'],
    defaultRetention: [{ dataClass: 'transcripts', days: 90 }],
    evidenceRequired: ['consentVersion', 'consentHash'],
    noticeKey: 'notices.voice_ai_conversation',
    noticeRequired: true,
  }),
  ai_content_processing: def({
    id: 'ai_content_processing',
    lawfulBasis: 'legitimate_interest',
    consentMandatory: false,
    ledgerPurpose: null,
    modalities: ['text', 'email', 'voice'],
    channels: '*',
    defaultRetention: [{ dataClass: 'ai_requests', days: 30 }],
    evidenceRequired: [],
    noticeKey: 'notices.ai_content_processing',
    noticeRequired: false,
  }),
  analytics_profiling: def({
    id: 'analytics_profiling',
    lawfulBasis: 'legitimate_interest',
    consentMandatory: false,
    ledgerPurpose: null,
    modalities: TEXT_AND_EMAIL,
    channels: '*',
    defaultRetention: [{ dataClass: 'analytics_events', days: 395 }],
    evidenceRequired: [],
    noticeKey: null,
    noticeRequired: false,
  }),
  third_party_sharing: def({
    id: 'third_party_sharing',
    lawfulBasis: 'consent',
    consentMandatory: true,
    ledgerPurpose: null,
    modalities: ['text', 'email', 'voice', 'video'],
    channels: '*',
    defaultRetention: [{ dataClass: 'shared_payloads', days: 30 }],
    evidenceRequired: ['consentText', 'consentVersion'],
    noticeKey: 'notices.third_party_sharing',
    noticeRequired: false,
  }),
  push_notifications: def({
    id: 'push_notifications',
    lawfulBasis: 'consent',
    consentMandatory: false,
    ledgerPurpose: null,
    modalities: ['text'],
    // Staff-facing browser push: the user's own browser permission is the consent; no contact channel carries it.
    channels: [],
    defaultRetention: [{ dataClass: 'push_subscriptions', days: null }],
    evidenceRequired: [],
    noticeKey: null,
    noticeRequired: false,
  }),
  cookies_analytics: def({
    id: 'cookies_analytics',
    lawfulBasis: 'consent',
    consentMandatory: true,
    ledgerPurpose: null,
    modalities: ['text'],
    channels: ['webchat'],
    defaultRetention: [{ dataClass: 'visitor_identifiers', days: 395 }],
    evidenceRequired: ['consentVersion', 'consentHash'],
    noticeKey: 'notices.cookies_analytics',
    noticeRequired: false,
  }),
  staff_ai_assist: def({
    id: 'staff_ai_assist',
    lawfulBasis: 'legitimate_interest',
    consentMandatory: false,
    ledgerPurpose: null,
    modalities: ['text'],
    channels: '*',
    defaultRetention: [{ dataClass: 'ai_requests', days: 30 }],
    evidenceRequired: [],
    noticeKey: 'notices.staff_ai_assist',
    noticeRequired: false,
  }),
};

/** The registry as a list, in a stable order. */
export const PURPOSES: readonly PurposeDefinition[] = PURPOSE_IDS.map((id) => PURPOSE_REGISTRY[id]);

export function purposeOf(input: PurposeInput): PurposeDefinition {
  return PURPOSE_REGISTRY[resolvePurposeId(input)];
}

/** Does the purpose apply to this channel and modality? */
export function purposeAppliesTo(
  purpose: PurposeDefinition,
  channel: ConsentChannel,
  modality: ConsentModality,
): boolean {
  const onChannel = purpose.channels === '*' || purpose.channels.includes(channel);
  return onChannel && purpose.modalities.includes(modality);
}

/**
 * Boot validation: ids equal to their key, every channel known, a notice flagged required has a key. Throws on a broken registry, so a
 * bad edit fails the first test and the first boot, never a send.
 */
export function validatePurposeRegistry(
  registry: Readonly<Record<string, PurposeDefinition>> = PURPOSE_REGISTRY,
): void {
  const known = new Set<string>(CONSENT_CHANNELS);
  for (const [key, p] of Object.entries(registry)) {
    if (p.id !== key) throw new Error(`purpose registry: key ${key} holds ${p.id}`);
    if (p.modalities.length === 0) throw new Error(`purpose ${key}: no modality`);
    if (p.channels !== '*') {
      for (const c of p.channels) {
        if (!known.has(c)) throw new Error(`purpose ${key}: unknown channel ${c}`);
      }
    }
    if (p.noticeRequired && !p.noticeKey) {
      throw new Error(`purpose ${key}: notice required but no key`);
    }
    if (p.lawfulBasis === 'consent' && p.consentMandatory && p.evidenceRequired.length === 0) {
      throw new Error(`purpose ${key}: consent is mandatory but no evidence is defined`);
    }
  }
}

/** One entry of `GET /v2/consent/purposes`: the definition plus whether this workspace enforces it as a grant today. */
export interface PurposeCatalogEntry extends PurposeDefinition {
  /** True when the gate refuses a send for lack of a recorded grant in this workspace right now. */
  enforcedAsGrant: boolean;
}

export interface PurposeCatalog {
  purposes: PurposeCatalogEntry[];
  /** The workspace switch "Require recorded consent for marketing sends". */
  requireConsentForMarketing: boolean;
}
