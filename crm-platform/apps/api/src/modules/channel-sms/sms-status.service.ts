import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { verifyTwilioSignature } from '../../infra/providers/channel-sms/twilio-signature';
import { BroadcastReceiptsService, type DeliveryReceipt } from '../broadcasts';
import { CampaignReceiptsService } from '../campaigns';
import { deliveryReportUrl } from './sender-rules';
import { SmsSendersRepository } from './sms-senders.repository';
import { SmsSendersService } from './sms-senders.service';
import { parseMsg91Report, parseTwilioReport, type ParsedReport } from './status-rules';

/**
 * Delivery reports from the providers (TW-SMS-022, 023). The report names a provider message id and no tenant; the tenant is
 * derived from the recipient row that carries that id (the same narrow lookups the WhatsApp reports use), never from the request.
 *
 *  - Twilio proves itself with its request signature, checked against the auth token of the Twilio SMS senders of THAT tenant.
 *  - MSG91 sends no signature, so its address carries a per-sender secret; the report is applied only when the message belongs to
 *    the workspace that secret belongs to.
 *
 * The state machines of broadcasts and campaigns decide what a report changes (forward only: sent, then delivered or failed, so a
 * late `sent` can never undo a `delivered`), which also fills the broadcast recipients that Reference never updated.
 */
@Injectable()
export class SmsStatusService {
  private readonly logger = new Logger(SmsStatusService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
    private readonly repo: SmsSendersRepository,
    private readonly senders: SmsSendersService,
    private readonly broadcastReceipts: BroadcastReceiptsService,
    private readonly campaignReceipts: CampaignReceiptsService,
  ) {}

  /** The tenant a provider message id belongs to, or null when it is not one of our broadcast or campaign sends. */
  private async orgOf(messageId: string): Promise<number | null> {
    const b = await this.db.primary.execute(sql`SELECT * FROM bcast_receipt_lookup(${messageId})`);
    const bRow = b.rows[0] as { receipt_org_id: number | string } | undefined;
    if (bRow) return Number(bRow.receipt_org_id);
    const c = await this.db.primary.execute(sql`SELECT * FROM camp_receipt_lookup(${messageId})`);
    const cRow = c.rows[0] as { receipt_org_id: number | string } | undefined;
    return cRow ? Number(cRow.receipt_org_id) : null;
  }

  private async apply(r: ParsedReport): Promise<void> {
    const receipt: DeliveryReceipt = {
      providerMessageId: r.messageId,
      status: r.status,
      occurredAt: new Date(),
      ...(r.status === 'failed'
        ? {
            errorCode: r.errorCode,
            errorMessage:
              `${r.errorCode ?? ''} ${r.errorMessage ?? ''}`.trim() || 'SMS undelivered',
          }
        : {}),
    };
    // A campaign's recipient first, then a broadcast's (each answers false for a message that is not its own).
    if (await this.campaignReceipts.handle(receipt)) return;
    await this.broadcastReceipts.handle(receipt);
  }

  /**
   * Twilio's status callback. Throws 401 only for a signature that does not match; every other outcome (unknown message, a status
   * that says nothing new, a malformed body, an internal error) is a quiet success, because Twilio retries hard and disables a
   * webhook that keeps failing.
   */
  async twilio(body: unknown, signature: string | undefined): Promise<void> {
    const report = parseTwilioReport(body);
    if (!report) return;
    try {
      const orgId = await this.orgOf(report.messageId);
      if (orgId === null) return;

      const url = deliveryReportUrl(this.config.get('APP_URL', { infer: true }));
      const rows = await this.db.txAs({ orgId }, (tx) => this.repo.twilioSenders(tx, orgId));
      const proven = rows.some((row) => {
        const creds = this.senders.credentialsOf(row);
        return (
          creds !== null &&
          verifyTwilioSignature(creds.authToken, url, body as Record<string, unknown>, signature)
        );
      });
      if (!proven) throw AppError.unauthenticated('Invalid signature');
      await this.apply(report);
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error({ err: String(err) }, 'sms status (twilio) failed');
    }
  }

  /** MSG91's delivery report, to the address with the sender's secret. 401 for a secret that is not any sender's. */
  async msg91(secret: string, body: unknown): Promise<void> {
    const found = await this.db.primary.execute(
      sql`SELECT * FROM sms_sender_by_dlr_secret(${secret})`,
    );
    const hit = found.rows[0] as { sender_org_id: number | string } | undefined;
    if (!hit) throw AppError.unauthenticated('Invalid delivery report address');
    const report = parseMsg91Report(body);
    if (!report) return;
    try {
      const orgId = await this.orgOf(report.messageId);
      // A secret speaks only for its own workspace's messages.
      if (orgId === null || orgId !== Number(hit.sender_org_id)) return;
      await this.apply(report);
    } catch (err) {
      this.logger.error({ err: String(err) }, 'sms status (msg91) failed');
    }
  }
}
