import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { VIBER_API, type ViberApiFactory } from '../../infra/providers/channel-viber/viber.port';
import { INBOX_INGEST, type InboxIngest } from './_shims/tokens';
import { BATCH_GAP_MS, BATCH_SIZE, CLAIM_TIMEOUT_MINUTES, readBatch } from './broadcast-rules';
import { senderObject } from './channel-rules';
import { ChannelsRepository } from './channels.repository';
import { broadcastMessage } from './viber-message';
import { VibBroadcastsRepository, type VibBroadcastRow } from './vib-broadcasts.repository';

export type VibRunResult = 'skipped' | 'stopped' | 'done' | 'failed';

/**
 * Sends one Viber broadcast (TW-VIB-013), run by the `viber-broadcast` worker job. Each batch is a SINGLE `broadcast_message` call for up
 * to 300 users, claimed with `FOR UPDATE SKIP LOCKED`: Viber's `failed_list` names the users it refused, everyone else is sent; a call
 * Viber rejects as a whole fails the whole batch and the broadcast (Reference). The call's message token is kept on every recipient
 * (Reference never did, so its delivered and seen receipts could not reach the broadcast), and each sent copy is mirrored into the user's
 * inbox thread. Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 */
@Injectable()
export class VibBroadcastSenderService {
  private readonly logger = new Logger(VibBroadcastSenderService.name);

  /** Replaceable in tests so a run does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: VibBroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    @Inject(VIBER_API) private readonly viber: ViberApiFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
  ) {}

  async run(orgId: number, broadcastId: number): Promise<VibRunResult> {
    const load = () => this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, broadcastId));
    let broadcast = await load();
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const channelRowId = broadcast.channelRowId;
    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.channels.findById(tx, orgId, channelRowId),
    );
    if (!channel?.active) {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.setStatus(tx, orgId, broadcastId, 'failed', {
          lastError: 'The Viber channel is unavailable.',
          markFinished: true,
        }),
      );
      return 'failed';
    }

    await this.db.txAs({ orgId }, (tx) =>
      this.repo.releaseStale(tx, orgId, broadcastId, CLAIM_TIMEOUT_MINUTES),
    );

    const api = this.viber.forToken(
      this.crypto.decrypt(channel.authToken),
      senderObject(channel.name, channel.avatar),
    );
    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const message = broadcastMessage({
      body,
      buttons: broadcast.buttons
        ? (JSON.parse(this.crypto.decrypt(broadcast.buttons)) as unknown[])
        : [],
      mediaUrl: broadcast.mediaPath,
      mediaKind: broadcast.mediaKind,
      mediaSize: broadcast.mediaSize,
    });
    const mirrorText = body !== '' ? body : broadcast.mediaKind === 'video' ? '[video]' : '[image]';

    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE),
      );
      if (batch.length === 0) return this.finish(orgId, current);

      const res = await api.broadcast(
        batch.map((r) => r.userId),
        message,
      );

      if (!res.ok) {
        // The whole batch was rejected: every user in it fails, and so does the broadcast (Reference).
        const why = res.error ?? 'rejected';
        await this.db.txAs({ orgId }, async (tx) => {
          for (const r of batch) {
            await this.repo.markRecipient(tx, orgId, r.id, { status: 'failed', error: why });
          }
          await this.repo.recompute(tx, orgId, broadcastId);
          await this.repo.setStatus(tx, orgId, broadcastId, 'failed', {
            lastError: why.slice(0, 255),
            markFinished: true,
          });
        });
        return 'failed';
      }

      const outcome = readBatch(
        batch.map((r) => r.userId),
        res.data,
      );
      const token = res.data?.message_token !== undefined ? String(res.data.message_token) : null;
      await this.db.txAs({ orgId }, async (tx) => {
        for (const r of batch) {
          const why = outcome.failed.get(r.userId);
          await this.repo.markRecipient(
            tx,
            orgId,
            r.id,
            why === undefined
              ? { status: 'sent', messageToken: token }
              : { status: 'failed', error: why },
          );
        }
        await this.repo.recompute(tx, orgId, broadcastId);
      });

      if (token !== null) {
        for (const r of batch) {
          if (outcome.failed.has(r.userId) || r.conversationId === null) continue;
          await this.mirror(
            orgId,
            current.uuid,
            r.conversationId,
            mirrorText,
            `${token}:${r.userId}`,
          );
        }
      }
      await this.sleep(BATCH_GAP_MS);
    }
  }

  /** A failure to copy into the thread never fails the send (Reference). */
  private async mirror(
    orgId: number,
    broadcastUuid: string,
    conversationId: number,
    text: string,
    providerMessageId: string,
  ): Promise<void> {
    try {
      await this.db.txAs({ orgId }, (tx) =>
        this.inbox.recordOutbound(tx, orgId, conversationId, {
          body: text,
          providerMessageId,
          broadcastUuid,
        }),
      );
    } catch (err) {
      this.logger.warn({ orgId, broadcast: broadcastUuid, err }, 'broadcast mirror failed');
    }
  }

  /** Nothing pending: the broadcast is done. Users another worker still holds keep it sending. */
  private finish(orgId: number, broadcast: VibBroadcastRow): Promise<VibRunResult> {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, broadcast.uuid, true);
      if (!row || row.status !== 'sending') return 'stopped';
      await this.repo.recompute(tx, orgId, row.id);
      if ((await this.repo.pendingCount(tx, orgId, row.id)) > 0) return 'stopped';
      await this.repo.setStatus(tx, orgId, row.id, 'done', { markFinished: true });
      return 'done';
    });
  }
}
