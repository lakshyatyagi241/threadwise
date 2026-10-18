import { Injectable } from '@nestjs/common';
import type { ConsentGateReason } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentGate, consentSkipNote, countSkipReasons, gateRecipients } from '../contact-consent';
import {
  COMMERCE_CONSENT_CHANNEL,
  commercePurpose,
  foldProbes,
  isMarketing,
  issueClearance,
  type CommerceClearance,
  type Probe,
} from './commerce-consent.rules';
import { EventsRepository, type LogStatus } from './events.repository';
import type { StoreKind } from './mirror-rules';
import { SegmentsRepository } from './segments.repository';

/** A row of a commerce audience: a number, and the contact behind it when the audience is made of contacts. */
export interface CommerceRecipient {
  phone: string;
  contactId?: number | null;
}

export interface ClearedAudience<T> {
  /** Who may be messaged, each with the clearance the sender needs. */
  go: Array<{ row: T; clearance: CommerceClearance }>;
  /** Who must not be, each with the gate's reason (`CONSENT_GATE_REASONS`). */
  skipped: Array<{ row: T; reason: ConsentGateReason }>;
}

export type CustomerVerdict =
  | { ok: true; clearance: CommerceClearance }
  | { ok: false; reason: ConsentGateReason; note: string };

const digits = (v: string): string => v.replace(/\D/g, '');

/**
 * The consent step of every commerce template send to a customer (BL-141 follow-up, BL-278): the offer and win-back broadcasts, the
 * order and cart automations (including the abandoned-cart reminders), the COD confirmation, the back-in-stock alert and the review
 * reward. It is what PR 529 did for the social broadcast senders, for the store senders.
 *
 * A MARKETING template (`commercePurpose`) puts every recipient through `gateRecipients` on the `whatsapp` consent channel BEFORE the
 * quiet-hours hold, and again on every later run (a broadcast released from the hold asks again). A recipient the gate refuses is
 * recorded with the closed-set reason and is never messaged. A UTILITY or AUTHENTICATION template is a notice the customer needs and is
 * never asked about. The merchant's own staff number (the automation's "admin" recipient) is not a customer and is never asked.
 *
 * Every sender call needs the `CommerceClearance` this service issues, so a send path cannot skip the step.
 */
@Injectable()
export class CommerceConsentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gate: ConsentGate,
    private readonly segments: SegmentsRepository,
    private readonly events: EventsRepository,
  ) {}

  /** The merchant's own number: an internal notification, not a customer. */
  staff(): CommerceClearance {
    return issueClearance('staff');
  }

  /**
   * An audience in one pass. A marketing template asks the gate once for the whole audience (one statement per thousand contacts, plus
   * one per thousand numbers to find who owns them); any other template clears everyone without asking. A number that is no contact is
   * asked as an anonymous subject: allowed while the workspace switch is off, `no_consent_recorded` while it is on. A gate that cannot
   * decide refuses (`gate_unavailable_closed`), so nobody is messaged unchecked.
   */
  async clearAudience<T extends CommerceRecipient>(
    orgId: number,
    rows: readonly T[],
    category: string | null | undefined,
  ): Promise<ClearedAudience<T>> {
    const purpose = commercePurpose(category);
    if (!isMarketing(purpose)) {
      const clearance = issueClearance('service');
      return { go: rows.map((row) => ({ row, clearance })), skipped: [] };
    }
    if (rows.length === 0) return { go: [], skipped: [] };

    const owners = await this.db.txAs({ orgId }, (tx) =>
      this.segments.contactIdsByDigits(
        tx,
        orgId,
        rows.map((r) => digits(r.phone)),
      ),
    );
    const probes: Probe[] = [];
    rows.forEach((r, rowIndex) => {
      const ids = new Set<number>([
        ...(r.contactId == null ? [] : [r.contactId]),
        ...(owners.get(digits(r.phone)) ?? []),
      ]);
      if (ids.size === 0) probes.push({ rowIndex, contactId: null });
      for (const contactId of ids) probes.push({ rowIndex, contactId });
    });
    const gated = await gateRecipients(this.gate, orgId, probes, COMMERCE_CONSENT_CHANNEL, purpose);
    const folded = foldProbes(rows, gated);
    const clearance = issueClearance('asked');
    return {
      go: folded.go.map((row) => ({ row, clearance })),
      skipped: folded.skipped,
    };
  }

  /** One customer, one template: the same step as an audience of one. */
  async clearCustomer(
    orgId: number,
    category: string | null | undefined,
    phone: string,
  ): Promise<CustomerVerdict> {
    const cleared = await this.clearAudience(orgId, [{ phone }], category);
    const skip = cleared.skipped[0];
    if (skip) return { ok: false, reason: skip.reason, note: consentSkipNote(skip.reason) };
    return { ok: true, clearance: cleared.go[0]!.clearance };
  }

  /**
   * Puts the refusals of one run on the store's activity log, one row per reason (`skipped`, the stable code in the note), so the
   * Activity tab shows who was not messaged and why. Nothing is written when nobody was refused.
   */
  async recordSkips(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    eventType: string,
    skipped: ReadonlyArray<{ reason: ConsentGateReason }>,
    unit = 'contacts',
  ): Promise<void> {
    const tally = countSkipReasons(skipped);
    if (tally.length === 0) return;
    await this.db.txAs({ orgId }, async (tx) => {
      for (const t of tally) {
        await this.events.log(tx, orgId, kind, storeId, {
          eventType,
          status: 'skipped' satisfies LogStatus,
          recipient: `${t.count} ${t.count === 1 && unit === 'contacts' ? 'contact' : unit}`,
          payload: { reason: t.reason, count: t.count },
          error: consentSkipNote(t.reason),
        });
      }
    });
  }
}
