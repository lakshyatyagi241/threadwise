import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConsentChannel,
  type ConsentProof,
  type ConsentSource,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { hasProof, intakeEvidence } from './consent-intake.rules';
import { ContactConsentService } from './consent.service';

export interface IntakeGrantInput {
  contactId: number;
  channels: readonly ConsentChannel[];
  /** Where the agreement was given: `manual` (a person typed it in), `api`, `form`, and the intake sources `widget`, `booking`, `commerce`. */
  source: ConsentSource;
  /** What the person agreed to and how it was learned. Staff-set grants need `note` or `text` (`requireProof`). */
  proof?: ConsentProof;
  /** Extra evidence keys (`formId`, `widgetId`, `noticeVersion`, `noticeUrl`...). Unknown keys are dropped by the ledger. */
  evidence?: Record<string, string | null | undefined>;
  actorUserId?: number | null;
  /** Idempotency key prefix; the channel is appended. A repeat of the same source event writes nothing. */
  keyBase: string;
  /** A grant from an automated source must not override a withdrawal the person made themselves. Default true. */
  respectWithdrawn?: boolean;
  /** Used as the ledger note when the proof has none. */
  fallbackNote?: string;
}

/**
 * Writes the ledger grants of the intake paths (a contact record, the customer API, partner and public lead submit, the Sheets add-on,
 * the website widget, the booking page, a store checkout). One place, so every path follows the same policy
 * (docs/specs/privacy-and-data-governance.md section 4.3.2): a grant is written only when the person actually agreed, with the source,
 * the notice wording and version, and the time as evidence; a first inbound message never reaches this service.
 *
 * It does not decide WHETHER the person agreed: the caller did (a ticked box, a staff note, a store's own marketing flag). It refuses a
 * grant that comes with nothing a person could read later when the caller asks (`requireProof`).
 */
@Injectable()
export class ConsentIntakeService {
  constructor(private readonly ledger: ContactConsentService) {}

  /** A staff or API grant with neither a note nor the wording is refused, as the Consent card does (422 CONSENT_NOTE_REQUIRED). */
  requireProof(proof: ConsentProof | undefined): void {
    if (hasProof(proof)) return;
    throw new AppError(
      ERROR_CODES.CONSENT_NOTE_REQUIRED,
      'Say how the contact agreed (what they said or signed, and where) before marking them subscribed. ' +
        'A subscription status alone is not consent.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** Appends one `granted` event per channel inside the caller's transaction. Returns the channels that really got a new event. */
  async grant(tx: Tx, orgId: number, input: IntakeGrantInput): Promise<ConsentChannel[]> {
    const now = new Date();
    // A date from the caller can be earlier than now, never later: a future grant would outrank a STOP that arrives before it.
    const at = input.proof?.at ? new Date(input.proof.at) : now;
    const occurredAt = at.getTime() > now.getTime() ? now : at;
    const evidence = intakeEvidence(input.proof, input.evidence);
    const note =
      input.proof?.note?.trim() ||
      input.fallbackNote ||
      (input.proof?.text?.trim() ? 'Agreed to the wording on record' : null);
    const recorded: ConsentChannel[] = [];
    for (const channel of input.channels) {
      const out = await this.ledger.recordInTx(tx, orgId, {
        contactId: input.contactId,
        channel,
        action: 'granted',
        source: input.source,
        evidence,
        actorUserId: input.actorUserId ?? null,
        note,
        occurredAt,
        idempotencyKey: `${input.keyBase}:${channel}`,
        respectWithdrawn: input.respectWithdrawn ?? true,
      });
      if (out.recorded) recorded.push(channel);
    }
    return recorded;
  }
}
