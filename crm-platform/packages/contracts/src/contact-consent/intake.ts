import { z } from 'zod';

/**
 * Consent at intake (docs/specs/privacy-and-data-governance.md section 4.3.2).
 *
 * POLICY (owner-approved): a first inbound message permits replying only. It NEVER creates a marketing grant. A marketing grant is
 * written to the ledger only when the person actually agreed, with the source, the notice wording and version, and the time as
 * evidence. The ConsentGate stays the one enforcement point.
 *
 * A contact record can carry a subscription status per channel (`whatsappSubscriptionStatus` and the like). A status is a label, not
 * proof: setting one to `subscribed` writes a ledger grant (this block is its proof) or is refused. Nothing is granted silently.
 */

/** The channels a contact record carries a subscription status for, and a grant can be written for at intake. */
export const INTAKE_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export const intakeChannelSchema = z.enum(INTAKE_CHANNELS);
export type IntakeChannel = z.infer<typeof intakeChannelSchema>;

/** The status value that means "the person agreed to marketing on this channel". Compared trimmed and case-insensitive. */
export const SUBSCRIBED_STATUS = 'subscribed';

/**
 * The proof of a grant that arrives with a contact write (CRM form, customer API, partner and public lead submit, Sheets add-on).
 * What the person agreed to is `text` (the wording shown, with its `version`); how it was learned is `note` (what they said or signed,
 * and where). A grant needs at least one of the two; staff-set grants are explained in a `note`, as on the Consent card.
 */
export const consentProofSchema = z.object({
  /**
   * The channels the person agreed to. Omitted: the channels whose status this write sets to `subscribed`; when there are none either,
   * the channels the contact can be reached on (a phone is WhatsApp, an email address is email). SMS is only ever granted when asked for.
   */
  channels: z.array(intakeChannelSchema).min(1).max(3).optional(),
  /** How the person agreed: what they said or signed, and where. Shown on the Consent card and in the proof export. */
  note: z.string().trim().max(500).optional(),
  /** The wording the person was shown (cut to 300 characters in the evidence, its SHA-256 kept whole). */
  text: z.string().trim().max(2000).optional(),
  /** The version of that wording. */
  version: z.string().trim().max(64).optional(),
  /** When they agreed, if that was before this write. Omitted: now. */
  at: z.string().datetime().optional(),
});
export type ConsentProof = z.infer<typeof consentProofSchema>;
