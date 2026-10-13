import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MailWorkspaceSettings, UpdateMailWorkspaceSettingsInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MemberDirectory, RealtimeEmitter, channelOwnerSql } from '../../realtime';
import { MailAccess } from './mail-access.service';
import { MailSettingsRepository } from './mail-settings.repository';

export const MAIL_SETTINGS_AUDIT_MODULE = 'mail_workspace_settings';

/**
 * The workspace's email sharing policy (TW-MAIL-035): are personal mailboxes allowed, who may connect one, may admins read them.
 * One row per workspace, created by the first save (until then the contract defaults apply). Saving is optimistic-locked on `rowVersion`
 * (0 = never saved), audited and announced (`mail.settings.updated`) in the same transaction.
 *
 * Turning anything OFF never exposes anything: the connect option goes away and `adminsCanReadPersonal: false` hides personal
 * mail from admins again at once (the policy is read fresh by every visibility decision, see `MemberDirectory` / `InboxAccess`); existing
 * personal mailboxes keep working for their owners.
 */
@Injectable()
export class MailSettingsService {
  private readonly logger = new Logger(MailSettingsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailSettingsRepository,
    private readonly access: MailAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly directory: MemberDirectory,
    private readonly emitter: RealtimeEmitter,
  ) {}

  async get(): Promise<MailWorkspaceSettings> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx((tx) => this.access.policy(tx, orgId));
  }

  async update(input: UpdateMailWorkspaceSettingsInput): Promise<MailWorkspaceSettings> {
    const ctx = RequestContextStore.require();
    const { orgId } = ctx;
    let wasReadingPersonal = false;
    const next = await this.db.tx(async (tx) => {
      const before = await this.access.policy(tx, orgId);
      wasReadingPersonal = before.adminsCanReadPersonal;
      if (before.rowVersion !== input.rowVersion)
        throw AppError.rowVersionConflict('Email settings');
      const wanted = {
        personalMailboxesEnabled: input.personalMailboxesEnabled ?? before.personalMailboxesEnabled,
        whoMayConnectPersonal: input.whoMayConnectPersonal ?? before.whoMayConnectPersonal,
        adminsCanReadPersonal: input.adminsCanReadPersonal ?? before.adminsCanReadPersonal,
      };
      const after = await this.repo.save(tx, orgId, ctx.userId ?? null, wanted, input.rowVersion);
      if (!after) throw AppError.rowVersionConflict('Email settings');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const key of Object.keys(wanted) as Array<keyof typeof wanted>) {
        if (before[key] !== after[key]) delta[key] = { old: before[key], new: after[key] };
      }
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: MAIL_SETTINGS_AUDIT_MODULE,
          recordId: orgId,
          action: before.rowVersion === 0 ? 'insert' : 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: MAIL_SETTINGS_AUDIT_MODULE,
          aggregateId: orgId,
          eventType: 'mail.settings.updated',
          payload: { ...wanted },
        });
      }
      return after;
    });
    // Realtime audiences cache who is an admin for 30 s; the policy bit itself is never cached, this just keeps this process tidy.
    this.directory.invalidate(orgId);
    // Admins who had a personal conversation open when the policy was withdrawn must stop receiving it: a room is only checked when it is joined.
    if (wasReadingPersonal && !next.adminsCanReadPersonal) await this.evictAdmins(orgId);
    return next;
  }

  /** Takes every admin's sockets out of the rooms of conversations on other people's personal mailboxes. Best effort, never throws. */
  private async evictAdmins(orgId: number): Promise<void> {
    try {
      const [admins, personal] = await Promise.all([
        this.directory.mailAdminIds(orgId),
        this.db.txAs({ orgId }, (tx) =>
          tx.execute(sql`
            SELECT c.uuid, ${channelOwnerSql('c')} AS owner_user_id
            FROM conversations c
            WHERE c.org_id = ${orgId} AND ${channelOwnerSql('c')} IS NOT NULL`),
        ),
      ]);
      for (const row of personal.rows as Array<{ uuid: string; owner_user_id: string | number }>) {
        for (const admin of admins) {
          if (admin === Number(row.owner_user_id)) continue;
          await this.emitter.evict(orgId, admin, { kind: 'conv', id: row.uuid });
        }
      }
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not evict admins from personal conversation rooms');
    }
  }
}
