import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  computeSalesDoc,
  ERROR_CODES,
  formatPercent,
  formatQty,
  minorToMajor,
  type ConvertToDealInput,
  type ConvertToDealResponse,
  type CreateSalesDocInput,
  type DuplicateSalesDocInput,
  type ExtendSalesDocInput,
  type ListLinkedSalesDocsQuery,
  type ListSalesDocEventsQuery,
  type ListSalesDocsQuery,
  type PageResponse,
  type RecordScope,
  type ReviseSalesDocInput,
  type SalesDocCountsQuery,
  type SalesDocCountsResponse,
  type SalesDocDiscount,
  type SalesDocEvent,
  type SalesDocKind,
  type SalesDocResponse,
  type SalesDocRevision,
  type SalesDocRevisionDetail,
  type SalesDocShareLink,
  type SalesDocSource,
  type SalesDocStatus,
  type SalesDocSummary,
  type SendSalesDocInput,
  type SendSalesDocResponse,
  type StaffDecisionInput,
  type UpdateSalesDocInput,
  type WireContent,
  type WireLine,
  type RegenerateLinkInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage, encodeCursor } from '../../../common/pagination/cursor';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  MAIL_PORT,
  MailError,
  type MailPort,
} from '../../../infra/providers/auth-registration-security/mail.port';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { DealEngine } from '../deals/deal-engine.service';
import { onTop } from '../deals/deal-ordering';
import { stampsForKind } from '../deals/deal-rules';
import { DealsRepository } from '../deals/deals.repository';
import { DealsService } from '../deals/deals.service';
import { PipelinesRepository } from '../pipelines/pipelines.repository';
import { composeQuoteMail } from './sales-doc-mail';
import {
  SALES_DOC_INVOICE_PORT,
  type InvoiceDraftSource,
  type SalesDocInvoicePort,
} from './sales-doc-ports';
import { renderSalesDocHtml } from './sales-doc-render';
import {
  addDays,
  formatNumber,
  generateToken,
  hashToken,
  isDeletable,
  isEditable,
  nextStatus,
  prefixFor,
  startFor,
} from './sales-doc-rules';
import { discountOf, toEventResponse, toSummary, totalsOf, toLine } from './sales-docs.mapper';
import {
  salesDocScopeCondition,
  type NewSalesDocItem,
  type SalesDocFilter,
  type SalesDocItemRow,
  type SalesDocRow,
} from './sales-docs.repository';
import { SalesDocsSupport } from './sales-docs.support';
import { canActOn } from '../../../kernel/rbac/scope';

const emptyPage = <T>(limit: number): PageResponse<T> => ({
  data: [],
  page: { nextCursor: null, hasMore: false, limit },
});

interface FilterInput {
  kind?: SalesDocKind;
  status?: SalesDocStatus[];
  q?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  ownerId?: string;
  mine?: boolean;
  currency?: string;
  validFrom?: string;
  validTo?: string;
}

interface CreateOptions {
  source: SalesDocSource;
  duplicatedFromId?: number;
  duplicatedFromNumber?: string;
  /** Skip the default template: a duplicate keeps what the original said. */
  noTemplate?: boolean;
}

/**
 * Proposals and estimates (TW-PROP / TW-EST). One transaction per operation: the row lock, the write, the timeline row, the audit
 * row and the outbox event commit together or not at all.
 *
 * What differs from Reference (all in the inventory's "Port decisions"): a draft is edited whole (Reference could only change the
 * status), a sent document is revised not edited, every status change goes through a guarded machine with a timeline, numbers come
 * from a locked counter and are never reused, the public link is a hashed, expiring, revocable token, and an expired document cannot
 * be accepted.
 */
@Injectable()
export class SalesDocsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly support: SalesDocsSupport,
    private readonly rbac: RbacService,
    private readonly contacts: ContactsRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly deals: DealsService,
    private readonly dealEngine: DealEngine,
    private readonly pipelines: PipelinesRepository,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MAIL_PORT) private readonly mail: MailPort | undefined,
    @Optional()
    @Inject(SALES_DOC_INVOICE_PORT)
    private readonly invoicing: SalesDocInvoicePort | undefined,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  private readonly appName: string;
  private get repo() {
    return this.support.repo;
  }

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(
    query: ListSalesDocsQuery,
    scope: RecordScope,
  ): Promise<PageResponse<SalesDocSummary>> {
    return this.db.tx((tx) => this.listIn(tx, query, scope, {}));
  }

  /** A contact's documents (TW-PROP-025): needs record.contacts.read on the contact, whose own scope applies. */
  async forContact(contactUuid: string, query: ListLinkedSalesDocsQuery, scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      await assertContactScope(tx, this.contacts, ctx.orgId, read.scope, ctx.userId!, contact);
      return this.listIn(tx, query, scope, { contactId: contact.id });
    });
  }

  /** A deal's documents: needs record.deals.read on the deal, whose own scope applies. */
  async forDeal(dealUuid: string, query: ListLinkedSalesDocsQuery, scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.dealsRepo.findByUuid(tx, ctx.orgId, dealUuid);
      if (!deal) throw AppError.notFound('Deal', dealUuid);
      const read = this.rbac.can(ctx.grants!, 'record.deals.read');
      if (!read.allowed) throw AppError.forbidden('record.deals.read');
      await this.deals.assertScope(tx, read.scope, deal);
      return this.listIn(tx, query, scope, { dealId: deal.id });
    });
  }

  async counts(query: SalesDocCountsQuery, scope: RecordScope): Promise<SalesDocCountsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = await this.resolveFilter(tx, ctx.orgId, query, {});
      const empty = {
        draft: 0,
        sent: 0,
        viewed: 0,
        accepted: 0,
        declined: 0,
        expired: 0,
        converted: 0,
      };
      if (!filter) return { total: 0, byStatus: empty, openValue: [] };
      const c = await this.repo.counts(
        tx,
        ctx.orgId,
        filter,
        salesDocScopeCondition(ctx.orgId, scope, ctx.userId),
      );
      const byStatus = { ...empty, ...c.byStatus } as SalesDocCountsResponse['byStatus'];
      return {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        openValue: c.open
          .sort((a, b) => a.currency.localeCompare(b.currency))
          .map((o) => ({ currency: o.currency, amount: minorToMajor(o.minor, o.currency) })),
      };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Document', uuid);
      await this.assertScope(tx, scope, row);
      return this.support.response(tx, ctx.orgId, row);
    });
  }

  async events(
    uuid: string,
    query: ListSalesDocEventsQuery,
    scope: RecordScope,
  ): Promise<PageResponse<SalesDocEvent>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      const rows = await this.repo.listEvents(tx, ctx.orgId, row.id, query);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((e) => toEventResponse(e, this.eventPlain(e))),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  createdAt: last.createdAt,
                  id: last.id,
                  createdAtIso: last.createdAtIso,
                })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  /** One event with its drawn signature (the list only says whether there is one). */
  async event(uuid: string, eventUuid: string, scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      const e = await this.repo.eventByUuid(tx, ctx.orgId, row.id, eventUuid);
      if (!e) throw AppError.notFound('Event', eventUuid);
      return {
        ...toEventResponse(e, this.eventPlain(e)),
        signature: this.support.decrypt(e.signatureCipher, 'signature'),
      };
    });
  }

  async revisions(uuid: string, scope: RecordScope): Promise<SalesDocRevision[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      return (await this.repo.revisions(tx, ctx.orgId, row.id)).map((r) => ({
        revision: r.revision,
        status: r.status,
        totalMinor: r.totalMinor.toString(),
        createdBy: r.createdByUuid ? { id: r.createdByUuid, name: r.createdByName ?? '' } : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async revision(
    uuid: string,
    revision: number,
    scope: RecordScope,
  ): Promise<SalesDocRevisionDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      const r = (await this.repo.revisions(tx, ctx.orgId, row.id)).find(
        (x) => x.revision === revision,
      );
      if (!r) throw AppError.notFound('Revision', String(revision));
      const snap = r.snapshot as unknown as RevisionSnapshot;
      return {
        revision: r.revision,
        status: r.status,
        totalMinor: r.totalMinor.toString(),
        createdBy: r.createdByUuid ? { id: r.createdByUuid, name: r.createdByName ?? '' } : null,
        createdAt: r.createdAt.toISOString(),
        snapshot: {
          title: snap.title,
          currency: snap.currency,
          taxRate: snap.taxRate,
          discount: snap.discount,
          validUntil: snap.validUntil,
          notes: this.support.decrypt(snap.notesCipher, 'revision notes'),
          terms: snap.terms,
          lines: snap.lines,
          totals: snap.totals,
        },
      };
    });
  }

  /** The printable page (see sales-doc-render.ts: HTML to print or save as PDF). */
  async printHtml(uuid: string, scope: RecordScope): Promise<string> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      const doc = await this.support.response(tx, ctx.orgId, row);
      const profile = await this.repo.orgProfile(tx, ctx.orgId);
      return renderSalesDocHtml({
        kind: doc.kind,
        number: doc.number,
        title: doc.title,
        statusLabel: doc.status,
        sellerName: profile.name || this.appName,
        buyerName: doc.buyer.name,
        buyerCompany: doc.company?.name ?? null,
        currency: doc.currency,
        lines: doc.lines,
        totals: doc.totals,
        discount: doc.discount,
        taxRate: doc.taxRate,
        notes: doc.notes,
        terms: doc.terms,
        validUntil: doc.validUntil,
        signedBy: null,
      });
    });
  }

  // --- create / edit / duplicate / delete ----------------------------------------------------------------------------

  async create(
    input: CreateSalesDocInput,
    source: SalesDocSource = 'manual',
  ): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.createIn(tx, ctx.orgId, ctx.userId, input, { source });
      return this.support.response(tx, ctx.orgId, row);
    });
  }

  async update(
    uuid: string,
    input: UpdateSalesDocInput,
    scope: RecordScope,
  ): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Document');
      // The full edit of TW-PROP-027: Reference's PATCH changed the status and nothing else.
      if (!isEditable(row.status)) {
        throw new AppError(
          ERROR_CODES.SALESDOC_NOT_EDITABLE,
          `A ${row.status} document is not edited in place. Revise it first.`,
          HttpStatus.CONFLICT,
          [{ path: 'status', message: row.status }],
        );
      }
      const items = (await this.repo.items(tx, ctx.orgId, [row.id])).get(row.id) ?? [];
      const patch: Record<string, unknown> = {};
      const changed: string[] = [];

      if (input.title !== undefined && (input.title || null) !== row.title) {
        patch.title = input.title || null;
        changed.push('title');
      }
      // Links: a record that is not in the workspace is 404.
      if (input.contactId !== undefined) {
        const contact = input.contactId
          ? await this.requireContact(tx, ctx.orgId, input.contactId)
          : null;
        if ((contact?.id ?? null) !== row.contactId) {
          patch.contact_id = contact?.id ?? null;
          changed.push('contact');
        }
        if (contact) {
          const wantsBuyer =
            input.buyerName === undefined &&
            input.buyerEmail === undefined &&
            input.buyerPhone === undefined;
          if (wantsBuyer) {
            patch.buyer_name = this.support.encrypt(contact.name);
            patch.buyer_email = this.support.encrypt(contact.email);
            patch.buyer_phone = this.support.encrypt(contact.phone);
            changed.push('buyer');
          }
          if (
            input.companyId === undefined &&
            contact.companyId !== null &&
            row.companyId === null
          ) {
            patch.company_id = contact.companyId;
          }
        }
      }
      if (input.companyId !== undefined) {
        const company = input.companyId
          ? await this.requireCompany(tx, ctx.orgId, input.companyId)
          : null;
        if ((company?.id ?? null) !== row.companyId) {
          patch.company_id = company?.id ?? null;
          changed.push('company');
        }
      }
      if (input.dealId !== undefined) {
        const deal = input.dealId ? await this.requireDeal(tx, ctx.orgId, input.dealId) : null;
        if ((deal?.id ?? null) !== row.dealId) {
          patch.deal_id = deal?.id ?? null;
          changed.push('deal');
        }
      }
      if (input.ownerId !== undefined) {
        const owner = input.ownerId ? await this.requireOwner(tx, ctx.orgId, input.ownerId) : null;
        if (owner !== row.ownerId) {
          patch.owner_id = owner;
          changed.push('owner');
        }
      }
      for (const [key, col, label] of [
        ['buyerName', 'buyer_name', 'buyer'],
        ['buyerEmail', 'buyer_email', 'buyer'],
        ['buyerPhone', 'buyer_phone', 'buyer'],
      ] as const) {
        if (input[key] !== undefined) {
          patch[col] = this.support.encrypt(input[key]);
          if (!changed.includes(label)) changed.push(label);
        }
      }
      if (input.notes !== undefined) {
        patch.notes = this.support.encrypt(input.notes);
        changed.push('notes');
      }
      if (input.terms !== undefined) {
        patch.terms = input.terms || null;
        changed.push('terms');
      }
      if (input.validUntil !== undefined) {
        patch.valid_until = input.validUntil;
        changed.push('validUntil');
      }

      // Money: any of currency, tax rate, discount or lines reprices the whole document.
      const repriced =
        input.lines !== undefined ||
        input.currency !== undefined ||
        input.taxRate !== undefined ||
        input.discount !== undefined;
      if (repriced) {
        if (
          input.currency !== undefined &&
          input.currency !== row.currency &&
          input.lines === undefined
        ) {
          throw AppError.validation('A new currency needs the lines priced in it', [
            { path: 'lines', message: 'send the lines together with a new currency' },
          ]);
        }
        const currency = input.currency ?? row.currency;
        const wire: WireContent = {
          currency,
          taxRate:
            input.taxRate !== undefined ? (input.taxRate ?? '0') : formatPercent(row.taxRateBp),
          discount:
            input.discount !== undefined
              ? (input.discount ?? null)
              : discountOf(row.discountKind, row.discountValue, row.currency),
          lines: input.lines ?? items.map((i) => wireLineOf(i, row.currency)),
        };
        const priced = this.price(wire);
        Object.assign(patch, {
          currency: priced.currency,
          currency_exponent: priced.exponent,
          tax_rate_bp: priced.defaultTaxRateBp,
          discount_kind: priced.discount.kind,
          discount_value: priced.discount.value,
          subtotal_minor: priced.subtotalMinor,
          discount_minor: priced.discountMinor,
          tax_minor: priced.taxMinor,
          total_minor: priced.totalMinor,
        });
        changed.push('pricing');
        await this.repo.replaceItems(
          tx,
          ctx.orgId,
          row.id,
          this.itemRows(priced, input.lines ?? items.map((i) => ({ description: i.description }))),
        );
      }

      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Document');
      }
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      if (changed.length > 0) {
        // The trail says which parts changed, never what the buyer or the notes say.
        await this.support.record(
          tx,
          after,
          { type: 'edited', actorKind: 'user', actorUserId: ctx.userId, meta: { changed } },
          {
            audit: {
              action: 'update',
              delta: Object.fromEntries(changed.map((k) => [k, { old: true, new: true }])),
            },
            outbox: { type: 'salesdoc.updated', extra: { changed } },
          },
        );
      }
      return this.support.response(tx, ctx.orgId, after);
    });
  }

  /** A new draft with the same lines (and, when asked, as the other kind): new number, new link, nothing of the sending history. */
  async duplicate(uuid: string, input: DuplicateSalesDocInput): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Document', uuid);
      const read = this.rbac.can(ctx.grants!, 'record.sales-docs.read');
      if (!read.allowed) throw AppError.forbidden('record.sales-docs.read');
      await this.assertScope(tx, read.scope, row);
      const items = (await this.repo.items(tx, ctx.orgId, [row.id])).get(row.id) ?? [];
      const plain = this.support.plain(row);
      const profile = await this.repo.orgProfile(tx, ctx.orgId);
      const today = todayIn(resolveTimezone(profile.timezone));
      const copy = await this.createIn(
        tx,
        ctx.orgId,
        ctx.userId,
        {
          kind: input.kind ?? row.kind,
          title: row.title,
          buyerName: plain.buyerName,
          buyerEmail: plain.buyerEmail,
          buyerPhone: plain.buyerPhone,
          contactId: row.contactUuid,
          companyId: row.companyUuid,
          dealId: row.dealUuid,
          currency: row.currency,
          taxRate: formatPercent(row.taxRateBp),
          discount: discountOf(row.discountKind, row.discountValue, row.currency),
          // A date already past would be an expired copy: keep it only while it is still ahead.
          validUntil: row.validUntil && row.validUntil >= today ? row.validUntil : null,
          notes: plain.notes,
          terms: row.terms,
          lines: items.map((i) => wireLineOf(i, row.currency)),
        },
        {
          source: 'manual',
          duplicatedFromId: row.id,
          duplicatedFromNumber: row.number,
          noTemplate: true,
        },
      );
      return this.support.response(tx, ctx.orgId, copy);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (!isDeletable(row.status)) {
        throw new AppError(
          ERROR_CODES.SALESDOC_NOT_DELETABLE,
          `A ${row.status} document is evidence and cannot be deleted.`,
          HttpStatus.CONFLICT,
          [{ path: 'status', message: row.status }],
        );
      }
      await this.support.record(
        tx,
        row,
        { type: 'edited', actorKind: 'user', actorUserId: ctx.userId, meta: { deleted: true } },
        {
          audit: {
            action: 'delete',
            delta: {
              number: { old: row.number, new: null },
              status: { old: row.status, new: null },
            },
          },
          outbox: { type: 'salesdoc.deleted' },
        },
      );
      await this.repo.deleteById(tx, ctx.orgId, row.id);
    });
  }

  // --- sending ---------------------------------------------------------------------------------------------------------

  async send(
    uuid: string,
    input: SendSalesDocInput,
    scope: RecordScope,
  ): Promise<SendSalesDocResponse> {
    const ctx = RequestContextStore.require();

    // Phase 1: validate, make sure the link works, find the recipient. Commits before any mail leaves (never hold a transaction
    // open across an SMTP call).
    const prep = await this.db.tx(async (tx) => {
      let row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Document');
      nextStatus(row.status, 'send');
      const settings = await this.repo.settings(tx, ctx.orgId);
      const now = new Date();
      let token = this.support.decrypt(row.publicTokenCipher, 'public_token');
      const dead =
        !token ||
        row.tokenRevokedAt !== null ||
        (row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= now.getTime());
      if (dead) {
        token = generateToken();
        await this.repo.update(tx, ctx.orgId, row.id, undefined, {
          public_token_hash: hashToken(token),
          public_token_cipher: this.support.encrypt(token),
          token_revoked_at: null,
          token_expires_at: ttlExpiry(settings.linkTtlDays, now),
        });
        row = (await this.repo.findById(tx, ctx.orgId, row.id))!;
        await this.support.record(
          tx,
          row,
          {
            type: 'link_regenerated',
            actorKind: 'user',
            actorUserId: ctx.userId,
            meta: { reason: 'send' },
          },
          { audit: { action: 'update', delta: { link: { old: 'inactive', new: 'new' } } } },
        );
      }
      const plain = this.support.plain(row);
      let to: string | null = null;
      if (input.channel === 'email') {
        to = (input.to ?? plain.buyerEmail ?? '').trim();
        if (!EMAIL_RE.test(to)) {
          throw new AppError(
            ERROR_CODES.SALESDOC_NO_RECIPIENT,
            'There is no buyer email to send to.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'to', message: 'an email address' }],
          );
        }
      } else if (input.channel === 'whatsapp') {
        to = (input.to ?? plain.buyerPhone ?? '').trim();
        if (!E164_RE.test(to)) {
          throw new AppError(
            ERROR_CODES.SALESDOC_NO_RECIPIENT,
            'There is no buyer phone number (E.164) to send to.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'to', message: 'an E.164 number such as +919876543210' }],
          );
        }
      }
      const profile = await this.repo.orgProfile(tx, ctx.orgId);
      return { row, token: token!, to, plain, sellerName: profile.name || this.appName, settings };
    });

    // Phase 2: the mail (a failure leaves the document as it was).
    if (input.channel === 'email') {
      if (!this.mail) {
        throw new AppError(
          ERROR_CODES.SALESDOC_SEND_FAILED,
          'Email is not configured on this deployment.',
          HttpStatus.BAD_GATEWAY,
        );
      }
      const mail = composeQuoteMail({
        kindLabel: prep.row.kind === 'estimate' ? 'Estimate' : 'Proposal',
        number: prep.row.number,
        title: prep.row.title,
        sellerName: prep.sellerName,
        buyerName: prep.plain.buyerName,
        currency: prep.row.currency,
        totalMajor: minorToMajor(prep.row.totalMinor, prep.row.currency),
        validUntil: prep.row.validUntil,
        link: this.support.urlFor(prep.token),
        message: input.message ?? null,
      });
      try {
        await this.mail.send({ to: prep.to!, ...mail });
      } catch (err) {
        const reason = err instanceof MailError ? err.reason : 'transport_error';
        throw new AppError(
          ERROR_CODES.SALESDOC_SEND_FAILED,
          'The email could not be sent.',
          HttpStatus.BAD_GATEWAY,
          [{ path: 'channel', message: reason }],
        );
      }
    }

    // Phase 3: the transition.
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      const from = row.status;
      const to = nextStatus(from, 'send');
      const now = new Date();
      const patch: Record<string, unknown> = { status: to };
      if (!row.sentAt) patch.sent_at = now;
      if (row.tokenExpiresAt === null && !row.sentAt)
        patch.token_expires_at = ttlExpiry(prep.settings.linkTtlDays, now);
      await this.repo.update(tx, ctx.orgId, row.id, undefined, patch);
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      const resend = row.sentAt !== null;
      await this.support.record(
        tx,
        after,
        {
          type: 'sent',
          actorKind: 'user',
          actorUserId: ctx.userId,
          fromStatus: from,
          toStatus: to,
          channel: input.channel,
          meta: { resend, to: prep.to ? maskRecipient(prep.to) : null },
        },
        {
          audit: {
            action: 'update',
            delta: { status: { old: from, new: to }, channel: { old: null, new: input.channel } },
          },
          outbox: { type: 'salesdoc.sent', extra: { channel: input.channel, resend } },
        },
      );
      if (input.channel === 'whatsapp') {
        // TODO(messaging): the WhatsApp delivery belongs to the messaging domain. It subscribes to this event, reads the document and
        // its link through SalesDocsService, sends a template message (outside the 24 h window) and records the result. Nothing is
        // delivered until it does; the document is marked sent so the timeline says "WhatsApp requested".
        await this.support.record(
          tx,
          after,
          {
            type: 'sent',
            actorKind: 'system',
            channel: 'whatsapp',
            meta: { delivery: 'requested' },
          },
          { outbox: { type: 'salesdoc.delivery_requested', extra: { channel: 'whatsapp' } } },
        );
      }
      const link = this.support.link(after)!;
      return {
        document: await this.support.response(tx, ctx.orgId, after),
        delivery: {
          channel: input.channel,
          status:
            input.channel === 'email' ? 'sent' : input.channel === 'whatsapp' ? 'queued' : 'shared',
          to: prep.to ? maskRecipient(prep.to) : null,
        },
        link,
      };
    });
  }

  // --- decisions, revision, extension -------------------------------------------------------------------------------

  /** Staff record the buyer's decision (a signed copy, a phone call): in the timeline as theirs. */
  async accept(
    uuid: string,
    input: StaffDecisionInput,
    scope: RecordScope,
  ): Promise<SalesDocResponse> {
    return this.decide(uuid, 'accept', input, scope);
  }

  async decline(
    uuid: string,
    input: StaffDecisionInput,
    scope: RecordScope,
  ): Promise<SalesDocResponse> {
    return this.decide(uuid, 'decline', input, scope);
  }

  private async decide(
    uuid: string,
    action: 'accept' | 'decline',
    input: StaffDecisionInput,
    scope: RecordScope,
  ) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Document');
      const to = nextStatus(row.status, action);
      const profile = await this.repo.orgProfile(tx, ctx.orgId);
      // An open document past its date is expired in fact: staff extend or revise it rather than accept a lapsed price.
      if (isLapsed(row, profile.timezone)) {
        throw new AppError(
          ERROR_CODES.SALESDOC_EXPIRED,
          'This document is past its valid-until date. Extend it first.',
          HttpStatus.CONFLICT,
        );
      }
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        status: to,
        decided_at: new Date(),
        accepted_revision: action === 'accept' ? row.revision : null,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: action === 'accept' ? 'accepted' : 'declined',
          actorKind: 'user',
          actorUserId: ctx.userId,
          fromStatus: row.status,
          toStatus: to,
          commentCipher: this.support.encrypt(input.note),
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          meta: { recordedByStaff: true },
        },
        {
          audit: { action: 'update', delta: { status: { old: row.status, new: to } } },
          outbox: {
            type: action === 'accept' ? 'salesdoc.accepted' : 'salesdoc.declined',
            extra: { by: 'staff' },
          },
        },
      );
      return this.support.response(tx, ctx.orgId, after);
    });
  }

  /**
   * Back to a draft to change what was sent (TW-PROP-029): the content of the current revision is kept in the revision history and
   * the revision number goes up. An accepted document is final: a changed offer is a new document (duplicate).
   */
  async revise(
    uuid: string,
    input: ReviseSalesDocInput,
    scope: RecordScope,
  ): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Document');
      const to = nextStatus(row.status, 'revise');
      const items = (await this.repo.items(tx, ctx.orgId, [row.id])).get(row.id) ?? [];
      await this.repo.insertRevision(tx, ctx.orgId, {
        docId: row.id,
        revision: row.revision,
        status: row.status,
        snapshot: snapshotOf(row, items),
        totalMinor: row.totalMinor,
        createdBy: ctx.userId,
      });
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        status: to,
        revision: row.revision + 1,
        decided_at: null,
        accepted_revision: null,
        // The next revision is "viewed" again when the buyer opens it.
        first_viewed_at: null,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: 'revised',
          actorKind: 'user',
          actorUserId: ctx.userId,
          fromStatus: row.status,
          toStatus: to,
          meta: { fromRevision: row.revision, toRevision: after.revision },
        },
        {
          audit: {
            action: 'update',
            delta: {
              status: { old: row.status, new: to },
              revision: { old: row.revision, new: after.revision },
            },
          },
          outbox: { type: 'salesdoc.revised', extra: { fromRevision: row.revision } },
        },
      );
      return this.support.response(tx, ctx.orgId, after);
    });
  }

  /** A new valid-until date. An expired document becomes open again (viewed when the buyer had opened it, else sent). */
  async extend(
    uuid: string,
    input: ExtendSalesDocInput,
    scope: RecordScope,
  ): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Document');
      const to = nextStatus(row.status, 'extend', { everViewed: row.firstViewedAt !== null });
      const profile = await this.repo.orgProfile(tx, ctx.orgId);
      if (input.validUntil < todayIn(resolveTimezone(profile.timezone))) {
        throw AppError.validation('The new date is already past', [
          { path: 'validUntil', message: 'a date from today on' },
        ]);
      }
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        status: to,
        valid_until: input.validUntil,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: 'extended',
          actorKind: 'user',
          actorUserId: ctx.userId,
          fromStatus: row.status,
          toStatus: to,
          meta: { from: row.validUntil, to: input.validUntil },
        },
        {
          audit: {
            action: 'update',
            delta: {
              validUntil: { old: row.validUntil, new: input.validUntil },
              status: { old: row.status, new: to },
            },
          },
          outbox: { type: 'salesdoc.extended' },
        },
      );
      return this.support.response(tx, ctx.orgId, after);
    });
  }

  // --- the link ----------------------------------------------------------------------------------------------------------

  async getLink(uuid: string, scope: RecordScope): Promise<SalesDocShareLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.visible(tx, uuid, scope);
      void ctx;
      const link = this.support.link(row);
      if (!link) throw AppError.notFound('Link', uuid);
      return link;
    });
  }

  /** A new token; the old link stops working at once. Works on any document (a draft's link goes live when it is sent). */
  async regenerateLink(
    uuid: string,
    input: RegenerateLinkInput,
    scope: RecordScope,
  ): Promise<SalesDocShareLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      const settings = await this.repo.settings(tx, ctx.orgId);
      const token = generateToken();
      const now = new Date();
      const expires =
        input.expiresInDays === undefined
          ? ttlExpiry(settings.linkTtlDays, now)
          : input.expiresInDays === null
            ? null
            : ttlExpiry(input.expiresInDays, now);
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        public_token_hash: hashToken(token),
        public_token_cipher: this.support.encrypt(token),
        token_revoked_at: null,
        token_expires_at: expires,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: 'link_regenerated',
          actorKind: 'user',
          actorUserId: ctx.userId,
          meta: { expiresAt: expires?.toISOString() ?? null },
        },
        { audit: { action: 'update', delta: { link: { old: 'previous', new: 'new' } } } },
      );
      return this.support.link(after)!;
    });
  }

  async revokeLink(uuid: string, scope: RecordScope): Promise<SalesDocShareLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.tokenRevokedAt === null) {
        await this.repo.update(tx, ctx.orgId, row.id, undefined, { token_revoked_at: new Date() });
        const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
        await this.support.record(
          tx,
          after,
          { type: 'link_revoked', actorKind: 'user', actorUserId: ctx.userId },
          { audit: { action: 'update', delta: { link: { old: 'active', new: 'revoked' } } } },
        );
        return this.support.link(after)!;
      }
      return this.support.link(row)!;
    });
  }

  // --- conversion --------------------------------------------------------------------------------------------------------

  /**
   * An accepted document becomes an invoice draft through the invoicing port, in this transaction: the invoice, the link back and the
   * status `converted` commit together (Reference: separate writes, a crash between them left a second conversion possible, and a
   * failed render was swallowed). Idempotent per document: converting twice is 409 SALESDOC_ALREADY_CONVERTED, never a second invoice.
   */
  async convertToInvoice(uuid: string, scope: RecordScope): Promise<SalesDocResponse> {
    const ctx = RequestContextStore.require();
    if (!this.invoicing) {
      throw new AppError(
        ERROR_CODES.SALESDOC_INVOICING_UNAVAILABLE,
        'Invoicing is not available on this deployment yet.',
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    const port = this.invoicing;
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.invoiceId !== null || row.status === 'converted') {
        throw new AppError(
          ERROR_CODES.SALESDOC_ALREADY_CONVERTED,
          'This document was already converted to an invoice.',
          HttpStatus.CONFLICT,
        );
      }
      const to = nextStatus(row.status, 'convert_invoice');
      const items = (await this.repo.items(tx, ctx.orgId, [row.id])).get(row.id) ?? [];
      const plain = this.support.plain(row);
      const source: InvoiceDraftSource = {
        orgId: ctx.orgId,
        salesDocId: row.id,
        salesDocUuid: row.uuid,
        salesDocNumber: row.number,
        kind: row.kind,
        revision: row.revision,
        currency: row.currency,
        exponent: row.currencyExponent,
        buyer: { name: plain.buyerName, email: plain.buyerEmail, phone: plain.buyerPhone },
        contactId: row.contactId,
        companyId: row.companyId,
        dealId: row.dealId,
        notes: plain.notes,
        terms: row.terms,
        lines: items.map((i) => ({
          position: i.position,
          description: i.description,
          qty: formatQty(parseQtyScaled(i.qty)),
          unitPriceMinor: i.unitPriceMinor,
          discountMinor: i.discountMinor,
          netMinor: i.netMinor,
          taxRateBp: i.taxRateBp ?? row.taxRateBp,
          taxMinor: i.taxMinor,
        })),
        totals: {
          subtotalMinor: row.subtotalMinor,
          discountMinor: row.discountMinor,
          taxMinor: row.taxMinor,
          totalMinor: row.totalMinor,
        },
        idempotencyKey: `salesdoc:${row.uuid}:invoice`,
      };
      const invoice = await port.createDraftFromSalesDoc(tx, source);
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        status: to,
        invoice_id: invoice.invoiceId,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: 'converted_invoice',
          actorKind: 'user',
          actorUserId: ctx.userId,
          fromStatus: row.status,
          toStatus: to,
          meta: { invoiceNumber: invoice.invoiceNumber ?? null },
        },
        {
          audit: {
            action: 'update',
            delta: {
              status: { old: row.status, new: to },
              invoice: { old: null, new: invoice.invoiceUuid },
            },
          },
          outbox: {
            type: 'salesdoc.converted',
            extra: { to: 'invoice', invoiceId: invoice.invoiceUuid },
          },
        },
      );
      return this.support.response(tx, ctx.orgId, after);
    });
  }

  /** A deal from the document (TW-PROP-025): its title and total, the document's contact and company, in the default pipeline's first stage. */
  async convertToDeal(
    uuid: string,
    input: ConvertToDealInput,
    scope: RecordScope,
  ): Promise<ConvertToDealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.dealId !== null) {
        throw new AppError(
          ERROR_CODES.SALESDOC_ALREADY_LINKED_DEAL,
          'This document is already linked to a deal.',
          HttpStatus.CONFLICT,
        );
      }
      const pipeline = input.pipelineId
        ? await this.pipelines.pipelineByUuid(tx, ctx.orgId, input.pipelineId)
        : await this.pipelines.defaultPipeline(tx, ctx.orgId);
      if (!pipeline) throw AppError.notFound('Pipeline', input.pipelineId);
      let stage = undefined as Awaited<ReturnType<PipelinesRepository['firstStage']>>;
      if (input.stageId) {
        stage = await this.pipelines.stageByUuid(tx, ctx.orgId, input.stageId);
        if (!stage) throw AppError.notFound('Stage', input.stageId);
      } else {
        stage = await this.pipelines.firstStage(tx, ctx.orgId, pipeline.id);
      }
      if (!stage) {
        throw new AppError(
          ERROR_CODES.DEAL_NO_OPEN_STAGE,
          'This pipeline has no stages.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (stage.pipelineId !== pipeline.id) {
        throw new AppError(
          ERROR_CODES.DEAL_STAGE_MISMATCH,
          'The stage belongs to another pipeline.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const stamps = stampsForKind(stage.kind, null, new Date());
      const created = await this.dealsRepo.insert(tx, ctx.orgId, {
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: row.contactId,
        companyId: row.companyId,
        title: (input.title ?? (row.title ? `${row.number} ${row.title}` : row.number)).slice(
          0,
          191,
        ),
        valueMinor: row.totalMinor,
        currency: row.currency,
        ownerUserId: row.ownerId ?? ctx.userId,
        expectedCloseDate: row.validUntil,
        status: stamps.status,
        lostReason: null,
        source: 'manual',
        sortOrder: onTop(await this.dealsRepo.minOrder(tx, ctx.orgId, stage.id)),
        notes: null,
        wonAt: stamps.wonAt,
        lostAt: stamps.lostAt,
      });
      const deal = (await this.dealsRepo.findById(tx, ctx.orgId, created.id))!;
      await this.dealEngine.recordCreated(tx, deal);
      await this.repo.update(tx, ctx.orgId, row.id, undefined, { deal_id: created.id });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: 'converted_deal',
          actorKind: 'user',
          actorUserId: ctx.userId,
          meta: { dealId: deal.uuid },
        },
        {
          audit: { action: 'update', delta: { deal: { old: null, new: deal.uuid } } },
          outbox: { type: 'salesdoc.converted', extra: { to: 'deal', dealId: deal.uuid } },
        },
      );
      return {
        document: await this.support.response(tx, ctx.orgId, after),
        deal: { id: deal.uuid, title: deal.title },
      };
    });
  }

  // --- internals ---------------------------------------------------------------------------------------------------------

  private async listIn(
    tx: Tx,
    query: ListSalesDocsQuery | ListLinkedSalesDocsQuery,
    scope: RecordScope,
    fixed: { contactId?: number; dealId?: number },
  ): Promise<PageResponse<SalesDocSummary>> {
    const ctx = RequestContextStore.require();
    const filter = await this.resolveFilter(tx, ctx.orgId, query as FilterInput, fixed);
    if (!filter) return emptyPage(query.limit);
    const rows = await this.repo.list(tx, ctx.orgId, {
      filter,
      scope: salesDocScopeCondition(ctx.orgId, scope, ctx.userId),
      cursor: query.cursor,
      limit: query.limit,
    });
    const { items, page } = buildPage(rows, query.limit);
    const profile = await this.repo.orgProfile(tx, ctx.orgId);
    const now = new Date();
    return {
      data: items.map((r) =>
        toSummary(r, this.support.decrypt(r.buyerNameCipher, 'buyer_name'), profile.timezone, now),
      ),
      page,
    };
  }

  /** uuids of a filter to internal ids. `null` means a uuid in it is not in this workspace: the answer is empty. */
  private async resolveFilter(
    tx: Tx,
    orgId: number,
    f: FilterInput,
    fixed: { contactId?: number; dealId?: number },
  ): Promise<SalesDocFilter | null> {
    const ctx = RequestContextStore.require();
    const out: SalesDocFilter = {
      kind: f.kind,
      status: f.status,
      q: f.q,
      currency: f.currency,
      validFrom: f.validFrom,
      validTo: f.validTo,
      contactId: fixed.contactId,
      dealId: fixed.dealId,
    };
    if (f.mine) {
      if (!ctx.userId) return null;
      out.ownerId = ctx.userId;
    }
    if (f.ownerId) {
      const id = await this.repo.resolveUserId(tx, orgId, f.ownerId);
      if (id === undefined || (out.ownerId !== undefined && out.ownerId !== id)) return null;
      out.ownerId = id;
    }
    if (f.contactId) {
      const c = await this.repo.resolveContact(tx, orgId, f.contactId);
      if (!c) return null;
      out.contactId = c.id;
    }
    if (f.dealId) {
      const dl = await this.repo.resolveDeal(tx, orgId, f.dealId);
      if (!dl) return null;
      out.dealId = dl.id;
    }
    if (f.companyId) {
      const co = await this.repo.resolveCompany(tx, orgId, f.companyId);
      if (!co) return null;
      out.companyId = co.id;
    }
    return out;
  }

  private async createIn(
    tx: Tx,
    orgId: number,
    actorId: number | null,
    input: CreateSalesDocInput,
    opts: CreateOptions,
  ): Promise<SalesDocRow> {
    const owner =
      input.ownerId === undefined
        ? actorId
        : input.ownerId
          ? await this.requireOwner(tx, orgId, input.ownerId)
          : null;
    const deal = input.dealId ? await this.requireDeal(tx, orgId, input.dealId) : null;
    const contact = input.contactId ? await this.requireContact(tx, orgId, input.contactId) : null;
    // A document names its customer once: the contact (or the deal's), and the company the caller named, else the customer's.
    const contactId = contact?.id ?? deal?.contactId ?? null;
    // TW-PROP-005 / D-01: the buyer comes from the contact unless the body says otherwise (Reference had no way to capture a phone).
    const buyerContact =
      contact ?? (contactId ? await this.repo.resolveContactById(tx, orgId, contactId) : null);
    let companyId: number | null;
    if (input.companyId) companyId = (await this.requireCompany(tx, orgId, input.companyId)).id;
    else if (input.companyId === null) companyId = null;
    else companyId = deal?.companyId ?? buyerContact?.companyId ?? null;
    const pick = (given: string | null | undefined, fallback: string | null | undefined) =>
      given !== undefined ? given || null : (fallback ?? null);

    const tpl = opts.noTemplate
      ? undefined
      : input.templateId
        ? await this.repo.templateByUuid(tx, orgId, input.templateId)
        : await this.repo.defaultTemplate(tx, orgId, input.kind);
    if (input.templateId && !tpl) throw AppError.notFound('Template', input.templateId);

    const settings = await this.repo.settings(tx, orgId);
    const profile = await this.repo.orgProfile(tx, orgId);
    const today = todayIn(resolveTimezone(profile.timezone));
    const days = tpl?.validDays ?? settings.defaultValidDays;
    const validUntil =
      input.validUntil !== undefined ? input.validUntil : days ? addDays(today, days) : null;

    const currency = input.currency ?? profile.currency ?? 'USD';
    const wire: WireContent = {
      currency,
      taxRate: input.taxRate ?? '0',
      discount: input.discount ?? null,
      lines: input.lines,
    };
    const priced = this.price(wire);

    const seq = await this.repo.allocateSeq(tx, orgId, input.kind, startFor(settings, input.kind));
    const number = formatNumber(prefixFor(settings, input.kind), settings.numberPadding, seq);
    const token = generateToken();
    const id = await this.repo.insert(tx, orgId, {
      kind: input.kind,
      number,
      seq,
      source: opts.source,
      title: input.title || null,
      contactId,
      companyId,
      dealId: deal?.id ?? null,
      ownerId: owner,
      createdBy: actorId,
      buyerNameCipher: this.support.encrypt(pick(input.buyerName, buyerContact?.name)),
      buyerEmailCipher: this.support.encrypt(pick(input.buyerEmail, buyerContact?.email)),
      buyerPhoneCipher: this.support.encrypt(pick(input.buyerPhone, buyerContact?.phone)),
      notesCipher: this.support.encrypt(input.notes !== undefined ? input.notes : tpl?.notes),
      terms: (input.terms !== undefined ? input.terms : tpl?.terms) || null,
      currency: priced.currency,
      currencyExponent: priced.exponent,
      taxRateBp: priced.defaultTaxRateBp,
      discountKind: priced.discount.kind,
      discountValue: priced.discount.value,
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
      validUntil,
      duplicatedFromId: opts.duplicatedFromId ?? null,
      tokenHash: hashToken(token),
      tokenCipher: this.support.encrypt(token)!,
    });
    await this.repo.replaceItems(tx, orgId, id, this.itemRows(priced, input.lines));
    const row = (await this.repo.findById(tx, orgId, id))!;
    await this.support.record(
      tx,
      row,
      {
        type: opts.duplicatedFromId ? 'duplicated' : 'created',
        actorKind: 'user',
        actorUserId: actorId,
        toStatus: 'draft',
        meta: opts.duplicatedFromNumber
          ? { from: opts.duplicatedFromNumber }
          : { source: opts.source },
      },
      {
        audit: {
          action: 'insert',
          delta: {
            number: { old: null, new: row.number },
            kind: { old: null, new: row.kind },
            total: {
              old: null,
              new: `${row.currency} ${minorToMajor(row.totalMinor, row.currency)}`,
            },
          },
        },
        outbox: {
          type: 'salesdoc.created',
          extra: opts.duplicatedFromNumber ? { duplicatedFrom: opts.duplicatedFromNumber } : {},
        },
        orgId,
      },
    );
    return row;
  }

  /** Prices the content or answers 422 listing every field the math rejected (the same list the web preview shows inline). */
  private price(wire: WireContent) {
    const r = computeSalesDoc(wire);
    if (!r.ok) {
      throw new AppError(
        ERROR_CODES.SALESDOC_AMOUNT_INVALID,
        'An amount, quantity or rate is not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        r.issues,
      );
    }
    return r.value;
  }

  private itemRows(
    priced: ReturnType<SalesDocsService['price']>,
    named: Array<{ description?: string }>,
  ): NewSalesDocItem[] {
    return priced.lines.map(({ input, result }, i) => ({
      position: i,
      description: (named[i]?.description ?? '').trim() || 'Item',
      qty: formatQty(input.qtyScaled),
      unitPriceMinor: input.unitPriceMinor,
      discountKind: input.discount.kind,
      discountValue: input.discount.value,
      taxRateBp: input.taxRateBp,
      grossMinor: result.grossMinor,
      discountMinor: result.discountMinor,
      netMinor: result.netMinor,
      taxMinor: result.taxMinor,
    }));
  }

  private async requireOwner(tx: Tx, orgId: number, uuid: string): Promise<number> {
    const user = await this.repo.resolveActiveUser(tx, orgId, uuid);
    if (!user) {
      throw new AppError(
        ERROR_CODES.SALESDOC_OWNER_INVALID,
        'The owner must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'ownerId', message: uuid }],
      );
    }
    return user.id;
  }

  private async requireContact(tx: Tx, orgId: number, uuid: string) {
    const c = await this.repo.resolveContact(tx, orgId, uuid);
    if (!c) throw AppError.notFound('Contact', uuid);
    return c;
  }

  private async requireCompany(tx: Tx, orgId: number, uuid: string) {
    const c = await this.repo.resolveCompany(tx, orgId, uuid);
    if (!c) throw AppError.notFound('Company', uuid);
    return c;
  }

  private async requireDeal(tx: Tx, orgId: number, uuid: string) {
    const d = await this.repo.resolveDeal(tx, orgId, uuid);
    if (!d) throw AppError.notFound('Deal', uuid);
    return d;
  }

  private eventPlain(e: {
    signerNameCipher: string | null;
    signerEmailCipher: string | null;
    commentCipher: string | null;
  }) {
    return {
      signerName: this.support.decrypt(e.signerNameCipher, 'signer_name'),
      signerEmail: this.support.decrypt(e.signerEmailCipher, 'signer_email'),
      comment: this.support.decrypt(e.commentCipher, 'comment'),
    };
  }

  /** A document the caller may read (404 otherwise, never 403: the existence of a document outside the scope is not revealed). */
  private async visible(tx: Tx, uuid: string, scope: RecordScope): Promise<SalesDocRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
    if (!row) throw AppError.notFound('Document', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  private async lockForWrite(tx: Tx, uuid: string, scope: RecordScope): Promise<SalesDocRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
    if (!row) throw AppError.notFound('Document', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  private async assertScope(tx: Tx, scope: RecordScope, row: SalesDocRow): Promise<void> {
    const ctx = RequestContextStore.require();
    // The same rule the list applies, through the one scope resolver (BL-380).
    if (
      !(await canActOn(tx, { orgId: ctx.orgId, userId: ctx.userId }, scope, [
        row.ownerId,
        row.createdById,
      ]))
    ) {
      throw AppError.notFound('Document');
    }
  }
}

// --- helpers -----------------------------------------------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

/** A line as the pricing function takes it, rebuilt from a stored row (so a tax or discount edit reprices the lines it keeps). */
export function wireLineOf(
  i: SalesDocItemRow,
  currency: string,
): WireLine & { description: string } {
  return {
    description: i.description,
    qty: formatQty(parseQtyScaled(i.qty)),
    unitPrice: minorToMajor(i.unitPriceMinor, currency),
    discount: discountOf(i.discountKind, i.discountValue, currency) as SalesDocDiscount | null,
    taxRate: i.taxRateBp === null ? null : formatPercent(i.taxRateBp),
  };
}

/** "2.5000" -> 25000n. */
export function parseQtyScaled(qty: string): bigint {
  const [w = '0', f = ''] = qty.split('.');
  return BigInt(w + (f + '0000').slice(0, 4));
}

/** An open document whose valid-until date has gone by in the workspace's zone. */
function isLapsed(row: SalesDocRow, tz: string | null): boolean {
  return (
    (row.status === 'sent' || row.status === 'viewed') &&
    !!row.validUntil &&
    row.validUntil < todayIn(resolveTimezone(tz))
  );
}

const ttlExpiry = (days: number | null, now: Date): Date | null =>
  days ? new Date(now.getTime() + days * 86_400_000) : null;

/** `jo***@example.com`, `+9198*****10`: enough for the timeline to say where it went, not enough to harvest. */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [local = '', domain = ''] = to.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${to.slice(0, 3)}${'*'.repeat(Math.max(0, to.length - 5))}${to.slice(-2)}`;
}

interface RevisionSnapshot {
  title: string | null;
  currency: string;
  taxRate: string;
  discount: SalesDocDiscount | null;
  validUntil: string | null;
  notesCipher: string | null;
  terms: string | null;
  lines: ReturnType<typeof toLine>[];
  totals: ReturnType<typeof totalsOf>;
}

function snapshotOf(row: SalesDocRow, items: SalesDocItemRow[]): Record<string, unknown> {
  const snap: RevisionSnapshot = {
    title: row.title,
    currency: row.currency,
    taxRate: formatPercent(row.taxRateBp),
    discount: discountOf(row.discountKind, row.discountValue, row.currency),
    validUntil: row.validUntil,
    // As stored: notes stay encrypted in the history too.
    notesCipher: row.notesCipher,
    terms: row.terms,
    lines: items.map((i) => toLine(i, row.currency, row.taxRateBp)),
    totals: totalsOf(row),
  };
  return snap as unknown as Record<string, unknown>;
}
