import { Injectable, Logger } from '@nestjs/common';
import type {
  CallOutcome,
  IngestCallEntry,
  IngestCallsInput,
  IngestCallsResult,
  IngestReason,
  IngestResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { ContactResolverService, ContactsService } from '../../crm';
import { CallLoggingSettingsService } from './call-logging-settings.service';
import { CallLogEntriesService } from './call-log-entries.service';
import { checkStartedAt, e164Of, mobileExternalId, outcomeFromDevice } from './call-logging.rules';

const SAVEPOINT_FAILED: IngestReason = 'error';

/**
 * The mobile app's reports (`POST /v2/calls/ingest`): a batch of up to 100 calls from the phone's own call log (Android) or from the
 * "how did the call go?" prompt after a call (iOS has no call log API). The person is the signed-in member, so every entry is theirs.
 *
 * Rules, all of them about not keeping what the workspace did not ask for:
 *  - a call is matched to a contact by its number, among the contacts the person may read; a named contact must be readable;
 *  - a number that matches NO contact is not stored (a personal call on a work phone must not become a record about a stranger),
 *    unless the workspace switched on "create contacts from unknown callers" and the person may create contacts: then it is made one;
 *  - the phone's own `blocked` calls are skipped;
 *  - idempotent: (device id, device call id) is the entry's identity, so a batch sent twice, or half-sent and resent, lands once;
 *  - bulk-safe: each entry is its own savepoint, so one bad entry is `rejected` and the rest are kept. The answer lists every entry.
 */
@Injectable()
export class CallIngestService {
  private readonly logger = new Logger(CallIngestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly entries: CallLogEntriesService,
    private readonly contactsService: ContactsService,
    private readonly resolver: ContactResolverService,
    private readonly settings: CallLoggingSettingsService,
    private readonly rbac: RbacService,
  ) {}

  async ingest(input: IngestCallsInput): Promise<IngestCallsResult> {
    const ctx = RequestContextStore.require();
    const cc = await this.resolver.defaultCountryCode();
    const mayCreate = this.rbac.can(ctx.grants!, 'record.contacts.create').allowed;
    const results = await this.db.tx(async (tx) => {
      const { createContactsFromUnknownCallers } = await this.settings.readIn(tx, ctx.orgId);
      const out: IngestResult[] = [];
      for (const [index, entry] of input.entries.entries()) {
        out.push(
          await this.one(tx, ctx, input, entry, index, {
            cc,
            createUnknown: createContactsFromUnknownCallers && mayCreate,
          }),
        );
      }
      return out;
    });
    const count = (s: IngestResult['status']) => results.filter((r) => r.status === s).length;
    return {
      results,
      counts: {
        created: count('created'),
        duplicate: count('duplicate'),
        ignored: count('ignored'),
        rejected: count('rejected'),
      },
    };
  }

  private async one(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    batch: IngestCallsInput,
    e: IngestCallEntry,
    index: number,
    opts: { cc: string | null; createUnknown: boolean },
  ): Promise<IngestResult> {
    const skip = (
      status: IngestResult['status'],
      reason: IngestReason,
      contactId: string | null = null,
    ): IngestResult => ({ index, status, id: null, contactId, reason });

    const startedAt = new Date(e.startedAt);
    if (checkStartedAt(startedAt) !== 'ok') return skip('rejected', 'invalid_time');
    const phone = e164Of(e.customerPhone, opts.cc);
    if (!phone) return skip('rejected', 'unusable_phone');
    const outcome: CallOutcome | null =
      e.outcome ?? outcomeFromDevice(e.deviceCallType, e.durationSec);
    if (outcome === null) return skip('ignored', 'blocked');
    const ourPhone = e.ourPhone ? e164Of(e.ourPhone, opts.cc) : null;

    try {
      // A savepoint per entry: whatever fails inside leaves the others (and the batch's transaction) alone.
      return await tx.transaction(async (sp) => {
        const spx = sp as unknown as Tx;
        const found = await this.entries.contactFor(spx, ctx.orgId, ctx.userId, ctx.grants!, {
          contactUuid: e.contactId,
          phone,
        });
        let contact = found.contact;
        if (!contact && !found.hidden && opts.createUnknown) {
          const made = await this.contactsService.resolveOrCreateByIdentity(spx, ctx.orgId, {
            kind: 'phone',
            value: phone,
            source: 'mobile_app',
            ownerId: ctx.userId,
          });
          if (made.outcome === 'quota_reached') return skip('ignored', 'contact_limit');
          if (made.outcome === 'unusable') return skip('rejected', 'unusable_phone');
          contact = { id: made.contactId, uuid: made.uuid, ownerId: ctx.userId, createdBy: null };
        }
        // Nobody to attach it to, and the workspace did not ask for strangers: the call is not stored.
        if (!contact && !found.hidden) return skip('ignored', 'unknown_number');

        const { entry, created } = await this.entries.write(spx, ctx.orgId, {
          source: 'mobile_app',
          direction: e.direction,
          outcome,
          startedAt,
          durationSec: e.durationSec,
          contactId: contact?.id ?? null,
          customerPhone: phone,
          ourPhone,
          numberLabel: null,
          handlerUserId: ctx.userId,
          notes: e.notes ?? null,
          externalId: mobileExternalId(batch.deviceId, e.deviceCallId),
          telephonyConnectionId: null,
          recording: null,
          createdBy: ctx.userId,
          activitySource: 'user',
        });
        return {
          index,
          status: created ? ('created' as const) : ('duplicate' as const),
          id: entry.uuid,
          contactId: entry.contactUuid,
          reason: null,
        };
      });
    } catch (err) {
      if (err instanceof AppError && [403, 404].includes(err.getStatus())) {
        return skip('rejected', 'contact_not_found');
      }
      // Only the kind of failure is logged: a database message can quote the number it refused.
      this.logger.warn(
        { orgId: ctx.orgId, index, kind: (err as Error).name },
        '[CALL] a mobile call entry was rejected',
      );
      return skip('rejected', SAVEPOINT_FAILED);
    }
  }
}
