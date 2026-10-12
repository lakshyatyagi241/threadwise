import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  consentChannelOfKind,
  fillConsentReply,
  matchConsentKeyword,
  pickByLang,
  type ConsentChannel,
} from '@crm/contracts';
import {
  CONVERSATIONS_FACADE,
  InboundMessageHooks,
  type ConversationsFacade,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../chat-conversations';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentSettingsService } from './consent-settings.service';
import { ContactConsentService } from './consent.service';

/** The test channel is a WhatsApp stand-in; every other kind maps through the contract (null: no marketing there). */
export function consentChannelFor(kind: string): ConsentChannel | null {
  return kind === 'simulator' ? 'whatsapp' : consentChannelOfKind(kind);
}

/**
 * STOP / START on the shared inbound path (spec section 6). Runs FIRST, before flows, FAQ and AI, so a STOP is never answered by a
 * bot. Cheap by construction: a message that is not a short text returns before any lookup, and the workspace's compiled keyword set
 * is cached in the process (no query on the hot path). Worker only, like every inbound listener.
 */
@Injectable()
export class ConsentKeywordListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'consent-keyword';
  readonly first = true as const;
  private readonly logger = new Logger(ConsentKeywordListener.name);

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly settings: ConsentSettingsService,
    private readonly ledger: ContactConsentService,
    private readonly db: DatabaseService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(e: InboundStoredEvent): Promise<{ consumed: boolean; halt?: boolean }> {
    // Cheap exits first: not a text, too long to be a keyword, a thread with no contact (a group, an unknown number the cap refused).
    const body = e.message.kind === 'text' ? e.message.body : null;
    if (!body || body.length > 400 || e.contactId === null) return { consumed: false };
    const channel = consentChannelFor(e.channelKind);
    if (!channel) return { consumed: false };

    const s = await this.settings.effective(e.orgId);
    if (!s.detectionEnabled) return { consumed: false };
    const m = matchConsentKeyword(body, s.compiled);
    if (!m) return { consumed: false };

    const contactId = e.contactId;
    const outcome = await RequestContextStore.run(
      {
        requestId: `consent-${e.messageUuid}`,
        orgId: e.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
          this.ledger.recordInTx(tx, e.orgId, {
            contactId,
            channel,
            action: m.action === 'opt_out' ? 'withdrawn' : 'granted',
            source: 'keyword',
            evidence: { messageId: e.messageUuid, keyword: m.keyword },
            idempotencyKey: `keyword:${e.messageUuid}`,
            announceOptIn: true,
          }),
        ),
    );

    // One confirmation, only when the state really changed: a repeated STOP (or a flood of them) is not answered again.
    if (outcome.recorded && outcome.stateChanged && s.autoReplyEnabled) {
      const template = pickByLang(m.action === 'opt_out' ? s.optOutReply : s.optInReply, m.lang);
      const text = fillConsentReply(template, { name: e.peerName });
      if (text !== '') await this.reply(e, text);
    }
    // A keyword is never also an input for a flow, the FAQ or an AI agent.
    return { consumed: true, halt: true };
  }

  private async reply(e: InboundStoredEvent, body: string): Promise<void> {
    try {
      await RequestContextStore.run(
        {
          requestId: `consent-reply-${randomUUID()}`,
          orgId: e.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () =>
          this.conversations.enqueueOutbound({
            conversationId: e.conversationUuid,
            // One confirmation per customer message, however often the job is retried.
            clientMessageId: deterministicUuid(`consent-${e.messageUuid}`),
            content: { kind: 'text', body },
            sender: { kind: 'bot' },
          }),
      );
    } catch (err) {
      // The opt-out is already recorded and is what matters; a failed confirmation (closed window, channel down) is logged only.
      this.logger.warn(
        { orgId: e.orgId, err: err instanceof Error ? err.message : String(err) },
        'consent confirmation could not be queued',
      );
    }
  }
}

/** A stable uuid-shaped id from a string (the outbound path wants a uuid as the client's message id). */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
