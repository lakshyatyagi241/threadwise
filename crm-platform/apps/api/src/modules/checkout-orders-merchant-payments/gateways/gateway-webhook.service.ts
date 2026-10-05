import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { notificationFields } from '../../../infra/providers/platform-payment-gateways';
import { webhookSecretMissing } from './gateway-rules';
import { GatewayPaymentRegistry } from './gateway-payment.registry';
import { MerchantGatewaysRepository } from './merchant-gateways.repository';
import { parseRazorpayLinkPaid } from './razorpay-link-event';
import { WorkspaceGatewayResolver } from './workspace-gateway.resolver';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 256_000;

const reject = (status: HttpStatus, reason: string) =>
  new AppError(ERROR_CODES.STORE_WEBHOOK_REJECTED, reason, status);

/**
 * `POST /v2/store-public/webhooks/gateway/:gatewayId`: a provider tells the workspace a payment arrived (Reference
 * `CustomerPaymentWebhookController`, hardened). The address names the gateway row, and so the workspace, the shop and the secret:
 * nothing in the body is trusted to find them (Reference scanned recent unpaid orders for the body's reference to learn the workspace
 * BEFORE verifying). The driver's own signature check runs first; only then is the body read, handed to the domain that issued the
 * reference (see `GatewayPaymentRegistry`) and settled. A gateway with no signing secret fails closed.
 */
@Injectable()
export class GatewayWebhookService {
  private readonly logger = new Logger(GatewayWebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MerchantGatewaysRepository,
    private readonly resolver: WorkspaceGatewayResolver,
    private readonly registry: GatewayPaymentRegistry,
  ) {}

  async handle(
    gatewayUuid: string,
    raw: Buffer | undefined,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: true; ignored?: true; outcome?: string }> {
    if (!UUID.test(gatewayUuid)) throw reject(HttpStatus.NOT_FOUND, 'gateway_unknown');
    if (!raw || raw.length === 0 || raw.length > MAX_BODY) {
      throw reject(HttpStatus.BAD_REQUEST, 'bad_body');
    }
    const found = (
      await this.db.primary.execute(sql`SELECT * FROM store_gateway_lookup(${gatewayUuid}::uuid)`)
    ).rows[0] as
      | {
          gateway_id: number | string;
          gateway_org_id: number | string;
        }
      | undefined;
    if (!found) throw reject(HttpStatus.NOT_FOUND, 'gateway_unknown');
    const orgId = Number(found.gateway_org_id);

    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findById(tx, orgId, Number(found.gateway_id));
      if (!row || !row.active) throw reject(HttpStatus.NOT_FOUND, 'gateway_unknown');
      const credentials = this.resolver.credentialsOf(row);
      if (webhookSecretMissing(row.slug, credentials)) {
        this.logger.warn({ gateway: row.id, slug: row.slug }, 'webhook refused: no signing secret');
        throw reject(HttpStatus.FORBIDDEN, 'webhook_secret_not_configured');
      }

      const driver = this.resolver.driverFor({
        source: row.storefrontId === 0 ? 'workspace_default' : 'store_override',
        slug: row.slug,
        name: row.slug,
        mode: row.mode === 'test' ? 'test' : 'live',
        credentials,
        storefrontId: row.storefrontId,
        gatewayUuid: row.uuid,
      });
      // The signature first: nothing below runs for a request the gateway's own secret did not sign.
      if (!(await driver.verifyWebhook(raw, headers))) {
        this.logger.warn({ gateway: row.id, slug: row.slug }, 'webhook signature mismatch');
        throw reject(HttpStatus.BAD_REQUEST, 'bad_signature');
      }

      const body = notificationFields(raw);
      // A Razorpay payment link announces itself with its own event; the driver reads the checkout ones.
      const payment =
        driver.parseWebhook(body) ?? (row.slug === 'razorpay' ? parseRazorpayLinkPaid(body) : null);
      if (!payment?.orderNumber) return { ok: true as const, ignored: true as const };
      const settler = this.registry.forReference(payment.orderNumber);
      if (!settler) return { ok: true as const, ignored: true as const };

      // The machine is the actor: whatever the settler audits or publishes says so, in this organization.
      const base = RequestContextStore.peek();
      const result = await RequestContextStore.run(
        {
          requestId: base?.requestId ?? 'gateway-webhook',
          orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
          ip: base?.ip,
          userAgent: base?.userAgent,
        },
        () =>
          settler.settle({
            tx,
            orgId,
            gateway: { id: row.id, uuid: row.uuid, slug: row.slug, storefrontId: row.storefrontId },
            payment,
            reference: payment.orderNumber as string,
          }),
      );
      return { ok: true as const, outcome: result.outcome };
    });
  }
}
