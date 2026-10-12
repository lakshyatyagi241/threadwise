import { Injectable, Logger, Optional } from '@nestjs/common';
import { OrgSuspensionService } from '../auth';

/** A customer's message that was just stored, as a domain that reacts to inbound traffic sees it. Plain data: no row, no provider shape. */
export interface InboundStoredEvent {
  orgId: number;
  /** Internal ids, for the listener's own queries in the same tenant. */
  channelId: number;
  conversationId: number;
  contactId: number | null;
  channelUuid: string;
  channelKind: string;
  conversationUuid: string;
  messageUuid: string;
  peerKey: string;
  peerName: string | null;
  createdConversation: boolean;
  /** The status the thread was reopened from (it was resolved, closed or snoozed), or null/absent when it was already live. */
  reopenedFrom?: string | null;
  message: {
    kind: 'text' | 'media' | 'location' | 'contact' | 'reaction' | 'interactive' | 'unsupported';
    body: string | null;
    meta: Record<string, unknown>;
    location: { latitude: number; longitude: number; name?: string; address?: string } | null;
    /** The key of the stored file, when the file is already in the media store. */
    mediaKey: string | null;
    /** What the customer's file is (WhatsApp's own kind, MIME type and file name), for a flow that checks the type it asked for. */
    media?: {
      kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
      mime: string;
      name?: string;
    } | null;
  };
}

/**
 * Something that reacts to a stored inbound message: the flow runtime resumes a parked run or starts one. `consumed: true` tells the
 * rest of the pipeline (an auto reply, an AI agent) that a flow took the message, so the customer is not answered twice.
 */
export interface InboundMessageListener {
  readonly name: string;
  /**
   * Runs after the listeners that do not set this (flows take a message first, then an auto answer like the catalog's concierge), and
   * learns through `prior.consumed` whether one of them already took the message, so the customer is never answered twice.
   */
  readonly after?: true;
  /** Runs before every other listener (the consent keyword check: a STOP must never reach a flow, the FAQ or an AI agent). */
  readonly first?: true;
  /**
   * Opt-in to run for a message on an email channel. Email is not a chat: a flow, keyword reply, FAQ or concierge answering every
   * mail would write back to newsletters and out-of-office replies and loop with other auto-responders. So by default a listener is
   * SKIPPED for an email message; only one that does not answer the customer (routing, translation) sets this.
   */
  readonly runsOnEmail?: true;
  onStored(
    event: InboundStoredEvent,
    prior: { consumed: boolean },
  ): Promise<{ consumed: boolean; halt?: boolean } | void>;
}

/** The message is auto-generated mail (a bounce, a list mail, an auto-reply): stored, but nothing may react to it. */
export function isAutomatedEmail(event: Pick<InboundStoredEvent, 'message'>): boolean {
  const email = event.message.meta.email as { automated?: unknown } | undefined;
  return email?.automated === true;
}

/**
 * Where listeners announce themselves (worker process only). Runs after the message's transaction has committed and the thread was
 * told, once per stored message (not for a duplicate or a reaction). A listener that throws never fails ingest: the message is safe,
 * and the failure is logged. Listeners run in registration order.
 */
@Injectable()
export class InboundMessageHooks {
  private readonly logger = new Logger(InboundMessageHooks.name);
  private readonly listeners: InboundMessageListener[] = [];

  constructor(@Optional() private readonly suspension?: OrgSuspensionService) {}

  register(listener: InboundMessageListener): void {
    if (this.listeners.some((l) => l.name === listener.name)) return;
    this.listeners.push(listener);
  }

  async run(event: InboundStoredEvent): Promise<{ consumed: boolean }> {
    // A suspended workspace still receives and stores its messages (no data loss) but nothing answers them: no flow, keyword
    // reply or AI agent starts. `consumed: true` also stops the auto reply that runs after the listeners (ADR-0019).
    if (await this.suspension?.isSuspended(event.orgId)) return { consumed: true };
    // Auto-generated mail never reaches a listener (no routing, no flow, no reply): it is stored for the agent to read and that is all.
    if (event.channelKind === 'email' && isAutomatedEmail(event)) return { consumed: true };
    let consumed = false;
    // A listener that halts (a STOP keyword) keeps every listener that answers the customer away; routing and translation, which
    // never answer, still run (those are the ones marked `runsOnEmail`).
    let halted = false;
    const onEmail = event.channelKind === 'email';
    const ordered = [
      ...this.listeners.filter((l) => l.first),
      ...this.listeners.filter((l) => !l.first && !l.after),
      ...this.listeners.filter((l) => !l.first && l.after),
    ].filter((l) => !onEmail || l.runsOnEmail);
    for (const l of ordered) {
      if (halted && !l.runsOnEmail) continue;
      try {
        const r = await l.onStored(event, { consumed });
        if (r && r.consumed) consumed = true;
        if (r && r.halt) halted = true;
      } catch (err) {
        this.logger.error({ listener: l.name, orgId: event.orgId, err }, 'inbound listener failed');
      }
    }
    return { consumed };
  }
}
