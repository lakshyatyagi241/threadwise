import { Injectable } from '@nestjs/common';
import type { ContactMessageStats } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { ContactMessageStatsRepository } from './contact-message-stats.repository';

@Injectable()
export class ContactMessageStatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactMessageStatsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * The WhatsApp counters of one contact. The contact must be in the caller's record scope, and the caller must be allowed to read
   * conversations (the counts are read off them).
   */
  async whatsapp(contactUuid: string): Promise<ContactMessageStats> {
    const ctx = RequestContextStore.require();
    if (!this.rbac.can(ctx.grants!, 'inbox.conversation.read').allowed) {
      throw AppError.forbidden('inbox.conversation.read');
    }
    return this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      return this.repo.whatsapp(tx, ctx.orgId, contact.id);
    });
  }
}
