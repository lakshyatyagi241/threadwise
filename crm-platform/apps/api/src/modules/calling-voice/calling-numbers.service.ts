import { Inject, Injectable } from '@nestjs/common';
import type { CallEligibility, CallingNumberList, ToggleCallingResult } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { CALLING_GRAPH, type CallingGraph } from '../../infra/providers/calling-voice';
import { AuditService } from '../../kernel/audit/audit.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WabaConnectService } from '../whatsapp-cloud-api-waba';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  COEXISTENCE_MESSAGE,
  digitsOf,
  isCoexistenceNumber,
  isUsable,
  permissionLabel,
  phoneForms,
  toggleRefusal,
} from './calling.rules';
import { CallsRepository } from './calls.repository';
import { caller, notFound, unprocessable, usableNumber } from './calling-support';

const MODULE = 'wa_provider_configs';

/**
 * The WhatsApp numbers as calling sees them (WD-CALL-003, 004): which have calling on, and the switch. The switch is Meta's own
 * setting; the local flags change only after Meta accepts, and Meta's refusals come back in words a person can act on.
 */
@Injectable()
export class CallingNumbersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly waba: WabaConnectService,
    private readonly plans: PlanEntitlementService,
    private readonly audit: AuditService,
    @Inject(CALLING_GRAPH) private readonly graph: CallingGraph,
  ) {}

  async list(): Promise<CallingNumberList> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const rows = await this.db.tx((tx) => this.repo.numbers(tx, orgId));
    return {
      rows: rows.map((n) => ({
        id: n.uuid,
        phoneNumber: n.phoneNumber,
        displayLabel: n.displayLabel,
        connectionStatus: n.status,
        callingEnabled: n.callingEnabled,
        callingEnabledAt: n.callingEnabledAt?.toISOString() ?? null,
      })),
    };
  }

  /** Turns calling on or off. Enabling on a coexistence number is refused before Meta is asked (WD-CALL-004 rule 3). */
  async toggle(numberUuid: string, enable: boolean): Promise<ToggleCallingResult> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const { number, conn } = await this.db.tx(async (tx) => {
      const u = await usableNumber(tx, orgId, this.repo, this.waba, { uuid: numberUuid });
      if (enable && isCoexistenceNumber(u.number.meta)) {
        throw unprocessable('CALL_COEXISTENCE_UNSUPPORTED', COEXISTENCE_MESSAGE);
      }
      return u;
    });

    let body: Record<string, unknown>;
    try {
      body = await this.graph.setCalling(conn, enable);
    } catch (err) {
      if (err instanceof WabaApiError) {
        throw unprocessable(
          'CALL_META_REFUSED',
          toggleRefusal(err.code, err.userMessage ?? err.message, err.status),
        );
      }
      throw err;
    }

    const updated = await this.db.tx(async (tx) => {
      const row = await this.repo.setCalling(tx, orgId, number.id, enable, body);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: number.id,
        action: 'update',
        delta: { calling_enabled: { old: number.callingEnabled, new: enable } },
      });
      return row;
    });
    return {
      callingEnabled: updated.callingEnabled,
      callingEnabledAt: updated.callingEnabledAt?.toISOString() ?? null,
    };
  }

  /**
   * What the inbox needs to show and run the Call button for one conversation (WD-CALL-006). WaDesk worked this out per list row from
   * the workspace's FIRST WhatsApp number, so with several numbers the permission could be read from the wrong one; here it is the
   * number the conversation is on, and `usable` is decided on the server.
   */
  async eligibility(conversationUuid: string): Promise<CallEligibility> {
    const { orgId } = caller();
    const none: CallEligibility = {
      enabled: false,
      numberId: null,
      contactPhone: null,
      permission: null,
      usable: false,
    };
    return this.db.tx(async (tx) => {
      const conv = await this.repo.numberOfConversation(tx, orgId, conversationUuid);
      if (!conv) throw notFound('CALL_NOT_FOUND', 'Conversation');
      const digits = digitsOf(conv.peerKey);
      if (conv.configId === null || digits.length < 6 || digits.length > 15) return none;
      const number = await this.repo.numberById(tx, orgId, conv.configId);
      if (!number || !number.callingEnabled) return { ...none, contactPhone: digits };
      const perm = await this.repo.permission(tx, orgId, number.id, phoneForms(digits));
      return {
        enabled: true,
        numberId: number.uuid,
        contactPhone: digits,
        permission: permissionLabel(perm),
        usable: isUsable(perm),
      };
    });
  }
}
