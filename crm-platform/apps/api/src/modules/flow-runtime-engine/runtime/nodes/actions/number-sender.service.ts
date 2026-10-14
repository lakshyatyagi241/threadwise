import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../../../common/errors/app-error';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { ChannelError } from '../../../../../infra/providers/chat-conversations';
import { ChatMediaStore } from '../../../../../infra/providers/chat-conversations/media';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import {
  CONVERSATIONS_FACADE,
  ChannelDispatcher,
  ChannelRegistryService,
  type ConversationsFacade,
} from '../../../../chat-conversations';
import { profileOf, renderForChannel } from '../../channel-render';
import { envelopeFor } from '../../flow-sender.service';
import type { OutboundMessage, RunState, SendOutcome } from '../../types';

/**
 * Writes one message to a number that is not the run's customer (the Copy-to-number node, TW-FLR-038), through the run's own channel
 * and the same dispatcher guards as every other send (connected, capable, emergency halt, content screen, one send per client
 * reference).
 *
 * Differences from the customer send, all on purpose: nothing is recorded on the customer's conversation (the copy is not part of
 * their thread); the 24 hour window is read from the TARGET number's own thread with the business (a colleague who never wrote to the
 * channel has none, so on the Cloud API the send is refused and the node notes it, which is what Meta would do to Reference too); and a
 * failure never halts the run, it is only reported (Reference: "never blocks the flow, a bad number just logs and advances").
 */
@Injectable()
export class NumberSender {
  private readonly logger = new Logger(NumberSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly fetcher: SafeFetch,
    private readonly media: ChatMediaStore,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async send(
    run: RunState,
    to: string,
    message: OutboundMessage,
    clientReference: string,
  ): Promise<SendOutcome> {
    if (!run.channelUuid || !run.channelKind) {
      return {
        ok: false,
        code: 'FLR_NO_CHANNEL',
        error: 'The channel this run sends through is gone',
        halt: false,
      };
    }
    try {
      const rendered = renderForChannel(message, profileOf(run.channelKind));
      const channelUuid = run.channelUuid;
      const { runtime, lastInboundAt } = await this.db.txAs({ orgId: run.orgId }, async (tx) => {
        const row = await this.channels.row(tx, run.orgId, channelUuid);
        return {
          runtime: await this.channels.runtime(tx, run.orgId, row),
          lastInboundAt:
            (await this.conversations.findThread(channelUuid, to))?.lastInboundAt ?? null,
        };
      });
      const envelope = await envelopeFor(
        this.fetcher,
        this.media,
        run.orgId,
        to,
        rendered,
        clientReference,
      );
      const sent = await this.dispatcher.send({
        channel: runtime,
        envelope,
        lastInboundAt,
        source: 'flow',
        // A note to a colleague's number: not a message to a customer, never marketing. The gate still sees it.
        consent: { purpose: 'service_messaging' },
      });
      if (!sent.replayed) await this.dispatcher.scheduleReceipts(runtime, sent);
      return { ok: true };
    } catch (err) {
      if (err instanceof AppError || err instanceof ChannelError) {
        return { ok: false, code: err.code, error: err.message, halt: false };
      }
      this.logger.warn({ err }, '[FLR] a copy to a number failed unexpectedly');
      return {
        ok: false,
        code: 'FLR_SEND_ERROR',
        error: err instanceof Error ? err.message : 'The message could not be sent',
        halt: false,
      };
    }
  }
}
