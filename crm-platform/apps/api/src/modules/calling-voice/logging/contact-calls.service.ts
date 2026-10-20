import { Injectable } from '@nestjs/common';
import type { ContactCallsPage, ContactCallsQuery, RecordScope } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../../crm';
import { CallLogsRepository } from '../call-logs.repository';
import { toLogRow } from '../call-logs.service';
import { decodeLogCursor, encodeLogCursor } from './call-logging.rules';

/**
 * A contact's calls: the WhatsApp calls and the logged ones in one list, newest first. The person must be allowed to read the contact
 * (its own record scope applies) AND to read the call log: the log's record scope decides which of the calls they see, by who handled
 * them, exactly as on the Call logs screen. No plan gate: logging a call is not a WhatsApp calling feature.
 */
@Injectable()
export class ContactCallsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logs: CallLogsRepository,
    private readonly contacts: ContactsRepository,
    private readonly rbac: RbacService,
  ) {}

  async list(
    contactUuid: string,
    query: ContactCallsQuery,
    logScope: RecordScope,
  ): Promise<ContactCallsPage> {
    const ctx = RequestContextStore.require();
    const after = query.cursor ? decodeLogCursor(query.cursor) : null;
    if (query.cursor && !after) throw AppError.validation('The cursor is not valid.');
    return this.db.tx(async (tx) => {
      const ref = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!ref) throw AppError.notFound('Contact', contactUuid);
      const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      await assertContactScope(tx, this.contacts, ctx.orgId, read.scope, ctx.userId!, ref);
      const rows = await this.logs.forContact(
        tx,
        { orgId: ctx.orgId, userId: ctx.userId, scope: logScope },
        ref.id,
        query.limit,
        after,
        query.source,
      );
      const hasMore = rows.length > query.limit;
      const shown = hasMore ? rows.slice(0, query.limit) : rows;
      const last = shown[shown.length - 1];
      return {
        data: shown.map(toLogRow),
        page: {
          nextCursor:
            hasMore && last
              ? encodeLogCursor({ startedAt: String(last.started_iso), uuid: String(last.uuid) })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }
}
