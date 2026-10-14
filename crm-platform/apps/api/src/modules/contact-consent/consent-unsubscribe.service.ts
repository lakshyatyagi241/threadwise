import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Env } from '../../config/env.schema';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ContactConsentService } from './consent.service';
import {
  deriveUnsubscribeKeys,
  listUnsubscribeHeaders,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './consent-unsubscribe.tokens';

export interface UnsubscribeLink {
  /** What the person opens (the confirmation page on the web app). */
  pageUrl: string;
  /** What a mail client POSTs to (RFC 8058); the API answers without a login. */
  postUrl: string;
  /** `List-Unsubscribe` and `List-Unsubscribe-Post`. */
  headers: Record<string, string>;
}

/**
 * Email unsubscribe (BL-141): a signed link per contact. The public page and the one-click POST both land in `unsubscribe`, which
 * appends a `withdrawn` event (channel email, purpose marketing, source `contact_request`). The ledger rolls it up to the contact flag,
 * so every marketing send path (WhatsApp, SMS, email) honours it from then on.
 */
@Injectable()
export class ConsentUnsubscribeService {
  private readonly keys: Buffer[];

  constructor(
    private readonly db: DatabaseService,
    private readonly consent: ContactConsentService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const previous = (
      (this.config as unknown as ConfigService).get<string>(
        'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS',
      ) ?? ''
    )
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    this.keys = deriveUnsubscribeKeys([
      this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true }),
      ...previous,
    ]);
  }

  linkFor(orgId: number, contactId: number): UnsubscribeLink {
    const token = signUnsubscribeToken(this.keys, orgId, contactId);
    const web = this.config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
    const api = this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
    const postUrl = `${api}/v2/public/consent/unsubscribe/${token}`;
    return { pageUrl: `${web}/u/${token}`, postUrl, headers: listUnsubscribeHeaders(postUrl) };
  }

  /** The link for the contact that owns this address, or null when no contact does (a marketing mail then has nobody to unsubscribe). */
  async linkForAddress(orgId: number, email: string): Promise<UnsubscribeLink | null> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(
        sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_email = ${email.trim().toLowerCase()} ORDER BY id LIMIT 1`,
      ),
    );
    const row = res.rows[0] as { id: number | string } | undefined;
    return row ? this.linkFor(orgId, Number(row.id)) : null;
  }

  async status(token: string): Promise<{ valid: true; unsubscribed: boolean }> {
    const who = this.verify(token);
    const res = await this.db.txAs({ orgId: who.orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT c.id, coalesce(cs.state = 'withdrawn', false) AS out
        FROM contacts c LEFT JOIN contact_consent_state cs
          ON cs.org_id = c.org_id AND cs.contact_id = c.id AND cs.channel = 'email' AND cs.purpose = 'marketing'
        WHERE c.org_id = ${who.orgId} AND c.id = ${who.contactId}`),
    );
    const row = res.rows[0] as { out: boolean } | undefined;
    if (!row) throw this.invalid();
    return { valid: true, unsubscribed: row.out === true };
  }

  async unsubscribe(token: string): Promise<{ ok: true }> {
    const { orgId, contactId } = this.verify(token);
    const day = new Date().toISOString().slice(0, 10);
    await RequestContextStore.run(
      {
        requestId: `unsubscribe-${orgId}-${contactId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          const found = await tx.execute(
            sql`SELECT 1 FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
          );
          if (found.rows.length === 0) throw this.invalid();
          await this.consent.recordInTx(tx, orgId, {
            contactId,
            channel: 'email',
            purpose: 'marketing',
            action: 'withdrawn',
            source: 'contact_request',
            evidence: { reference: 'email-unsubscribe-link' },
            idempotencyKey: `contact_request:email-link:${contactId}:${day}`,
          });
        }),
    );
    return { ok: true };
  }

  private verify(token: string): { orgId: number; contactId: number } {
    const who = verifyUnsubscribeToken(this.keys, token);
    if (!who) throw this.invalid();
    return who;
  }

  private invalid(): AppError {
    return new AppError(
      ERROR_CODES.CONSENT_UNSUBSCRIBE_LINK_INVALID,
      'This unsubscribe link is not valid.',
      HttpStatus.NOT_FOUND,
    );
  }
}
