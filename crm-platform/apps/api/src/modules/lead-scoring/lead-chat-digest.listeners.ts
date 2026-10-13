import { Injectable, Logger } from '@nestjs/common';
import type { LscIntent, LscSignals } from '@crm/contracts';

/**
 * What happened when a contact's chat was read, handed to whoever registered to hear about it. Lead scoring does not know its
 * listeners (the growth pilot is one): they register at start-up and are called after the reading is stored, never inside its
 * transaction, and a listener that throws never fails the reading.
 */
export interface ChatDigestEvent {
  orgId: number;
  contactId: number;
  contactUuid: string;
  contactName: string | null;
  lifecycleStage: string;
  /** The newest thread of the contact (null when it has none the caller may name). */
  conversation: { id: number; uuid: string; assigneeUserId: number | null } | null;
  digestId: number;
  source: 'ai' | 'rules';
  trigger: 'chat' | 'manual';
  intent: LscIntent;
  signals: LscSignals;
  summary: string | null;
  score: number | null;
  reasons: string[];
  suggestedStage: string | null;
  stageConfidence: number | null;
  language: string | null;
  issue: string | null;
  /** Intents the phrase table found in the contact's button and keyword taps. */
  phraseIntents: LscIntent[];
  /** The contact asked to stop (a tap or the reading said so). */
  optOut: boolean;
}

export interface ChatDigestListener {
  readonly name: string;
  onDigest(event: ChatDigestEvent): Promise<void>;
}

@Injectable()
export class ChatDigestListeners {
  private readonly logger = new Logger(ChatDigestListeners.name);
  private readonly listeners: ChatDigestListener[] = [];

  register(listener: ChatDigestListener): void {
    if (!this.listeners.some((l) => l.name === listener.name)) this.listeners.push(listener);
  }

  async emit(event: ChatDigestEvent): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l.onDigest(event);
      } catch (err) {
        this.logger.warn(
          { orgId: event.orgId, listener: l.name, err },
          'chat digest listener failed',
        );
      }
    }
  }
}
