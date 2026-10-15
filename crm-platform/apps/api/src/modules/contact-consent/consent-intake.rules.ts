import {
  INTAKE_CHANNELS,
  SUBSCRIBED_STATUS,
  type ConsentProof,
  type IntakeChannel,
} from '@crm/contracts';
import { sha256 } from './consent.rules';

/**
 * Consent at intake: the pure rules (spec docs/specs/privacy-and-data-governance.md section 4.3.2). No database, no clock, so they are
 * unit tested alone. The service (`ConsentIntakeService`) applies them inside the caller's transaction.
 *
 * POLICY: a grant exists only because the person agreed. A subscription status is a label, not proof.
 */

/** A status value that means "agreed to marketing on this channel". */
export function isSubscribedStatus(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === SUBSCRIBED_STATUS;
}

export type StatusMap = Partial<Record<IntakeChannel, string | null | undefined>>;

export interface IntakePlan {
  /** The channels to write a grant for, in the order whatsapp, sms, email. */
  grant: IntakeChannel[];
  /** Of those, the channels whose status column should be set to `subscribed` because the write did not set it and none is stored. */
  fillStatus: IntakeChannel[];
}

/**
 * Which channels a contact write grants consent on.
 *
 *  - a status set to `subscribed` in this write (and not already stored as subscribed: a repeat of the same value is not a new
 *    agreement);
 *  - the channels named in the proof;
 *  - a proof with no channels and no status: the channels the contact can be reached on (phone: WhatsApp, address: email).
 *
 * Nothing in a write that carries neither a `subscribed` status nor a proof can grant: the plan is empty.
 */
export function planIntakeGrants(args: {
  /** The statuses this write carries (undefined: not part of the write). */
  given: StatusMap;
  /** The statuses already stored (an update); empty for a new contact. */
  stored?: StatusMap;
  proof?: ConsentProof;
  /** What the contact can be reached on once this write is applied. */
  reachable: { phone: boolean; email: boolean };
}): IntakePlan {
  const wanted = new Set<IntakeChannel>();
  for (const ch of INTAKE_CHANNELS) {
    if (isSubscribedStatus(args.given[ch]) && !isSubscribedStatus(args.stored?.[ch]))
      wanted.add(ch);
  }
  if (args.proof) {
    for (const ch of args.proof.channels ?? []) wanted.add(ch);
    if (wanted.size === 0) {
      if (args.reachable.phone) wanted.add('whatsapp');
      if (args.reachable.email) wanted.add('email');
    }
  }
  const grant = INTAKE_CHANNELS.filter((ch) => wanted.has(ch));
  const fillStatus = grant.filter(
    (ch) => args.given[ch] === undefined && !(args.stored?.[ch] ?? '').trim(),
  );
  return { grant, fillStatus };
}

/** A grant needs something a person can read later: how they agreed (`note`) or what they agreed to (`text`). */
export function hasProof(proof: ConsentProof | undefined): boolean {
  return Boolean(proof?.note?.trim() || proof?.text?.trim());
}

/**
 * The evidence of a grant: the wording shown (cut to 300 characters, the hash of the whole text beside it), its version, plus the keys
 * the caller adds (a form id, a widget id, a notice URL). Never an IP address, a user agent or free personal text.
 */
export function intakeEvidence(
  proof: Pick<ConsentProof, 'text' | 'version'> | undefined,
  extra: Record<string, string | null | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = proof?.text?.trim();
  if (text) {
    out.consentText = text.slice(0, 300);
    out.consentHash = sha256(text);
  }
  const version = proof?.version?.trim();
  if (version) out.consentVersion = version;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}
