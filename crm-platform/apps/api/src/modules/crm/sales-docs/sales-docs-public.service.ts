import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type PublicAcceptInput,
  type PublicDeclineInput,
  type PublicDecisionResponse,
  type PublicSalesDoc,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PublicLinkThrottle } from './public-link-throttle';
import { renderSalesDocHtml } from './sales-doc-render';
import { hashToken, isOverdue, looksLikeToken } from './sales-doc-rules';
import { linkActive, toPublicResponse } from './sales-docs.mapper';
import type { SalesDocRow } from './sales-docs.repository';
import { SalesDocsSupport } from './sales-docs.support';

/**
 * The buyer's side (TW-PROP-014..016, D-04, D-05, D-11, D-16). No login: the token is the only credential, looked up by its SHA-256
 * in one privileged query (the organization is not known before it), after which the request is scoped to that organization like
 * any other (RLS, audit, outbox).
 *
 * What differs from Reference: opening the link is tracked (`viewed`); a lapsed or revoked or expired link is refused, so a buyer cannot
 * accept a price whose date has gone by; accepting records who, from where and when; the same decision twice is the same answer and
 * the opposite decision is 409; a draft is not public.
 */
@Injectable()
export class SalesDocsPublicService {
  constructor(
    private readonly db: DatabaseService,
    private readonly support: SalesDocsSupport,
    private readonly throttle: PublicLinkThrottle,
  ) {}

  private get repo() {
    return this.support.repo;
  }

  async view(token: string): Promise<PublicSalesDoc> {
    const { orgId, uuid, ctx } = await this.locate(token, 'read');
    return this.db.tx(async (tx) => {
      // Locked: two buyers (or a buyer and a decision) racing must see one first view, one transition.
      const row = await this.usable(await this.repo.findByUuid(tx, orgId, uuid, true));
      const profile = await this.repo.orgProfile(tx, orgId);
      let after = row;
      if (row.status === 'sent') {
        await this.repo.update(tx, orgId, row.id, undefined, {
          status: 'viewed',
          first_viewed_at: new Date(),
          last_viewed_at: new Date(),
          view_count: row.viewCount + 1,
        });
        after = (await this.repo.findById(tx, orgId, row.id))!;
        await this.support.record(
          tx,
          after,
          {
            type: 'viewed',
            actorKind: 'buyer',
            fromStatus: 'sent',
            toStatus: 'viewed',
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
          },
          {
            audit: { action: 'update', delta: { status: { old: 'sent', new: 'viewed' } } },
            outbox: { type: 'salesdoc.viewed' },
          },
        );
      } else {
        await this.repo.recordView(tx, orgId, row.id);
      }
      return this.present(tx, orgId, after, profile.name, profile.timezone);
    });
  }

  /** The print page the buyer can save as PDF. Not counted as a view. */
  async print(token: string): Promise<string> {
    const { orgId, uuid } = await this.locate(token, 'read');
    return this.db.tx(async (tx) => {
      const row = await this.usable(await this.repo.findByUuid(tx, orgId, uuid));
      const profile = await this.repo.orgProfile(tx, orgId);
      const doc = await this.present(tx, orgId, row, profile.name, profile.timezone);
      return renderSalesDocHtml({
        kind: doc.kind,
        number: doc.number,
        title: doc.title,
        statusLabel: doc.status,
        sellerName: doc.seller.name,
        buyerName: doc.buyer.name,
        buyerCompany: doc.buyer.company,
        currency: doc.currency,
        lines: doc.lines,
        totals: doc.totals,
        discount: doc.discount,
        taxRate: doc.taxRate,
        notes: doc.notes,
        terms: doc.terms,
        validUntil: doc.validUntil,
        signedBy: doc.decision?.status === 'accepted' ? doc.decision.signerName : null,
      });
    });
  }

  async accept(token: string, input: PublicAcceptInput): Promise<PublicDecisionResponse> {
    return this.decide(token, 'accepted', {
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      signature: input.signature,
      comment: input.comment,
    });
  }

  async decline(token: string, input: PublicDeclineInput): Promise<PublicDecisionResponse> {
    return this.decide(token, 'declined', {
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      comment: input.reason,
    });
  }

  // --- internals ---------------------------------------------------------------------------------------------------------

  private async decide(
    token: string,
    to: 'accepted' | 'declined',
    who: { signerName?: string; signerEmail?: string; signature?: string; comment?: string },
  ): Promise<PublicDecisionResponse> {
    const { orgId, uuid, ctx } = await this.locate(token, 'decide');
    return this.db.tx(async (tx) => {
      const row = await this.usable(await this.repo.findByUuid(tx, orgId, uuid, true));
      const other = to === 'accepted' ? 'declined' : 'accepted';
      // The same decision again is the same answer (a double click, a retry); the opposite one is final.
      if (row.status === to || (to === 'accepted' && row.status === 'converted')) {
        return { status: to, decidedAt: row.decidedAt!.toISOString(), replay: true };
      }
      if (row.status === other || (to === 'declined' && row.status === 'converted')) {
        throw new AppError(
          ERROR_CODES.SALESDOC_ALREADY_DECIDED,
          `This document was already ${other}.`,
          HttpStatus.CONFLICT,
        );
      }
      const profile = await this.repo.orgProfile(tx, orgId);
      if (row.status === 'expired' || isOverdue(row.status, row.validUntil, profile.timezone)) {
        throw new AppError(
          ERROR_CODES.SALESDOC_EXPIRED,
          'This offer is past its valid-until date. Ask the sender for a new one.',
          HttpStatus.CONFLICT,
        );
      }
      // Only sent or viewed remain: drafts are not public, and the rest were answered above.
      const now = new Date();
      await this.repo.update(tx, orgId, row.id, undefined, {
        status: to,
        decided_at: now,
        accepted_revision: to === 'accepted' ? row.revision : null,
        first_viewed_at: row.firstViewedAt ?? now,
      });
      const after = (await this.repo.findById(tx, orgId, row.id))!;
      await this.support.record(
        tx,
        after,
        {
          type: to === 'accepted' ? 'accepted' : 'declined',
          actorKind: 'buyer',
          fromStatus: row.status,
          toStatus: to,
          signerNameCipher: this.support.encrypt(who.signerName),
          signerEmailCipher: this.support.encrypt(who.signerEmail),
          signatureCipher: this.support.encrypt(who.signature),
          commentCipher: this.support.encrypt(who.comment),
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          meta: { revision: row.revision, consent: to === 'accepted' },
        },
        {
          audit: { action: 'update', delta: { status: { old: row.status, new: to } } },
          outbox: {
            type: to === 'accepted' ? 'salesdoc.accepted' : 'salesdoc.declined',
            extra: { by: 'buyer' },
          },
        },
      );
      return { status: to, decidedAt: now.toISOString(), replay: false };
    });
  }

  private async present(
    tx: Tx,
    orgId: number,
    row: SalesDocRow,
    seller: string,
    tz: string | null,
  ): Promise<PublicSalesDoc> {
    const items = (await this.repo.items(tx, orgId, [row.id])).get(row.id) ?? [];
    const decision =
      row.status === 'accepted' || row.status === 'declined' || row.status === 'converted'
        ? await this.repo.lastDecision(tx, orgId, row.id)
        : undefined;
    return toPublicResponse(
      row,
      items,
      this.support.plain(row),
      seller,
      tz,
      decision
        ? { signerName: this.support.decrypt(decision.signerNameCipher, 'signer_name') }
        : null,
    );
  }

  /**
   * Token to document. Throttled first (a junk token costs a Redis hit, not a database query); an unknown token is 404; the rest of the
   * request is then scoped to the document's organization.
   */
  private async locate(token: string, kind: 'read' | 'decide') {
    const ctx = RequestContextStore.require();
    await this.throttle.check(kind, ctx.ip, token);
    if (!looksLikeToken(token)) throw AppError.notFound('Document');
    const hit = await this.db.privileged((tx) => this.repo.locateByTokenHash(tx, hashToken(token)));
    if (!hit) throw AppError.notFound('Document');
    ctx.orgId = hit.orgId;
    return { orgId: hit.orgId, uuid: hit.uuid, ctx };
  }

  /** 404 for a draft (not published yet), 410 for a revoked or expired link. */
  private async usable(row: SalesDocRow | undefined): Promise<SalesDocRow> {
    if (!row || row.status === 'draft') throw AppError.notFound('Document');
    if (!linkActive(row, new Date())) {
      throw new AppError(
        ERROR_CODES.SALESDOC_LINK_UNAVAILABLE,
        'This link is no longer valid. Ask the sender for a new one.',
        HttpStatus.GONE,
      );
    }
    return row;
  }
}
