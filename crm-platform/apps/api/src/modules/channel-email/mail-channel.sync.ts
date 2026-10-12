import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { ExternalChannelIngest } from '../chat-conversations';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

export const MAIL_CHANNEL_KIND = 'email';

/** The inbox channel of a mailbox, as the inbox core keeps it. One per mailbox: the channel's external id is the mailbox's uuid. */
export const channelAccountOf = (row: Pick<MailboxRow, 'uuid' | 'address'>) => ({
  kind: MAIL_CHANNEL_KIND,
  externalId: row.uuid,
  name: row.address,
  displayAddress: row.address,
});

/** A mailbox that cannot be refreshed or has been disconnected is a read-only inbox; one that merely failed a sync can still send. */
export const channelConnected = (status: MailboxRow['status']): boolean =>
  status === 'connected' || status === 'error';

/**
 * Keeps the mailbox's inbox channel (kind `email`) in step with the mailbox (TW-MAIL-019): created when the mailbox is first connected,
 * switched off when it is disconnected or needs reconnecting, switched on again by a reconnect. The conversations stay on the channel.
 * Best effort for the caller: the mailbox row is already saved, and the next sync repairs a failed step.
 */
@Injectable()
export class MailChannelSync {
  private readonly logger = new Logger(MailChannelSync.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly ingest: ExternalChannelIngest,
  ) {}

  /** Returns the channel uuid, or null when it could not be synced right now. */
  async sync(orgId: number, row: MailboxRow): Promise<string | null> {
    try {
      const channelUuid = await this.ingest.sync(
        orgId,
        channelAccountOf(row),
        channelConnected(row.status),
      );
      if (row.channelUuid !== channelUuid) {
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.setChannel(tx, orgId, row.id, channelUuid),
        );
      }
      return channelUuid;
    } catch (err) {
      this.logger.warn({ err, orgId, mailbox: row.uuid }, 'email inbox channel not synced');
      return null;
    }
  }
}
