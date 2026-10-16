import { z } from 'zod';
import { CONSENT_EVIDENCE_KEYS } from './vocabulary';

/**
 * Contact-level privacy flags (BL-180, spec docs/specs/privacy-and-data-governance.md section 11.9).
 *
 * Three facts about ONE contact that the consent ledger cannot hold (it stores a grant or a withdrawal per channel and purpose):
 *
 *  - `minor`              the contact is under the age of consent. Read by the ConsentGate (reason `subject_minor`) when the
 *                         workspace's children setting asks for it.
 *  - `guardian_consent`   a parent or guardian agreed for this minor. Evidence of that agreement only: it NEVER creates a marketing
 *                         grant (the ledger stays the only place a grant lives); it lifts the `subject_minor` hold where the
 *                         workspace allows minors at all.
 *  - `sale_share_opt_out` "Do Not Sell or Share My Personal Information" (CCPA / CPRA), set by a person, an API caller, the contact,
 *                         or the Global Privacy Control signal of the browser.
 *
 * Same pattern as the ledger: an append-only event per change (who, when, source, evidence) and the derived state, written in one
 * transaction.
 */
export const PRIVACY_FLAG_KINDS = ['minor', 'guardian_consent', 'sale_share_opt_out'] as const;
export const privacyFlagKindSchema = z.enum(PRIVACY_FLAG_KINDS);
export type PrivacyFlagKind = z.infer<typeof privacyFlagKindSchema>;

/**
 * Where a change came from. `gpc` is the browser signal (header `Sec-GPC: 1`) on a public form or the chat widget (the evidence names
 * which: `formId` / `widgetId`); a person or an API caller uses `manual` / `api`; `contact_request` is the person's own request
 * recorded by staff.
 */
export const PRIVACY_FLAG_SOURCES = ['manual', 'api', 'contact_request', 'gpc'] as const;
export const privacyFlagSourceSchema = z.enum(PRIVACY_FLAG_SOURCES);
export type PrivacyFlagSource = z.infer<typeof privacyFlagSourceSchema>;

/**
 * How the workspace's children setting (Compliance center) treats a contact flagged as a minor, for MARKETING only (service messages
 * are never held back by it):
 *  - `off`      the setting is not answered and no parental consent is required: the flag is recorded and shown, nothing is held.
 *  - `guardian` minors may be included, or parental consent is required: marketing is held until guardian consent is on record.
 *  - `block`    "we do not knowingly process minors": marketing to a flagged minor is held, guardian evidence does not lift it.
 */
export const MINOR_RULES = ['off', 'guardian', 'block'] as const;
export type MinorRule = (typeof MINOR_RULES)[number];

/** The pure mapping from the Compliance center's children settings to the rule the gate applies. */
export function minorRuleOf(
  childrenPolicy: 'unset' | 'no_minors' | 'may_include_minors',
  parentalConsentRequired: boolean,
): MinorRule {
  if (childrenPolicy === 'no_minors') return 'block';
  if (childrenPolicy === 'may_include_minors' || parentalConsentRequired) return 'guardian';
  return 'off';
}

/** What a person records: one flag turned on or off. */
export const recordPrivacyFlagSchema = z.object({
  kind: privacyFlagKindSchema,
  /** True: the flag is on (minor, guardian consent given, opted out of sale / sharing). False: it is cleared. */
  value: z.boolean(),
  source: z.enum(['manual', 'api', 'contact_request']).default('manual'),
  /** Why. Required when guardian consent is given (what the guardian said or signed, and where). */
  note: z.string().trim().max(500).optional(),
  /** Ids and references only (`guardianConsentRef`, `reference`, ...); never a name, an address or free text about the person. */
  evidence: z.record(z.enum(CONSENT_EVIDENCE_KEYS), z.string().max(300)).default({}),
  occurredAt: z.string().datetime().optional(),
});
export type RecordPrivacyFlagInput = z.infer<typeof recordPrivacyFlagSchema>;

export interface PrivacyFlagEvent {
  id: string;
  contactId: string | null;
  kind: PrivacyFlagKind;
  value: boolean;
  source: PrivacyFlagSource;
  evidence: Record<string, unknown>;
  actor: { id: string; name: string | null } | null;
  note: string | null;
  occurredAt: string;
  recordedAt: string;
}

/** The flags of one contact, the workspace facts the card needs to explain them, and the newest changes. */
export interface ContactPrivacy {
  isMinor: boolean;
  minorSince: string | null;
  minorSource: PrivacyFlagSource | null;
  guardianConsent: boolean;
  guardianSince: string | null;
  doNotSellShare: boolean;
  doNotSellShareSince: string | null;
  doNotSellShareSource: PrivacyFlagSource | null;
  /** The workspace has the `ccpa_us` profile switched on: the Do Not Sell or Share control is offered. */
  ccpaUs: boolean;
  /** What the workspace's children setting does with a flagged minor's marketing. */
  minorRule: MinorRule;
  events: PrivacyFlagEvent[];
}

export const NO_PRIVACY: ContactPrivacy = {
  isMinor: false,
  minorSince: null,
  minorSource: null,
  guardianConsent: false,
  guardianSince: null,
  doNotSellShare: false,
  doNotSellShareSince: null,
  doNotSellShareSource: null,
  ccpaUs: false,
  minorRule: 'off',
  events: [],
};
