import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactNotesRepository, ContactsRepository } from '../crm';
import {
  ChatDigestListeners,
  type ChatDigestEvent,
  type ChatDigestListener,
} from '../lead-scoring';
import { GrowthActionsService } from './growth-actions.service';
import { GrowthAutomationService } from './growth-automation.service';
import { GrowthGateService } from './growth-gate.service';
import { GrowthRepository } from './growth.repository';
import { isHotLead, statusFacts } from './growth.rules';

const INTENT_KEY = 'ai_intent';

/**
 * Hears about every reading of a contact's chat (lead scoring calls it after the reading is stored) and turns it into the useful
 * side effects of the growth pilot. Each one is its own switch; a workspace outside the pilot, or with the part off, is ignored before
 * anything is read. One failing step never stops the next (lead scoring also guards the call as a whole).
 */
@Injectable()
export class GrowthDigestListener implements ChatDigestListener, OnModuleInit {
  readonly name = 'growth-pilot';
  private readonly logger = new Logger(GrowthDigestListener.name);

  constructor(
    private readonly registry: ChatDigestListeners,
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    private readonly gate: GrowthGateService,
    private readonly actions: GrowthActionsService,
    private readonly automation: GrowthAutomationService,
    private readonly contactsRepo: ContactsRepository,
    private readonly contactNotes: ContactNotesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onDigest(e: ChatDigestEvent): Promise<void> {
    const ctx = await this.gate.load(e.orgId);
    if (!ctx.available) return;
    const f = ctx.features;
    const step = async (name: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (err) {
        this.logger.warn(
          { orgId: e.orgId, contactId: e.contactId, step: name, err },
          'growth step failed',
        );
      }
    };
    const contact = await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
      this.repo.contactCore(tx, e.orgId, e.contactId),
    );
    if (!contact) return;
    const hot = isHotLead(e, ctx.config);
    const wantsToBuy =
      e.signals.readyToBuy ||
      e.signals.askedPrice ||
      e.intent === 'ready_to_buy' ||
      e.intent === 'asking_price';

    if (f.intent_fields) await step('intent', () => this.writeIntent(e, contact.data));
    if (f.language_detect && e.language && e.conversation) {
      await step('language', async () => {
        await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
          this.repo.setConversationLanguage(tx, e.orgId, e.conversation!.id, e.language!),
        );
      });
    }
    if (f.auto_notes && e.source === 'ai' && e.summary) await step('note', () => this.writeNote(e));

    if (f.hot_lead_alerts && hot) {
      await step('hot lead', async () => {
        const made = await this.actions.raise(e.orgId, {
          type: 'hot_lead',
          contactId: e.contactId,
          conversationId: e.conversation?.id ?? null,
          digestId: e.digestId,
          severity: 'urgent',
          title: `Hot lead: ${contact.name ?? 'a contact'} is ready to buy`,
          detail: e.summary,
          payload: { score: e.score, intent: e.intent },
          dedupeKey: `hot_lead:${e.contactId}`,
        });
        if (!made) return;
        // The person who has the thread, else the contact's owner.
        const target = e.conversation?.assigneeUserId ?? contact.ownerId;
        if (target !== null) {
          await this.actions.notify(e.orgId, target, {
            title: 'Hot lead',
            body: e.summary ?? `${contact.name ?? 'A contact'} looks ready to buy.`,
            conversationUuid: e.conversation?.uuid ?? null,
            dedupeKey: `growth_hot:${e.contactId}:${e.digestId}`,
            contactName: contact.name,
          });
        }
      });
    }

    if (
      f.purchase_routing &&
      wantsToBuy &&
      e.conversation &&
      e.conversation.assigneeUserId === null
    ) {
      await step('routing', async () => {
        const owner =
          contact.ownerId !== null
            ? await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
                this.repo.userById(tx, e.orgId, contact.ownerId!),
              )
            : null;
        const target =
          owner ??
          (await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
            this.repo.leastBusyUser(tx, e.orgId),
          ));
        if (!target) return;
        await this.actions.raise(e.orgId, {
          type: 'purchase_route',
          contactId: e.contactId,
          conversationId: e.conversation!.id,
          digestId: e.digestId,
          severity: 'attention',
          title: `Give ${contact.name ?? 'this contact'} to ${target.name}`,
          detail: e.summary,
          payload: {
            userId: target.uuid,
            userName: target.name,
            reason: owner ? 'owner' : 'least_busy',
          },
          dedupeKey: `purchase_route:${e.conversation!.id}`,
        });
      });
    }

    if (f.optout_detection && e.optOut && !contact.isUnsubscribed) {
      await step('opt out', async () => {
        await this.actions.raise(e.orgId, {
          type: 'opt_out',
          contactId: e.contactId,
          conversationId: e.conversation?.id ?? null,
          digestId: e.digestId,
          severity: 'attention',
          title: `${contact.name ?? 'A contact'} asked to stop`,
          detail: e.summary,
          payload: {},
          dedupeKey: `opt_out:${e.contactId}`,
        });
      });
    }

    if (
      f.registration_check &&
      e.issue &&
      ['missing_confirmation', 'payment_problem', 'wrong_info'].includes(e.issue)
    ) {
      await step('registration', async () => {
        const facts = await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
          this.repo.registrationFacts(tx, e.orgId, e.contactId),
        );
        await this.actions.raise(e.orgId, {
          type: 'registration_issue',
          contactId: e.contactId,
          conversationId: e.conversation?.id ?? null,
          digestId: e.digestId,
          severity: 'attention',
          title: `${contact.name ?? 'A contact'} reports a problem with their registration`,
          detail: e.summary,
          payload: { issue: e.issue, groups: facts.groups, lastSend: facts.lastSend },
          dedupeKey: `registration_issue:${e.contactId}:${e.issue}`,
        });
      });
    }

    if (f.status_reply && e.intent === 'post_purchase' && ctx.config.statusFields.length > 0) {
      await step('status reply', async () => {
        const facts = statusFacts(contact.data, ctx.config.statusFields);
        if (facts.length === 0) return;
        await this.actions.raise(e.orgId, {
          type: 'status_reply',
          contactId: e.contactId,
          conversationId: e.conversation?.id ?? null,
          digestId: e.digestId,
          severity: 'info',
          title: `${contact.name ?? 'A contact'} asked about their order`,
          detail: null,
          payload: { facts },
          dedupeKey: `status_reply:${e.contactId}`,
        });
      });
    }

    if (f.auto_stage || f.engagement_stage_rules) {
      await step('auto stage', () => this.automation.autoStageFor(e.orgId, ctx, e.contactId));
    }
  }

  /** `ai_intent` on the contact, so a flow with a field_match trigger can react to what the chat is about. */
  private async writeIntent(e: ChatDigestEvent, data: Record<string, unknown>): Promise<void> {
    if (data[INTENT_KEY] === e.intent) return;
    await this.db.txAs({ orgId: e.orgId, userId: null }, async (tx) => {
      if (!(await this.repo.propertyKeyExists(tx, e.orgId, INTENT_KEY))) return;
      const ok = await this.contactsRepo.updateFieldsById(tx, e.orgId, e.contactId, {
        data: { ...data, [INTENT_KEY]: e.intent },
      });
      if (!ok) return;
      await this.audit.record(tx, {
        module: 'contacts',
        recordId: e.contactId,
        action: 'update',
        delta: { [INTENT_KEY]: { old: data[INTENT_KEY] ?? null, new: e.intent } },
      });
      // `via: 'growth'` keeps lead scoring from queueing another score for a write it made itself.
      await this.outbox.emit(tx, {
        orgId: e.orgId,
        aggregateModule: 'contacts',
        aggregateId: e.contactId,
        eventType: 'contact.updated',
        payload: { uuid: e.contactUuid, via: 'growth', fieldKeys: [INTENT_KEY] },
      });
    });
  }

  /** The reading's summary as a note on the contact, once per distinct summary. */
  private async writeNote(e: ChatDigestEvent): Promise<void> {
    const body = `AI chat summary: ${e.summary}`.slice(0, 2000);
    await this.db.txAs({ orgId: e.orgId, userId: null }, async (tx) => {
      const last = await tx.execute(sql`
        SELECT body FROM contact_notes WHERE org_id = ${e.orgId} AND contact_id = ${e.contactId} AND created_by IS NULL
          AND body LIKE 'AI chat summary:%' ORDER BY id DESC LIMIT 1`);
      if ((last.rows[0] as { body?: string } | undefined)?.body === body) return;
      const created = await this.contactNotes.insert(tx, e.orgId, {
        contactId: e.contactId,
        body,
        createdBy: null,
      });
      await this.contactsRepo.bumpLastActivity(tx, e.orgId, e.contactId);
      await this.audit.record(tx, {
        module: 'contact_notes',
        recordId: created.id,
        action: 'insert',
      });
      await this.outbox.emit(tx, {
        orgId: e.orgId,
        aggregateModule: 'contact_notes',
        aggregateId: created.id,
        eventType: 'contact_note.created',
        payload: { uuid: created.uuid },
      });
    });
  }
}
