import { Injectable, Logger } from '@nestjs/common';

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
  onStored(event: InboundStoredEvent): Promise<{ consumed: boolean } | void>;
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

  register(listener: InboundMessageListener): void {
    if (this.listeners.some((l) => l.name === listener.name)) return;
    this.listeners.push(listener);
  }

  async run(event: InboundStoredEvent): Promise<{ consumed: boolean }> {
    let consumed = false;
    for (const l of this.listeners) {
      try {
        const r = await l.onStored(event);
        if (r && r.consumed) consumed = true;
      } catch (err) {
        this.logger.error({ listener: l.name, orgId: event.orgId, err }, 'inbound listener failed');
      }
    }
    return { consumed };
  }
}
