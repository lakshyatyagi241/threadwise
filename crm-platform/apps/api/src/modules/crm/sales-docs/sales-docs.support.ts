import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SalesDocResponse, SalesDocShareLink, SalesDocStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import type { Env } from '../../../config/env.schema';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  linkActive,
  salesDocEventPayload,
  toSalesDocResponse,
  type Decrypted,
} from './sales-docs.mapper';
import { SALES_DOC_MODULE } from './sales-doc-rules';
import {
  SalesDocsRepository,
  type NewSalesDocEvent,
  type SalesDocRow,
} from './sales-docs.repository';

export interface RecordOptions {
  /** Audit action; omit for none (the sweep writes its own rows without a request context). */
  audit?: {
    action: 'insert' | 'update' | 'delete';
    delta?: Record<string, { old: unknown; new: unknown }>;
  };
  /** Outbox event type (`salesdoc.sent`) and extra payload keys. */
  outbox?: { type: string; extra?: Record<string, unknown> };
  /** For a caller with no request context. */
  orgId?: number;
}

/**
 * Shared helpers of the sales-docs services: reading a document into its wire shape (decrypting what is encrypted at rest), and the
 * one place a change writes its timeline event, audit row and outbox event, in the caller's transaction.
 */
@Injectable()
export class SalesDocsSupport {
  private readonly logger = new Logger(SalesDocsSupport.name);
  private readonly webUrl: string;

  constructor(
    readonly repo: SalesDocsRepository,
    readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  encrypt(value: string | null | undefined): string | null {
    return value ? this.crypto.encrypt(value) : null;
  }

  /** A value written under a key this process no longer has must not take a whole list down. */
  decrypt(cipher: string | null, what: string): string | null {
    if (cipher === null) return null;
    try {
      return this.crypto.decrypt(cipher);
    } catch (err) {
      this.logger.warn({ err, what }, 'could not decrypt sales document field');
      return null;
    }
  }

  plain(row: SalesDocRow): Decrypted {
    return {
      buyerName: this.decrypt(row.buyerNameCipher, 'buyer_name'),
      buyerEmail: this.decrypt(row.buyerEmailCipher, 'buyer_email'),
      buyerPhone: this.decrypt(row.buyerPhoneCipher, 'buyer_phone'),
      notes: this.decrypt(row.notesCipher, 'notes'),
    };
  }

  /** The full document, read inside `tx` (lines and the workspace's time zone are read here). */
  async response(tx: Tx, orgId: number, row: SalesDocRow): Promise<SalesDocResponse> {
    const items = (await this.repo.items(tx, orgId, [row.id])).get(row.id) ?? [];
    const profile = await this.repo.orgProfile(tx, orgId);
    return toSalesDocResponse(row, items, this.plain(row), profile.timezone);
  }

  /** The link for a document, or null when it has no recoverable token (a legacy row: regenerate). */
  link(row: SalesDocRow, now: Date = new Date()): SalesDocShareLink | null {
    const token = this.decrypt(row.publicTokenCipher, 'public_token');
    if (!token) return null;
    return {
      token,
      path: `/q/${token}`,
      url: `${this.webUrl}/q/${token}`,
      active: linkActive(row, now),
      expiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      revokedAt: row.tokenRevokedAt?.toISOString() ?? null,
    };
  }

  urlFor(token: string): string {
    return `${this.webUrl}/q/${token}`;
  }

  /**
   * One change: its timeline row, its audit row and its outbox event, in the caller's transaction (all commit or none). `row` is the
   * document AFTER the change. Nothing here carries the buyer's details or the link: the timeline row holds the evidence (encrypted),
   * the audit delta and the event payload hold identifiers only.
   */
  async record(
    tx: Tx,
    row: SalesDocRow,
    ev: Omit<NewSalesDocEvent, 'docId' | 'revision'>,
    opts: RecordOptions = {},
  ): Promise<void> {
    const orgId = opts.orgId ?? RequestContextStore.require().orgId;
    await this.repo.insertEvent(tx, orgId, { ...ev, docId: row.id, revision: row.revision });
    if (opts.audit) {
      await this.audit.record(tx, {
        module: SALES_DOC_MODULE,
        recordId: row.id,
        action: opts.audit.action,
        delta: opts.audit.delta,
      });
    }
    if (opts.outbox) {
      await this.outbox.emit(tx, {
        aggregateModule: SALES_DOC_MODULE,
        aggregateId: row.id,
        eventType: opts.outbox.type,
        payload: { ...salesDocEventPayload(row), ...opts.outbox.extra },
        ...(opts.orgId !== undefined ? { orgId: opts.orgId } : {}),
      });
    }
  }

  statusDelta(
    from: SalesDocStatus,
    to: SalesDocStatus,
  ): Record<string, { old: unknown; new: unknown }> {
    return { status: { old: from, new: to } };
  }
}
