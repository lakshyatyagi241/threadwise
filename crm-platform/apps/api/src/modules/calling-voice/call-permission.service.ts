import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestPermissionResult } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { CALLING_GRAPH, type CallingGraph } from '../../infra/providers/calling-voice';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WabaConnectService } from '../whatsapp-cloud-api-waba';
import {
  DEFAULT_PERMISSION_QUESTION,
  digitsOf,
  isAlreadyPermitted,
  isUsable,
  permissionFromUpdate,
  phoneForms,
} from './calling.rules';
import { CallsRepository, type NumberRow } from './calls.repository';
import { caller, refused, usableNumber } from './calling-support';

/**
 * The customer's permission to be called (TW-CALL-005, 006). WhatsApp forbids cold-calling: a person must tap Allow on a request
 * message first. This sends the request, keeps the ledger of the answers (one row per number and customer), and says whether a call
 * may be placed now.
 */
@Injectable()
export class CallPermissionService {
  private readonly logger = new Logger(CallPermissionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly waba: WabaConnectService,
    private readonly plans: PlanEntitlementService,
    @Inject(CALLING_GRAPH) private readonly graph: CallingGraph,
  ) {}

  /** The request endpoint (TW-CALL-005): a number of this workspace, a customer, an optional question of at most 160 characters. */
  async request(numberUuid: string, to: string, body?: string): Promise<RequestPermissionResult> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const { number, conn } = await this.db.tx((tx) =>
      usableNumber(tx, orgId, this.repo, this.waba, { uuid: numberUuid }),
    );
    return { alreadyPermitted: await this.send(orgId, number, conn, to, body) };
  }

  /**
   * Sends the request message. Meta's 138017 ("the business can already call this person") is not a failure: the ledger is brought up
   * to date (granted, no expiry) and `true` comes back, so the caller goes on to place the call. After a sent request the row is
   * `expired`: the cache is reset and the next look waits for the customer's answer to arrive as a `permission_update`.
   */
  async send(
    orgId: number,
    number: NumberRow,
    conn: WabaConnection,
    to: string,
    body?: string,
  ): Promise<boolean> {
    const digits = digitsOf(to);
    try {
      await this.graph.requestPermission(conn, digits, body?.trim() || DEFAULT_PERMISSION_QUESTION);
    } catch (err) {
      if (err instanceof WabaApiError && isAlreadyPermitted(err.code)) {
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.upsertPermission(tx, orgId, number.id, digits, {
            status: 'granted',
            grantedAt: new Date(),
            expiresAt: null,
          }),
        );
        return true;
      }
      throw refused(err, 'Meta refused permission_request');
    }
    await this.db.txAs({ orgId }, (tx) =>
      this.repo.upsertPermission(tx, orgId, number.id, digits, {
        status: 'expired',
        grantedAt: null,
        expiresAt: null,
      }),
    );
    return false;
  }

  /** Whether a call to this customer may be placed now (TW-CALL-008 rule 1). */
  async mayCall(orgId: number, configId: number, to: string): Promise<boolean> {
    const row = await this.db.txAs({ orgId }, (tx) =>
      this.repo.permission(tx, orgId, configId, phoneForms(to)),
    );
    return isUsable(row);
  }

  /** The customer's answer, from Meta's `permission_update` event (TW-CALL-006 rule 1). Idempotent: the row is replaced. */
  async record(
    orgId: number,
    configId: number,
    from: unknown,
    response: unknown,
    expirationTimestamp: unknown,
  ): Promise<boolean> {
    const digits = digitsOf(from);
    if (!digits || !response) return false;
    const v = permissionFromUpdate(response, expirationTimestamp);
    await this.db.txAs({ orgId }, (tx) =>
      this.repo.upsertPermission(tx, orgId, configId, digits, v),
    );
    this.logger.log({ orgId, configId, status: v.status }, 'call permission recorded');
    return true;
  }
}
