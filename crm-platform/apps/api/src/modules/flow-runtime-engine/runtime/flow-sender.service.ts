import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { ChannelError } from '../../../infra/providers/chat-conversations';
import { ChatMediaStore, mimeForKey } from '../../../infra/providers/chat-conversations/media';
import { SafeFetch } from '../../../infra/providers/node-bridge-runtime/safe-fetch';
import {
  CONVERSATIONS_FACADE,
  ChannelDispatcher,
  ChannelRegistryService,
  type ConversationsFacade,
} from '../../chat-conversations';
import { CapTally, DEFAULT_PACING } from '../caps';
import { profileOf, renderForChannel, threadTextOf, type Rendered } from './channel-render';
import type { OutboundMessage, RunState, SendOutcome } from './types';

/** What a customer's file looks like inside a variable: the media store key, never a public link. */
export const CHAT_MEDIA_PREFIX = 'chatmedia:';

/** How long a channel that is down or capped is left alone before the run tries again. */
export const HALT_RETRY_MS = 5 * 60_000;

const HALT_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.CHANNEL_DISCONNECTED,
  ERROR_CODES.AUTH_SEND_HALTED,
]);

/**
 * Sends one flow message to the customer (TW-FLR-019, 020): renders it for the channel (degrading what the channel cannot show),
 * checks the unofficial engine's daily cap, passes it through the channel dispatcher (connected, capable, window open, emergency
 * halt and content screen, one send per client reference) and records it on the thread as `source = flow`.
 *
 * The client reference is `flow:<run>:<step>:<index>`, so a step that runs twice (a crash after the send) sends nothing the second
 * time: the dispatcher replays the stored answer and the thread's ledger ignores the repeat.
 *
 * Reference never failed a flow for a send problem and never retried one: a dead socket or a full cap left the run stuck until a timer
 * deleted it, and a Meta rejection was only a log line. Here a channel that is down or capped HALTS the run (it tries again by
 * itself), and any other refusal is returned to the node, which decides: a prompt the customer never got ends the run `failed`
 * with the reason, a plain message is skipped and noted in the run log.
 */
@Injectable()
export class FlowSender {
  private readonly logger = new Logger(FlowSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly tally: CapTally,
    private readonly fetcher: SafeFetch,
    private readonly media: ChatMediaStore,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async send(run: RunState, message: OutboundMessage, index: number): Promise<SendOutcome> {
    if (!run.channelUuid || !run.channelKind) {
      return {
        ok: false,
        code: 'FLR_NO_CHANNEL',
        error: 'The channel this run sends through is gone',
        halt: false,
      };
    }
    try {
      const profile = profileOf(run.channelKind);
      const rendered = renderForChannel(message, profile);

      const deviceId = run.channelKind === 'whatsapp_qr' ? await this.deviceOf(run) : null;
      if (deviceId !== null) {
        const used = await this.tally.sentToday(run.orgId, 'baileys', deviceId);
        if (used >= DEFAULT_PACING.baileysDailyCap) {
          return {
            ok: false,
            code: 'FLR_DAILY_CAP',
            error: `The daily limit of ${DEFAULT_PACING.baileysDailyCap} messages for this number is reached`,
            halt: true,
          };
        }
      }

      const { runtime, lastInboundAt } = await this.db.txAs({ orgId: run.orgId }, async (tx) => {
        const row = await this.channels.row(tx, run.orgId, run.channelUuid!);
        return {
          runtime: await this.channels.runtime(tx, run.orgId, row),
          lastInboundAt:
            (await this.conversations.findThread(run.channelUuid!, run.peerKey))?.lastInboundAt ??
            null,
        };
      });

      const clientReference = `flow:${run.uuid}:${run.stepSeq}:${index}`;
      const envelope = await this.envelopeOf(run, rendered, clientReference);
      const sent = await this.dispatcher.send({
        channel: runtime,
        envelope,
        lastInboundAt,
        source: 'flow',
      });
      await this.conversations.recordOutbound({
        channelId: run.channelUuid,
        peerKey: run.peerKey,
        ...(run.contactUuid ? { contactId: run.contactUuid } : {}),
        source: 'flow',
        body: threadTextOf(rendered),
        providerMessageId: sent.providerMessageId,
      });
      if (!sent.replayed) await this.dispatcher.scheduleReceipts(runtime, sent);
      // One tick per node that sends, not per message: a Message with five replies counts once (TW-FLR-020 rule 4).
      if (deviceId !== null && index === 0) await this.tally.bump(run.orgId, 'baileys', deviceId);
      return { ok: true };
    } catch (err) {
      return this.outcomeOf(err);
    }
  }

  private outcomeOf(err: unknown): SendOutcome {
    if (err instanceof AppError) {
      return { ok: false, code: err.code, error: err.message, halt: HALT_CODES.has(err.code) };
    }
    if (err instanceof ChannelError) {
      // A provider that may be back in a minute halts the run; one that refused the message for good does not.
      return { ok: false, code: err.code, error: err.message, halt: err.retryable };
    }
    this.logger.warn({ err }, '[FLR] a send failed unexpectedly');
    return {
      ok: false,
      code: 'FLR_SEND_ERROR',
      error: err instanceof Error ? err.message : 'The message could not be sent',
      halt: false,
    };
  }

  /** The device behind a QR channel: its external id is the device uuid. */
  private async deviceOf(run: RunState): Promise<number | null> {
    return this.db.txAs({ orgId: run.orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT d.id FROM channels c JOIN devices d ON d.org_id = c.org_id AND d.uuid::text = c.external_id
        WHERE c.org_id = ${run.orgId} AND c.id = ${run.channelId}`);
      const row = (res as unknown as { rows: Array<{ id: number | string }> }).rows[0];
      return row ? Number(row.id) : null;
    });
  }

  private envelopeOf(run: RunState, r: Rendered, clientReference: string): Promise<unknown> {
    return envelopeFor(this.fetcher, this.media, run.orgId, run.peerKey, r, clientReference);
  }
}

/**
 * The outbound envelope to `to`. A file is fetched through the guarded fetcher and stored once: the envelope carries a key, never a
 * link. Shared with the nodes that write to a number other than the customer (TW-FLR-038).
 */
export async function envelopeFor(
  fetcher: SafeFetch,
  media: ChatMediaStore,
  orgId: number,
  to: string,
  r: Rendered,
  clientReference: string,
): Promise<unknown> {
  const common = { to, clientReference };
  switch (r.kind) {
    case 'text':
      return { ...common, kind: 'text', body: r.body };
    case 'location':
      return { ...common, kind: 'location', location: r.location };
    case 'interactive':
      return { ...common, kind: 'interactive', interactive: r.interactive };
    case 'template':
      return { ...common, kind: 'template', template: r.template };
    case 'media': {
      // A file the customer sent earlier in this run (`chatmedia:<key>`) is already in the media store: send it as it is.
      if (r.url.startsWith(CHAT_MEDIA_PREFIX)) {
        const key = r.url.slice(CHAT_MEDIA_PREFIX.length);
        return {
          ...common,
          kind: 'media',
          media: {
            key,
            mediaKind: r.mediaKind,
            mime: mimeForKey(key) ?? 'application/octet-stream',
            ...(r.filename ? { name: r.filename } : {}),
            ...(r.caption ? { caption: r.caption } : {}),
          },
        };
      }
      const got = await fetcher.fetchMedia(r.url);
      const filename = r.filename || `file${got.extension}`;
      const stored = await media.store({
        orgId,
        filename,
        buffer: got.buffer,
      });
      return {
        ...common,
        kind: 'media',
        media: {
          key: stored.key,
          mediaKind: r.mediaKind === 'audio' ? 'audio' : r.mediaKind,
          mime: stored.mime,
          name: stored.name,
          sha256: stored.sha256,
          ...(r.caption ? { caption: r.caption } : {}),
        },
      };
    }
  }
}
