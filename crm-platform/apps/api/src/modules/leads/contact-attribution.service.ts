import { Injectable } from '@nestjs/common';
import type { ContactAttributionResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../crm';
import { LeadAttributionsRepository } from './lead-attributions.repository';
import { toAttributionTouch } from './leads.mapper';

const MAX_TOUCHES = 50;

/**
 * Where a contact came from (spec L-03): first touch, latest touch and the history, from the append-only `contact_attributions`. Reading
 * it is reading the contact, so it takes the contact's own permission and record scope: a caller who may not see the contact gets the
 * same 404 the contact itself would give.
 */
@Injectable()
export class ContactAttributionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly attributions: LeadAttributionsRepository,
    private readonly contacts: ContactsRepository,
    private readonly rbac: RbacService,
  ) {}

  async forContact(contactUuid: string): Promise<ContactAttributionResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.contacts, ctx.orgId, scope, ctx.userId!, contact);

      const [touches, first, total] = await Promise.all([
        this.attributions.listForContact(tx, ctx.orgId, contact.id, MAX_TOUCHES),
        this.attributions.firstForContact(tx, ctx.orgId, contact.id),
        this.attributions.countForContact(tx, ctx.orgId, contact.id),
      ]);
      return {
        first: first ? toAttributionTouch(first) : null,
        latest: touches[0] ? toAttributionTouch(touches[0]) : null,
        touches: touches.map(toAttributionTouch),
        total,
      };
    });
  }
}
