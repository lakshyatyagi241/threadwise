import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { OwnerChangeSource } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { HandoffRepository } from './handoff.repository';

/**
 * Contact owner and chat owner (BL-402, spec section 4.5): the one place where a chat may write the CONTACT's owner.
 *
 * The only write is a first touch: the owner is set only where nobody ever decided it (`owner_id IS NULL AND owner_changed_at IS NULL`),
 * with the exact guard the record assignment engine uses, under the contact's row lock. Whichever of the two reaches the row first wins and
 * the other matches no row, so they cannot fight. The database trigger stamps `owner_changed_at`, so afterwards the engine reads the owner
 * as a person's decision and never moves it. The audit row and the owner-changed event carry `source`, which the owner sync reads to ignore
 * its own and the chat's writes (no loop).
 */
@Injectable()
export class OwnerAlignmentService {
  constructor(
    private readonly repo: HandoffRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Returns what happened, for the handoff trace: the contact now has this owner, already had one, or somebody decided first. */
  async firstTouch(
    tx: Tx,
    orgId: number,
    contactId: number,
    userId: number,
    source: Extract<OwnerChangeSource, 'chat_claim'>,
  ): Promise<'set' | 'has_owner' | 'decided'> {
    const head = await this.repo.contactOwnerHead(tx, orgId, contactId);
    if (!head) return 'decided';
    if (head.ownerId !== null) return 'has_owner';
    if (head.decided) return 'decided';
    const won = await this.repo.setOwnerIfUndecided(tx, orgId, contactId, userId);
    if (!won) return 'decided';
    const res = await tx.execute(sql`
      SELECT c.uuid AS contact_uuid, u.uuid AS user_uuid FROM contacts c, users u
      WHERE c.org_id = ${orgId} AND c.id = ${contactId} AND u.org_id = ${orgId} AND u.id = ${userId}`);
    const r = (res as unknown as { rows: Array<{ contact_uuid: string; user_uuid: string }> }).rows[0];
    await this.audit.record(tx, {
      module: 'contacts',
      recordId: contactId,
      action: 'update',
      delta: {
        ownerId: { old: null, new: r?.user_uuid ?? null },
        ownerSource: { old: null, new: source },
      },
    });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'contacts',
      aggregateId: contactId,
      eventType: 'contact.updated',
      payload: { uuid: r?.contact_uuid, ownerId: r?.user_uuid, previousOwnerId: null, source },
    });
    return 'set';
  }
}
