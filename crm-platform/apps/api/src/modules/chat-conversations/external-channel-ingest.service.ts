import { Injectable } from '@nestjs/common';
import type { NormalisedInbound } from '../../infra/providers/chat-conversations';
import { ChannelRegistryService } from './channel-registry.service';
import { InboundIngestService, type IngestOutcome } from './inbound-ingest.service';

/** The account of another domain (a Facebook Page, an Instagram account, a Telegram bot) that carries the thread. */
export interface ExternalAccount {
  kind: string;
  /** The provider's id for the account: one channel per (kind, externalId). */
  externalId: string;
  name: string;
  displayAddress: string | null;
}

/**
 * The door for domains that own their own webhook (Facebook, Instagram, Telegram) and want their messages in the inbox. It keeps the
 * account's channel in step and stores one message through the same pipeline a Cloud API webhook feeds, so threads, unread counts,
 * the 24 hour window and realtime behave the same. The caller has already authenticated the sender and found the workspace.
 */
@Injectable()
export class ExternalChannelIngest {
  constructor(
    private readonly channels: ChannelRegistryService,
    private readonly ingest: InboundIngestService,
  ) {}

  /** Creates the channel the first time and keeps its name, address and status current. Returns its uuid. */
  async sync(orgId: number, account: ExternalAccount, connected: boolean): Promise<string> {
    const { uuid } = await this.channels.syncExternalChannel(orgId, { ...account, connected });
    return uuid;
  }

  /**
   * Stores one inbound message. There is no queue between the webhook and this call, so a failed file download is final: the message is
   * stored without the file rather than lost.
   */
  async inbound(
    orgId: number,
    account: ExternalAccount,
    message: NormalisedInbound,
  ): Promise<IngestOutcome & { channelUuid: string }> {
    const channelUuid = await this.sync(orgId, account, true);
    const outcome = await this.ingest.ingest(
      {
        orgId,
        channelUuid,
        message: { ...message, providerTimestamp: message.providerTimestamp.toISOString() },
      },
      { finalAttempt: true },
    );
    return { ...outcome, channelUuid };
  }
}
