import { Injectable, Logger } from '@nestjs/common';
import {
  WA_CHAT_LINK_DIGITS_MAX,
  WA_CHAT_LINK_DIGITS_MIN,
  type SaveWaChatLinkInput,
  type WaChatLink,
  type WaChatLinkList,
  type WaChatLinkListQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { buildWaUrl, isLinkLive, toWaChatLinkResponse } from './wa-chat-links.mapper';
import { WaChatLinksRepository } from './wa-chat-links.repository';

const MODULE_KEY = 'wa_chat_links';

@Injectable()
export class WaChatLinksService {
  private readonly logger = new Logger(WaChatLinksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WaChatLinksRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** E.164 length guard: combined country+number digits must be 7–15 (TW-WFL-014). */
  private assertDigits(countryCode: string, phoneNumber: string): { countryCode: string; phoneNumber: string } {
    const countryDigits = countryCode.replace(/\D/g, '');
    const numberDigits = phoneNumber.replace(/\D/g, '');
    const total = countryDigits.length + numberDigits.length;
    if (total < WA_CHAT_LINK_DIGITS_MIN || total > WA_CHAT_LINK_DIGITS_MAX) {
      throw AppError.validation('Enter a valid phone number with country code.', [
        { path: 'phoneNumber', message: `Combined digits must be ${WA_CHAT_LINK_DIGITS_MIN}–${WA_CHAT_LINK_DIGITS_MAX}.` },
      ]);
    }
    return { countryCode: `+${countryDigits}`, phoneNumber: numberDigits };
  }

  async list(query: WaChatLinkListQuery): Promise<WaChatLinkList> {
    const ctx = RequestContextStore.require();
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    return this.db.tx(async (tx) => {
      const [rows, stats] = await Promise.all([
        this.repo.list(tx, ctx.orgId, query.limit, query.status, cursor),
        this.repo.stats(tx, ctx.orgId),
      ]);
      const { items, page } = buildPage(
        rows.map((r) => ({ ...r, createdAt: r.created_at, createdAtIso: r.created_at_iso })),
        query.limit,
      );
      return { items: items.map(toWaChatLinkResponse), stats, page };
    });
  }

  async get(uuid: string): Promise<WaChatLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Link', uuid);
      return toWaChatLinkResponse(row);
    });
  }

  async create(input: SaveWaChatLinkInput): Promise<WaChatLink> {
    const ctx = RequestContextStore.require();
    const { countryCode, phoneNumber } = this.assertDigits(input.countryCode, input.phoneNumber);
    return this.db.tx(async (tx) => {
      const slug = await this.repo.freshSlug(tx, input.slug || WaChatLinksRepository.randomSlug());
      const created = await this.repo.insert(tx, ctx.orgId, ctx.userId ?? null, {
        name: input.name,
        slug,
        countryCode,
        phoneNumber,
        welcomeMessage: input.welcomeMessage ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: input.status,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'wa_chat_link.created',
        payload: { uuid: created.uuid, slug: created.slug },
      });
      return toWaChatLinkResponse(created);
    });
  }

  async update(uuid: string, input: SaveWaChatLinkInput): Promise<WaChatLink> {
    const ctx = RequestContextStore.require();
    const { countryCode, phoneNumber } = this.assertDigits(input.countryCode, input.phoneNumber);
    return this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!before) throw AppError.notFound('Link', uuid);
      const expectedVersion = input.rowVersion ?? before.row_version;
      const updated = await this.repo.update(tx, ctx.orgId, before.id, expectedVersion, {
        name: input.name,
        countryCode,
        phoneNumber,
        welcomeMessage: input.welcomeMessage ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: input.status,
      });
      if (!updated) throw AppError.rowVersionConflict('Link');
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: before.id,
        action: 'update',
        delta: this.audit.diff(
          before as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.id,
        eventType: 'wa_chat_link.updated',
        payload: { uuid: before.uuid },
      });
      return toWaChatLinkResponse(updated);
    });
  }

  async duplicate(uuid: string): Promise<WaChatLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const source = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!source) throw AppError.notFound('Link', uuid);
      const slug = await this.repo.freshSlug(tx, WaChatLinksRepository.randomSlug());
      const copy = await this.repo.duplicate(tx, ctx.orgId, ctx.userId ?? null, source, slug);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: copy.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: copy.id,
        eventType: 'wa_chat_link.created',
        payload: { uuid: copy.uuid, duplicatedFrom: source.uuid },
      });
      return toWaChatLinkResponse(copy);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Link', uuid);
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'wa_chat_link.deleted',
        payload: { uuid: row.uuid },
      });
    });
  }

  /**
   * Public redirect (`GET /l/:slug`, unauthenticated, TW-WFL-017): 404 missing, 410 paused/expired, else bump the
   * click counter and return the `wa.me` URL to redirect to. Runs outside any tenant transaction — see
   * `WaChatLinksRepository.lookupPublic`/`recordClickPublic`.
   */
  async resolvePublic(slug: string): Promise<{ waUrl: string } | { notFound: true } | { gone: true }> {
    const row = await this.repo.lookupPublic(this.db.primary, slug);
    if (!row) return { notFound: true };
    if (!isLinkLive(row.status, row.expires_at)) return { gone: true };
    // A failed click count must never stop the visitor from reaching wa.me — log and continue.
    try {
      await this.repo.recordClickPublic(this.db.primary, row.id);
    } catch (err) {
      this.logger.warn({ err: String(err), linkId: row.id }, 'wa_chat_link click count failed');
    }
    return { waUrl: buildWaUrl(row.country_code, row.phone_number, row.welcome_message) };
  }
}
