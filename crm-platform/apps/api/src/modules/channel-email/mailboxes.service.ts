import { Injectable, Logger } from '@nestjs/common';
import type { MailboxListResponse, MailboxResponse, UpdateMailboxInput } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { GoogleMailOAuthClient } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MailChannelSync } from './mail-channel.sync';
import { GoogleMailConfig } from './mail-config.service';
import { mailboxUnavailable } from './mail-errors';
import { MailPlan } from './mail-plan';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MAIL_AUDIT_MODULE } from './mail-tokens.service';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

/** The mailbox as the hub sees it. Tokens, scopes and the sync cursor never leave the server. */
export function toMailboxResponse(row: MailboxRow, conversationCount: number): MailboxResponse {
  return {
    id: row.uuid,
    provider: row.provider,
    address: row.address,
    displayName: row.displayName,
    status: row.status,
    channelId: row.channelUuid,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    conversationCount,
    rowVersion: row.rowVersion,
  };
}

/** The workspace's mailboxes: list, rename, sync now, disconnect (TW-MAIL-019, 023, 028). Connecting is `MailConnectService`. */
@Injectable()
export class MailboxesService {
  private readonly logger = new Logger(MailboxesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly config: GoogleMailConfig,
    private readonly oauth: GoogleMailOAuthClient,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plan: MailPlan,
    private readonly channel: MailChannelSync,
    private readonly sync: MailSyncPublisher,
  ) {}

  async list(): Promise<MailboxListResponse> {
    const { orgId } = RequestContextStore.require();
    const [rows, limit, ready] = await Promise.all([
      this.db.tx((tx) => this.repo.list(tx, orgId)),
      this.plan.mailboxLimit(orgId),
      this.config.ready(),
    ]);
    // A disconnected mailbox is history, not a mailbox the workspace holds: it is listed (its conversations are still there) but not counted.
    return {
      data: rows.map((r) => toMailboxResponse(r, r.conversationCount)),
      limit,
      used: rows.filter((r) => r.status !== 'disconnected').length,
      providerReady: ready,
    };
  }

  async rename(uuid: string, input: UpdateMailboxInput): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.byUuid(tx, orgId, uuid);
      if (!before) throw AppError.notFound('Mailbox', uuid);
      const after = await this.repo.rename(
        tx,
        orgId,
        before.id,
        input.rowVersion,
        input.displayName,
      );
      if (!after) throw AppError.rowVersionConflict('Mailbox');
      if (before.displayName !== after.displayName) {
        await this.audit.record(tx, {
          module: MAIL_AUDIT_MODULE,
          recordId: after.id,
          action: 'update',
          delta: { displayName: { old: before.displayName, new: after.displayName } },
        });
      }
      return toMailboxResponse(after, await this.conversationCount(tx, orgId, after));
    });
  }

  /** Asks for a sync now (the sweep runs every minute anyway). The job runs in the worker; the answer is the mailbox as it stands. */
  async syncNow(uuid: string): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Mailbox', uuid);
    if (row.status === 'disconnected' || row.status === 'needs_reauth') {
      throw mailboxUnavailable(
        row.status === 'needs_reauth'
          ? 'This mailbox needs reconnecting before it can sync.'
          : 'This mailbox is disconnected.',
      );
    }
    await this.sync.enqueue(orgId, row.uuid);
    return toMailboxResponse(row, await this.db.tx((tx) => this.conversationCount(tx, orgId, row)));
  }

  /**
   * Withdraws the grant at Google, then forgets it here. A Google that cannot be reached does not trap the admin: the local copy goes
   * anyway. The mailbox row and its conversations stay (read-only), so reconnecting the same address picks them up again. Idempotent.
   */
  async disconnect(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, ctx.orgId, uuid));
    if (!row) throw AppError.notFound('Mailbox', uuid);
    if (row.status === 'disconnected') return;
    if (row.refreshTokenEnc) {
      try {
        await this.oauth.revoke(this.crypto.decrypt(row.refreshTokenEnc));
      } catch (err) {
        this.logger.warn(
          { orgId: ctx.orgId, mailbox: uuid, err: (err as Error).message },
          'Google did not confirm the revoke; disconnecting here regardless',
        );
      }
    }
    const changed = await this.db.tx(async (tx) => {
      const live = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!live || live.status === 'disconnected') return null;
      await this.repo.disconnect(tx, ctx.orgId, live.id);
      await this.audit.record(tx, {
        module: MAIL_AUDIT_MODULE,
        recordId: live.id,
        action: 'update',
        delta: { status: { old: live.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: MAIL_AUDIT_MODULE,
        aggregateId: live.id,
        eventType: 'mail.mailbox.disconnected',
        payload: { uuid: live.uuid, provider: 'google', address: live.address },
      });
      return live;
    });
    if (changed) await this.channel.sync(ctx.orgId, { ...changed, status: 'disconnected' });
  }

  private async conversationCount(
    tx: Parameters<MailboxesRepository['countActive']>[0],
    orgId: number,
    row: MailboxRow,
  ): Promise<number> {
    const all = await this.repo.list(tx, orgId);
    return all.find((r) => r.id === row.id)?.conversationCount ?? 0;
  }
}
