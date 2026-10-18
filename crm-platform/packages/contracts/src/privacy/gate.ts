import { z } from 'zod';
import { consentModalitySchema } from '../contact-consent/vocabulary';
import { purposeInputSchema } from './purposes';

/** What the ConsentGate answers. */
export const CONSENT_GATE_DECISIONS = ['allow', 'deny', 'needs_notice'] as const;
export type ConsentGateDecision = (typeof CONSENT_GATE_DECISIONS)[number];

/**
 * The CLOSED set of reasons. Reports, skip counters and the UI explain every decision from this list; a new reason is a reviewed
 * change here, never a free string at a call site.
 */
export const CONSENT_GATE_REASONS = [
  // allow
  /** Marketing, the workspace switch is off and the contact has not withdrawn: today's behaviour. */
  'policy_off',
  /** The switch is on and a recorded grant exists for this channel. */
  'granted',
  /** A service or utility message: not blocked by marketing consent; only an explicit withdrawal of that purpose blocks it. */
  'utility_exempt',
  /** A reply inside the customer-service window to a message that contact sent: service, not marketing. */
  'inbound_reply_window',
  /** The purpose needs no recorded grant by registry or policy (contract, legitimate interest). */
  'no_grant_required_by_policy',
  /** The gate could not decide (a database error) and the purpose is a service one: fail open. */
  'gate_unavailable_open',
  /** A notice-first purpose (an AI disclosure) whose versioned notice was delivered and that needs no grant. */
  'notice_delivered',
  /** A consent-based notice-first purpose (a call recording): the notice was delivered and the person's grant is on the record. */
  'consent_evidence_recorded',
  // deny
  /** The contact withdrew (STOP, unsubscribe link, manual) for this purpose. */
  'withdrawn',
  /** The switch is on and nobody recorded a grant. */
  'no_consent_recorded',
  /** The switch is on, so a recorded grant is needed, but the channel has no consent mapping to record one on. */
  'channel_unmapped',
  /** The gate could not decide and the purpose is marketing or consent-based: fail closed. */
  'gate_unavailable_closed',
  /** The purpose does not apply to this channel or modality. */
  'purpose_not_applicable',
  /** The workspace has not switched the purpose on (call recording is off until a workspace turns it on, decision D7). */
  'purpose_not_enabled',
  /** The notice was delivered and the person declined. */
  'consent_declined',
  /**
   * Marketing to a contact flagged as a minor, held by the workspace's children setting (Compliance center): "no minors" holds it, and
   * "minors may be included" holds it until a parent's or guardian's consent is on record (BL-180).
   */
  'subject_minor',
  /** The contact opted out of the sale or sharing of their personal information (CCPA / CPRA, or the Global Privacy Control signal). */
  'sale_share_opted_out',
  /**
   * Marketing by voice or SMS to a number on the workspace's Do-Not-Call list (BL-181). Checked after a withdrawal and before the minor
   * hold; WhatsApp, email and service messages are never held by it.
   */
  'on_dnc_list',
  /**
   * The contact's data is under a legal hold (BL-295): marketing, AI processing, profiling and third-party sharing are refused while the
   * record is kept and locked. The shown text is neutral ("processing of this contact is restricted"): it never mentions a hold or a matter.
   */
  'legal_hold',
  // needs_notice
  /** The purpose needs its versioned notice delivered first (a recording announcement, an AI disclosure). */
  'notice_required',
] as const;
export type ConsentGateReason = (typeof CONSENT_GATE_REASONS)[number];

/** The subject kinds a caller can name today. A visitor has no ledger row (anonymous). */
export type ConsentSubject =
  | { type: 'contact'; id: number }
  | { type: 'contact_uuid'; uuid: string }
  | { type: 'phone'; phone: string }
  | { type: 'email'; email: string }
  | { type: 'anonymous' };

/**
 * What the caller already holds for a purpose with a notice to deliver first. Without it the gate answers `needs_notice`. `consent`
 * is the person's answer to a consent-based purpose (a call recording); `delivered` is true only when the versioned notice was
 * presented and its version is on the record.
 */
export interface ConsentNoticeEvidence {
  delivered: boolean;
  consent?: 'granted' | 'declined';
}

export interface ConsentGateResult {
  decision: ConsentGateDecision;
  reason: ConsentGateReason;
  /** For `needs_notice`: the locale key of the versioned notice the caller must deliver first. */
  noticeKey?: string;
}

/** The request a check is made with (documentation and the arch tests; the callers use the service directly). */
export const consentGateRequestSchema = z.object({
  channel: z.string().min(1).max(40),
  purpose: purposeInputSchema,
  modality: consentModalitySchema.optional(),
});
export type ConsentGateRequest = z.infer<typeof consentGateRequestSchema>;

/** Localised key of a decision reason (namespace `contact-consent`). */
export const gateReasonKey = (reason: ConsentGateReason): string => `gate.reasons.${reason}`;
