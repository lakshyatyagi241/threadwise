import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { FacebookPagesRepository } from '../channel-facebook';
import {
  LEAD_SOURCE_DIRECTORY,
  type LeadSourceDirectoryPort,
} from '../leads/lead-source-directory.port';
import { MetaLeadAdsRepository } from './meta-lead-ads.repository';
import { sourceRefOf } from './meta-lead-rules';

/**
 * A Facebook Page was disconnected from the Facebook channel: its lead sync goes with it. Each picked form's lead source is released
 * (through the lead pipeline's directory, which removes the source and the leads stored under it; contacts stay), then the Page's own
 * rows. Nothing else is left to receive from: the Page's token is gone, so no lead can be fetched.
 *
 * Idempotent, and safe against a Page that was connected AGAIN before this ran: a Page that is back is left alone. Runs in the worker
 * under the event's own tenant, never privileged.
 */
@Injectable()
export class PageDisconnectConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'meta-lead-ads-page-disconnect';
  readonly eventTypes = ['facebook.page.disconnected'] as const;
  private readonly logger = new Logger(PageDisconnectConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MetaLeadAdsRepository,
    private readonly pages: FacebookPagesRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @Inject(LEAD_SOURCE_DIRECTORY) private readonly directory: LeadSourceDirectoryPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const pageId = typeof event.payload.pageId === 'string' ? event.payload.pageId : null;
    if (!pageId) return;
    const orgId = event.orgId;
    const { back, forms } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      back: Boolean(await this.pages.findByPageId(tx, orgId, pageId)),
      forms: await this.repo.listForms(tx, orgId, pageId),
    }));
    if (back) return;
    for (const f of forms) {
      await this.directory.releaseConnectorSource(orgId, sourceRefOf(pageId, f.formId));
    }
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      for (const f of forms) await this.repo.deleteForm(tx, orgId, pageId, f.formId);
      await this.repo.deletePage(tx, orgId, pageId);
    });
    this.logger.log({ orgId, pageId, forms: forms.length }, 'lead sync removed with its Page');
  }
}
