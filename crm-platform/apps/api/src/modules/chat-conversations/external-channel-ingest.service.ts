import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';
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
    const { uuid } = await this.asTenant(orgId, () =>
      this.channels.syncExternalChannel(orgId, { ...account, connected }),
    );
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
    // A public webhook has no signed-in caller, so the tenant is set here from the route that found the account. Audit rows and
    // the thread's lifecycle write under it; without it they carry org 0 and row-level security refuses them.
    return this.asTenant(orgId, async () => {
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
    });
  }

  /** Runs `fn` under this tenant. A signed-in caller's own context is kept (its audit rows name the person); a webhook gets a system one. */
  private asTenant<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    if (RequestContextStore.peek()?.orgId === orgId) return fn();
    return RequestContextStore.run(
      {
        requestId: `ext-inbound-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
