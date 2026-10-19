import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { VIBER_API, type ViberApiFactory } from '../../infra/providers/channel-viber/viber.port';
import { INBOX_INGEST, type InboxIngest } from './_shims/tokens';
import { BATCH_GAP_MS, BATCH_SIZE, CLAIM_TIMEOUT_MINUTES, readBatch } from './broadcast-rules';
import { senderObject } from './channel-rules';
import { ChannelsRepository } from './channels.repository';
import { broadcastMessage } from './viber-message';
import { VibBroadcastsRepository, type VibBroadcastRow } from './vib-broadcasts.repository';
import type { VibBroadcastJob } from './vib-broadcasts.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  HELD_TABLES,
  SendWindowService,
  heldSummaries,
  holdRecipient,
  scheduleWake,
  splitByQuietHours,
} from '../compliance-center';
import { ConsentGate, consentSkipNote, gateRecipients } from '../contact-consent';

export type VibRunResult = 'skipped' | 'stopped' | 'done' | 'failed' | 'held';

/**
 * Sends one Viber broadcast (TW-VIB-013), run by the `viber-broadcast` worker job. Each batch is a SINGLE `broadcast_message` call for up
 * to 300 users, claimed with `FOR UPDATE SKIP LOCKED`: Viber's `failed_list` names the users it refused, everyone else is sent; a call
 * Viber rejects as a whole fails the whole batch and the broadcast (Reference). The call's message token is kept on every recipient
 * (Reference never did, so its delivered and seen receipts could not reach the broadcast), and each sent copy is mirrored into the user's
 * inbox thread. Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 *
 * Quiet hours (BL-191): a user whose contact's local time is inside the workspace's quiet hours is left out of the call and HELD, not
 * denied. They go back to `pending` with the instant they may be messaged, the rest of the batch is sent, and when only held users are
 * left a delayed job takes them up at the first opening.
 *
 * Consent (BL-141): every batch asks the ConsentGate first (purpose marketing, channel viber), so the first send is screened like a
 * release is. A user the gate refuses is left out of the call and recorded `failed` with `Not messaged: consent (<reason>)` (Viber's
 * recipient statuses have no `blocked`); the broadcast itself still ends `done`.
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
    private readonly sendWindow: SendWindowService,
    private readonly gate: ConsentGate,
    @InjectQueue(QUEUES.VIBER_BROADCAST) private readonly queue: Queue<VibBroadcastJob>,
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

    // A run visits each recipient once, in order: a person held for the quiet hours is not claimed again by this run.
    let lastId = 0;
    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE, lastId),
      );
      if (batch.length === 0) return this.finish(orgId, current);
      lastId = Math.max(...batch.map((r) => r.id));

      // Every user is asked, on the first send and on a release alike (BL-141): someone who unsubscribed, or has no recorded consent while
      // the workspace requires it, is left out of the call and recorded `failed` with the gate's reason (a retry asks the gate again).
      // Then whoever is inside the quiet hours is left out and HELD. The rest of the batch is sent.
      const gated = await gateRecipients(this.gate, orgId, batch, 'viber');
      const windows = await splitByQuietHours(this.sendWindow, orgId, gated.go);
      const send = windows.go;
      if (windows.held.length > 0 || gated.skipped.length > 0) {
        await this.db.txAs({ orgId }, async (tx) => {
          for (const h of windows.held) {
            await holdRecipient(tx, orgId, HELD_TABLES.viber, h.row.id, h.hold);
          }
          for (const s of gated.skipped) {
            await this.repo.markRecipient(tx, orgId, s.row.id, {
              status: 'failed',
              error: consentSkipNote(s.reason),
            });
          }
        });
      }
      if (send.length === 0) {
        await this.db.txAs({ orgId }, (tx) => this.repo.recompute(tx, orgId, broadcastId));
        continue;
      }

      const res = await api.broadcast(
        send.map((r) => r.userId),
        message,
      );

      if (!res.ok) {
        // The whole batch was rejected: every user in it fails, and so does the broadcast (Reference).
        const why = res.error ?? 'rejected';
        await this.db.txAs({ orgId }, async (tx) => {
          for (const r of send) {
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
        send.map((r) => r.userId),
        res.data,
      );
      const token = res.data?.message_token !== undefined ? String(res.data.message_token) : null;
      await this.db.txAs({ orgId }, async (tx) => {
        for (const r of send) {
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
        for (const r of send) {
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

  /**
   * Nothing to claim: the broadcast is done, or what is left waits. Users another worker still holds keep it sending; users held for the
   * quiet hours keep it sending too, and a delayed job comes back for them at the first opening.
   */
  private async finish(orgId: number, broadcast: VibBroadcastRow): Promise<VibRunResult> {
    const outcome = await this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, broadcast.uuid, true);
      if (!row || row.status !== 'sending') return { result: 'stopped' as const };
      await this.repo.recompute(tx, orgId, row.id);
      if ((await this.repo.pendingCount(tx, orgId, row.id)) > 0) {
        const next = (await heldSummaries(tx, orgId, HELD_TABLES.viber, [row.id])).get(
          row.id,
        )?.next;
        return next ? { result: 'held' as const, next } : { result: 'stopped' as const };
      }
      await this.repo.setStatus(tx, orgId, row.id, 'done', { markFinished: true });
      return { result: 'done' as const };
    });
    if (outcome.result === 'held') {
      await scheduleWake(
        this.queue,
        'send',
        { orgId, broadcastId: broadcast.id },
        broadcast.uuid,
        outcome.next,
        (err) =>
          this.logger.error(
            { orgId, broadcast: broadcast.uuid, err },
            'could not queue the wake-up of a Viber broadcast held for the quiet hours',
          ),
        this.sendWindow.now(),
      );
      this.logger.log(
        { orgId, broadcast: broadcast.uuid, resumeAt: outcome.next },
        '[VIB] broadcast waits: users held for the quiet hours',
      );
    }
    return outcome.result;
  }
}
