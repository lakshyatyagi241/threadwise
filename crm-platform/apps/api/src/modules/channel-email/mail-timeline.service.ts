import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import type { NormalisedMail } from '../../infra/providers/channel-email';
import { ContactActivitiesRepository, ContactsRepository } from '../crm';
import {
  inboundKey,
  isTimelineWorthy,
  outboundKey,
  receivedEntry,
  sentEntry,
  writesToTimeline,
  type TimelineEntry,
} from './mail-timeline-rules';
import { MailTimelineRepository } from './mail-timeline.repository';
import type { MailboxRow } from './mailboxes.repository';

export type TimelineOutcome =
  | 'written'
  /** Already on the timeline: a redelivered mail, a retried send. */
  | 'duplicate'
  /** No entry by rule: a personal mailbox, or automated mail. */
  | 'excluded'
  /** The thread has no contact (yet), so there is no timeline to put it on. */
  | 'no_contact'
  /** The write failed (logged); the mail itself is unaffected. */
  | 'failed';

/**
 * Writes the Email channel's mail onto the contact's Activity Timeline (E-19), the one place that does. A mail is a message in the inbox
 * (its own log); this adds the line a person reading the CONTACT sees: "Email received from ...: subject" with the first words of it.
 *
 * Rules (the pure ones are in `mail-timeline-rules.ts`):
 *  - one entry per mail, however often it is seen: `mail_timeline_entries` (unique per workspace) is the ledger, taken under an advisory lock;
 *  - only shared mailboxes: the timeline is visible to everyone who may read the contact, a personal mailbox's mail is not;
 *  - automated mail (auto-replies, list mail, flood-limited mail) gets no entry; bounce reports never get here (they are consumed first);
 *  - a thread with no contact has nothing to attach to (the quiet first import creates no contact); it is not written later either;
 *  - an outbound reply is `user` when a person sent it (their id is the actor) and `bot` when an automation did.
 *
 * Reading is the CRM's: the timeline route checks the caller's record scope on the contact, so who sees an entry is exactly who sees the
 * contact. NEVER throws: the mail is already stored (or sent), and a failure here must not turn into a failed sync or a failed send.
 */
@Injectable()
export class MailTimeline {
  private readonly logger = new Logger(MailTimeline.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailTimelineRepository,
    private readonly activities: ContactActivitiesRepository,
    private readonly contacts: ContactsRepository,
  ) {}

  /** A received mail that the inbox stored. `text` is the stored plain text body. */
  async recordInbound(
    orgId: number,
    mailbox: Pick<MailboxRow, 'uuid' | 'scope'>,
    stored: { conversationUuid: string },
    mail: Pick<NormalisedMail, 'providerMessageId' | 'subject' | 'from' | 'sentAt' | 'automated'>,
    text: string,
  ): Promise<TimelineOutcome> {
    if (!writesToTimeline(mailbox.scope) || !isTimelineWorthy(mail.automated)) return 'excluded';
    return this.write(
      orgId,
      inboundKey(mailbox.uuid, mail.providerMessageId),
      (tx) => this.repo.contactOfConversation(tx, orgId, stored.conversationUuid),
      receivedEntry({ subject: mail.subject, from: mail.from, text }),
      { source: 'system', actorId: null, occurredAt: mail.sentAt },
    );
  }

  /** A reply the provider accepted. `peerKey` is the thread (`t:<thread id>`) on the mailbox's channel. */
  async recordOutbound(
    orgId: number,
    mailbox: Pick<MailboxRow, 'uuid' | 'scope'>,
    sent: {
      channelUuid: string;
      peerKey: string;
      messageId: string;
      subject: string;
      to: readonly string[];
      text: string;
      /** The user who wrote the reply; null for an automation. */
      sentBy: number | null;
      at: Date;
    },
  ): Promise<TimelineOutcome> {
    if (!writesToTimeline(mailbox.scope)) return 'excluded';
    return this.write(
      orgId,
      outboundKey(mailbox.uuid, sent.messageId),
      (tx) => this.repo.contactOfThread(tx, orgId, sent.channelUuid, sent.peerKey),
      sentEntry({ subject: sent.subject, to: sent.to, text: sent.text }),
      {
        source: sent.sentBy === null ? 'bot' : 'user',
        actorId: sent.sentBy,
        occurredAt: sent.at,
      },
    );
  }

  private async write(
    orgId: number,
    key: string,
    contactOf: (tx: Tx) => Promise<number | null>,
    entry: TimelineEntry,
    by: { source: 'system' | 'user' | 'bot'; actorId: number | null; occurredAt: Date },
  ): Promise<TimelineOutcome> {
    try {
      return await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const contactId = await contactOf(tx);
        if (contactId === null) return 'no_contact' as const;
        await this.repo.lock(tx, orgId, key);
        if (await this.repo.exists(tx, orgId, key)) return 'duplicate' as const;
        const created = await this.activities.insert(tx, orgId, {
          contactId,
          activityType: entry.activityType,
          title: entry.title,
          body: entry.body,
          source: by.source,
          actorId: by.actorId,
          occurredAt: by.occurredAt,
        });
        await this.repo.link(tx, orgId, key, created.id);
        await this.contacts.bumpLastActivity(tx, orgId, contactId);
        return 'written' as const;
      });
    } catch (err) {
      this.logger.warn(
        { orgId, err: (err as Error).message },
        'the mail was stored but its contact timeline entry could not be written',
      );
      return 'failed';
    }
  }
}
