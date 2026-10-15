import {
  consentChannelOfKind,
  type MinorRule,
  modalityOfChannel,
  purposeAppliesTo,
  purposeOf,
  type ConsentChannel,
  type ConsentGateReason,
  type ConsentGateResult,
  type ConsentModality,
  type ConsentNoticeEvidence,
  type PurposeDefinition,
  type PurposeInput,
} from '@crm/contracts';

/**
 * What the database says about one subject, for one channel. Everything the decision needs; the decision itself is pure
 * (`decideConsent`), so the truth table is unit tested without a database.
 */
export interface ConsentFacts {
  /** The roll-up flag `contacts.is_unsubscribed` (set by a withdrawal on ANY channel, read by every legacy send path). */
  unsubscribedFlag: boolean;
  /** The ledger state for (channel, the purpose's ledger purpose). `unknown` = no event yet or no such contact. */
  ledgerState: 'granted' | 'withdrawn' | 'unknown';
  /** The contact is flagged as a minor (`contact_privacy_flags`, BL-180). Absent = false. */
  minor?: boolean;
  /** A parent's or guardian's consent is on record for the flagged minor. Evidence only: it is never a marketing grant. */
  guardianConsent?: boolean;
  /** The contact opted out of the sale or sharing of their personal information. Absent = false. */
  saleShareOptOut?: boolean;
}

export const NO_FACTS: ConsentFacts = { unsubscribedFlag: false, ledgerState: 'unknown' };

export interface DecideInput {
  purpose: PurposeInput;
  /** A consent channel or a channel kind (`whatsapp_cloud`); null/unmapped kinds have no ledger. */
  channel: string;
  modality?: ConsentModality;
  /** The workspace switch "Require recorded consent for marketing sends". */
  requireConsent: boolean;
  /** The message answers an inbound message from this contact and the customer-service window is open. */
  replyWindowOpen?: boolean;
  /** The workspace has the purpose switched off (call recording is off by default). Omitted = no such switch for this purpose. */
  purposeEnabled?: boolean;
  /** What the caller holds for a notice-first purpose: the delivered notice and the person's answer. */
  noticeEvidence?: ConsentNoticeEvidence;
  /** What the workspace's children setting does with marketing to a flagged minor. Omitted = `off` (the flag changes nothing). */
  minorRule?: MinorRule;
  facts: ConsentFacts;
}

const allow = (reason: ConsentGateReason): ConsentGateResult => ({ decision: 'allow', reason });
const deny = (reason: ConsentGateReason): ConsentGateResult => ({ decision: 'deny', reason });

/**
 * The ConsentGate's rule. In order:
 *
 *  1. The purpose must apply to the channel and modality, and the workspace must not have switched it off (`purpose_not_enabled`).
 *  2. A purpose with a notice to deliver first (a recording announcement, an AI disclosure) answers `needs_notice` until the caller
 *     presents the evidence that the versioned notice was delivered; a consent-based one (a call recording) then needs the person's
 *     answer too: `granted` allows, `declined` denies, no answer is still `needs_notice`. No evidence is the old behaviour, unchanged.
 *  3. Service (`utility`): a reply inside the customer-service window is allowed (`inbound_reply_window`); otherwise only an
 *     explicit withdrawal of the service purpose on that channel blocks it. STOP withdraws MARKETING only, so a contact who sent
 *     STOP still gets order, appointment and support messages.
 *  4. Marketing: a withdrawal (the roll-up flag or the ledger) ALWAYS denies, whatever the switch says. Then a contact flagged as a
 *     minor is held (`subject_minor`) when the workspace's children setting says so: always under `block`, and under `guardian` until
 *     a parent's or guardian's consent is on record (BL-180). With the switch on, a recorded grant on the channel is also needed. With
 *     it off (the default) everyone else is allowed: today's behaviour, exactly. Service messages are never held back by the flag.
 *  5. Third-party sharing: a contact who opted out of the sale or sharing of their data is denied (`sale_share_opted_out`).
 *  6. Any other purpose with no ledger: allowed when no opt-in is mandatory, denied (`no_consent_recorded`) when it is, until the
 *     generalised ledger records those purposes.
 */
export function decideConsent(input: DecideInput): ConsentGateResult {
  const def = purposeOf(input.purpose);
  const channel = consentChannelOfKind(input.channel);
  const modality = input.modality ?? (channel ? modalityOfChannel(channel) : 'text');

  if (channel && !purposeAppliesTo(def, channel, modality)) return deny('purpose_not_applicable');
  if (input.purposeEnabled === false) return deny('purpose_not_enabled');
  if (def.noticeRequired && def.noticeKey) {
    const ev = input.noticeEvidence;
    const pending: ConsentGateResult = {
      decision: 'needs_notice',
      reason: 'notice_required',
      noticeKey: def.noticeKey,
    };
    if (!ev?.delivered) return pending;
    if (!def.consentMandatory) return allow('notice_delivered');
    if (ev.consent === 'granted') return allow('consent_evidence_recorded');
    if (ev.consent === 'declined') return deny('consent_declined');
    return pending;
  }

  if (def.ledgerPurpose === 'utility') {
    if (input.replyWindowOpen) return allow('inbound_reply_window');
    if (channel && input.facts.ledgerState === 'withdrawn') return deny('withdrawn');
    return allow('utility_exempt');
  }

  if (def.ledgerPurpose === 'marketing') {
    if (input.facts.unsubscribedFlag || (channel && input.facts.ledgerState === 'withdrawn')) {
      return deny('withdrawn');
    }
    if (isHeldAsMinor(input.minorRule, input.facts)) return deny('subject_minor');
    if (!input.requireConsent) return allow('policy_off');
    if (!channel) return deny('channel_unmapped');
    return input.facts.ledgerState === 'granted' ? allow('granted') : deny('no_consent_recorded');
  }

  if (def.id === 'third_party_sharing' && input.facts.saleShareOptOut) {
    return deny('sale_share_opted_out');
  }
  return def.consentMandatory ? deny('no_consent_recorded') : allow('no_grant_required_by_policy');
}

/**
 * A flagged minor's marketing is held when the workspace says so. `block`: always. `guardian`: until guardian consent is on record. A
 * contact who is not flagged, or a workspace whose children setting is not answered (`off`), is never held by this.
 */
export function isHeldAsMinor(rule: MinorRule | undefined, facts: ConsentFacts): boolean {
  if (!facts.minor || !rule || rule === 'off') return false;
  return rule === 'block' || !facts.guardianConsent;
}

/** The answer when the gate itself failed: consent-based purposes fail closed, everything else (service replies) fails open. */
export function failureResult(def: PurposeDefinition): ConsentGateResult {
  return def.ledgerPurpose === 'utility' || !def.consentMandatory
    ? allow('gate_unavailable_open')
    : deny('gate_unavailable_closed');
}

/**
 * The purpose of a message an agent, a bot or an API caller sends to a conversation (decision recorded in
 * docs/specs/privacy-and-data-governance.md): free-form text or a file is a reply - service, not marketing, whatever it says. A
 * template is a business-initiated message and takes its category (a MARKETING template stays marketing; utility and authentication
 * are service). The window decides whether the gate says `inbound_reply_window` or looks at the contact's service withdrawal.
 */
export function messagePurpose(opts: {
  isTemplate: boolean;
  templateCategory?: string | null;
}): 'marketing_messaging' | 'service_messaging' {
  if (opts.isTemplate && (opts.templateCategory ?? '').toLowerCase() === 'marketing') {
    return 'marketing_messaging';
  }
  return 'service_messaging';
}

/** The reasons that mean "do not send". */
export const isAllowed = (r: ConsentGateResult): boolean => r.decision === 'allow';

export type { ConsentChannel };
