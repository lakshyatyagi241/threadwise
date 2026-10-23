import { Injectable, Logger } from '@nestjs/common';

/** A delivery step the provider reported for a message WE sent, as a domain that reacts to it sees it. Plain data: no row, no provider shape. */
export interface MessageStatusEvent {
  orgId: number;
  /** Internal ids, for the listener's own queries in the same tenant. */
  channelId: number;
  conversationId: number;
  channelUuid: string;
  channelKind: string;
  peerKey: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  /** The template the message sent, when it was one (its row, or only its name when a flow sent it); null for any other message. */
  templateId: number | null;
  templateName: string | null;
  /** When the message was stored: a listener ties a step to the message it sent by this and the template. */
  messageCreatedAt: Date;
}

/** Something that reacts to a delivery step of an outbound message (the flow runtime resumes a Template node that waits for it). */
export interface MessageStatusListener {
  readonly name: string;
  onStatus(event: MessageStatusEvent): Promise<void>;
}

/**
 * Where listeners announce themselves for delivery steps (worker process only). Runs after the receipt's transaction has committed and
 * only for a receipt that moved the message forward (a late or repeated one is not news). A listener that throws never fails the
 * receipt: the status is safe, and the failure is logged.
 */
@Injectable()
export class MessageStatusHooks {
  private readonly logger = new Logger(MessageStatusHooks.name);
  private readonly listeners: MessageStatusListener[] = [];

  register(listener: MessageStatusListener): void {
    if (!this.listeners.some((l) => l.name === listener.name)) this.listeners.push(listener);
  }

  async run(event: MessageStatusEvent): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l.onStatus(event);
      } catch (err) {
        this.logger.warn({ err, listener: l.name }, 'a delivery-status listener failed');
      }
    }
  }
}
