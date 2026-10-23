import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { SendWindowService } from '../compliance-center';
import { CallsRepository } from './calls.repository';
import { unprocessable } from './calling-support';

/** Who a business-initiated call is for: the contact when one is known (null for a bare number), and the number as digits. */
export interface CallingWindowTarget {
  contactId: number | null;
  conversationId: number | null;
  phone: string;
}

/**
 * The calling window (BL-177) for every call the workspace starts: WhatsApp calls from the operator's dialler and click-to-call through
 * a telephony provider. A business-initiated call outside the hours the workspace set is refused, because a live call cannot wait for the
 * window to open (a message would be held; a call has no queue). The refusal names the instant the window opens. A call back to someone
 * who reached us in the last 24 hours (a message or a call) is service and is never held. Shared so the two paths keep one rule.
 */
@Injectable()
export class CallingWindowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly sendWindow: SendWindowService,
  ) {}

  /** The instant the window opens when a call to this target is refused now, or null when a call may go. */
  async closedUntil(orgId: number, target: CallingWindowTarget): Promise<string | null> {
    const decision = await this.sendWindow.check(orgId, 'call', {
      contactId: target.contactId,
      phone: target.phone,
    });
    if (decision.decision !== 'hold') return null;
    const answered = await this.db.tx((tx) =>
      this.repo.contactedUsRecently(tx, orgId, {
        conversationId: target.conversationId,
        contactId: target.contactId,
        phone: target.phone,
        hours: 24,
      }),
    );
    return answered ? null : decision.until;
  }

  /** Throws 422 `CALL_OUTSIDE_WINDOW` when the window is closed for this target and they did not reach us in the last 24 hours. */
  async assertOpen(orgId: number, target: CallingWindowTarget): Promise<void> {
    const until = await this.closedUntil(orgId, target);
    if (until === null) return;
    // Only the instant goes back: the zone of a contact the caller may not read is not theirs to see (the refusal is not a contact read).
    throw unprocessable(
      'CALL_OUTSIDE_WINDOW',
      `Calls to this contact are allowed from ${until}. It is outside the workspace's calling hours.`,
      [{ path: 'opensAt', message: until }],
    );
  }
}
