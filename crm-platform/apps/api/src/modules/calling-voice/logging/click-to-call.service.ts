import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CallCheckInput,
  type CallCheckResult,
  type ClickToCallInput,
  type ClickToCallResult,
  type ConsentGateResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { TelephonyProviderRegistry } from '../../../infra/providers/telephony';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ConsentGate } from '../../contact-consent';
import { ContactResolverService } from '../../crm';
import { CallLogEntriesRepository } from './call-log-entries.repository';
import { CallLogEntriesService, contactRequired } from './call-log-entries.service';
import { e164Of } from './call-logging.rules';
import { TelephonyConnectionsService, connectionNotFound } from './telephony-connections.service';

const MODULE = 'telephony_click_calls';

const unsupported = (message: string) =>
  new AppError(ERROR_CODES.TELEPHONY_CLICK_UNSUPPORTED, message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Placing a call through the workspace's telephony provider (click-to-call: the provider rings the person first, then the customer),
 * and asking beforehand whether a call may be placed. LOGGING a call is never refused by a consent rule; PLACING one is a send, so it
 * asks the ConsentGate on the voice channel:
 *
 *  - `service` (a call about an order or a request): refused only for a contact who withdrew the service purpose by voice;
 *  - `marketing` (a sales or promotional call): refused for a number on the workspace's Do-Not-Call list (`on_dnc_list`), for a withdrawal
 *    (the Unsubscribed flag or a STOP), for a flagged minor under the children setting, and, when the workspace requires recorded consent
 *    for marketing, for a contact with no recorded grant on the voice channel.
 *
 * The finished call is not written here: the provider reports it on the connection's callback, and the placement kept below hands the
 * entry its handler and contact.
 */
@Injectable()
export class ClickToCallService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: TelephonyProviderRegistry,
    private readonly connections: TelephonyConnectionsService,
    private readonly entries: CallLogEntriesService,
    private readonly repo: CallLogEntriesRepository,
    private readonly resolver: ContactResolverService,
    private readonly gate: ConsentGate,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The gate's answer for a call to this contact or number, without placing anything. */
  async check(input: CallCheckInput): Promise<CallCheckResult> {
    const ctx = RequestContextStore.require();
    const cc = await this.resolver.defaultCountryCode();
    const phone = input.customerPhone ? e164Of(input.customerPhone, cc) : null;
    if (input.customerPhone && !phone) {
      throw contactRequired('customerPhone', 'That is not a phone number.');
    }
    return this.db.tx(async (tx) => {
      const subject = await this.subjectOf(tx, ctx, input.contactId, phone);
      const verdict = await this.verdict(ctx.orgId, subject.subject, input.purpose);
      return { decision: verdict.decision, reason: verdict.reason };
    });
  }

  async place(input: ClickToCallInput): Promise<ClickToCallResult> {
    const ctx = RequestContextStore.require();
    const cc = await this.resolver.defaultCountryCode();
    const typed = input.customerPhone ? e164Of(input.customerPhone, cc) : null;
    if (input.customerPhone && !typed) {
      throw contactRequired('customerPhone', 'That is not a phone number.');
    }

    // 1. Everything that can be refused is decided before the provider is asked.
    const plan = await this.db.tx(async (tx) => {
      const conn = await this.connections.find(tx, ctx.orgId, input.connectionId);
      if (!conn) throw connectionNotFound();
      if (conn.status !== 'active') throw unsupported('This telephony connection is disabled.');
      const provider = this.registry.get(conn.provider);
      if (!provider?.supportsClickToCall) {
        throw unsupported('This telephony provider reports calls but cannot place them.');
      }
      const subject = await this.subjectOf(tx, ctx, input.contactId, typed);
      const customer =
        typed ??
        (subject.contact
          ? e164Of(await this.repo.contactPhone(tx, ctx.orgId, subject.contact.id), cc)
          : null);
      if (!customer) throw contactRequired('customerPhone', 'There is no number to call.');
      const agentRaw = input.agentPhone ?? (await this.repo.userPhone(tx, ctx.orgId, ctx.userId!));
      const agent = agentRaw ? e164Of(agentRaw, cc) : null;
      if (!agent) {
        throw contactRequired(
          'agentPhone',
          'Add your phone number to your profile, or give the number to ring first.',
        );
      }
      return { conn, provider, subject, customer, agent };
    });
    const verdict = await this.verdict(ctx.orgId, plan.subject.subject, input.purpose);
    if (verdict.decision !== 'allow') {
      throw new AppError(
        ERROR_CODES.CONSENT_OPTED_OUT,
        'This number cannot be called for this purpose.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'reason', message: verdict.reason }],
      );
    }

    // 2. The provider rings. Its refusal is an expected outcome, not a fault.
    const placed = await plan.provider.clickToCall({
      agentNumber: plan.agent,
      customerNumber: plan.customer,
      ourNumber: plan.conn.numbers[0] ?? null,
      correlationId: randomUUID(),
    });
    if (!placed.ok) {
      throw new AppError(
        ERROR_CODES.TELEPHONY_CALL_FAILED,
        placed.error,
        HttpStatus.UNPROCESSABLE_ENTITY,
        placed.code ? [{ path: 'code', message: placed.code }] : undefined,
      );
    }

    // 3. Remember who placed it, so the provider's report of the finished call finds its handler and contact.
    await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO telephony_click_calls (org_id, connection_id, external_id, user_id, contact_id, customer_phone)
        VALUES (${ctx.orgId}, ${plan.conn.id}, ${placed.callId}, ${ctx.userId}, ${plan.subject.contact?.id ?? null}, ${plan.customer})
        ON CONFLICT (org_id, connection_id, external_id) DO NOTHING
        RETURNING id`);
      const id = Number((res.rows[0] as { id?: unknown } | undefined)?.id ?? 0);
      if (id === 0) return;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: { purpose: { old: null, new: input.purpose } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: id,
        eventType: 'call.click_to_call.placed',
        payload: {
          connectionId: plan.conn.uuid,
          purpose: input.purpose,
          contactId: plan.subject.contact?.uuid ?? null,
        },
      });
    });
    return { callRef: placed.callId, contactId: plan.subject.contact?.uuid ?? null };
  }

  // --- internals -------------------------------------------------------------------------------------------------------------------

  private verdict(
    orgId: number,
    subject: { type: 'contact'; id: number } | { type: 'phone'; phone: string },
    purpose: 'service' | 'marketing',
  ): Promise<ConsentGateResult> {
    return this.gate.check(
      orgId,
      subject,
      'voice',
      purpose === 'marketing' ? 'marketing_messaging' : 'service_messaging',
      'voice',
    );
  }

  /** Who is being called, as the gate wants to know them: the contact when there is one, else the bare number. */
  private async subjectOf(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    contactUuid: string | undefined,
    phone: string | null,
  ) {
    const found = await this.entries.contactFor(tx, ctx.orgId, ctx.userId, ctx.grants!, {
      contactUuid,
      phone,
    });
    // A contact the person may not read still withdrew, or is on the Do-Not-Call list: the gate must see them, the answer must not name them.
    const hidden =
      !found.contact && found.hidden && phone
        ? await this.repo.contactByPhone(tx, ctx.orgId, phone, phone.slice(1))
        : null;
    const gateId = found.contact?.id ?? hidden?.id;
    if (gateId !== undefined) {
      return { contact: found.contact, subject: { type: 'contact' as const, id: gateId } };
    }
    if (!phone) throw contactRequired('contactId', 'Give the contact or the phone number.');
    return { contact: null, subject: { type: 'phone' as const, phone } };
  }
}
