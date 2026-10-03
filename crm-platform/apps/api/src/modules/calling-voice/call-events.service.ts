import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import type { InboundContext } from '../whatsapp-cloud-api-waba';
import { callBubble, digitsOf, metaTime } from './calling.rules';
import { CallsRepository, type CallRow } from './calls.repository';
import { CallPermissionService } from './call-permission.service';

type MetaCall = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const UNIQUE_VIOLATION = '23505';

/**
 * What Meta tells us about calls (TW-CALL-002, 006, 011, 017, 021): the `calls` field of the WhatsApp webhook, after the WABA domain
 * has authenticated it and found the workspace and the number. Three events: `connect` (a call rings, or our outbound call was
 * answered), `terminate` (it is over) and `permission_update` (the customer answered a permission request).
 *
 * Meta sends each event at least once and in no promised order, so every handler is idempotent: a call is found by Meta's id (or by the
 * correlation id we sent with the dial), updated rather than duplicated, and a thread bubble is written once. One event failing never
 * stops the others in the same delivery, and never makes Meta retry the whole delivery (the failure is logged).
 */
@Injectable()
export class CallEventsService {
  private readonly logger = new Logger(CallEventsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly permissions: CallPermissionService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async handle(ctx: InboundContext, value: Record<string, unknown>): Promise<void> {
    const calls = Array.isArray(value.calls) ? (value.calls as MetaCall[]) : [];
    const events = calls.map((c) => String(c.event ?? '').toLowerCase());
    this.logger.log({ orgId: ctx.orgId, events }, 'calls webhook');
    for (const call of calls) {
      try {
        switch (String(call.event ?? '').toLowerCase()) {
          case 'connect':
            await this.onConnect(ctx, call);
            break;
          case 'terminate':
            await this.onTerminate(ctx, call);
            break;
          case 'permission_update':
            await this.permissions.record(
              ctx.orgId,
              ctx.configId,
              call.from,
              call.response,
              call.expiration_timestamp,
            );
            break;
          default:
            this.logger.warn({ orgId: ctx.orgId, event: call.event }, 'unknown call event ignored');
        }
      } catch (err) {
        this.logger.error({ orgId: ctx.orgId, event: call.event, err }, 'a call event failed');
      }
    }
  }

  // --- connect ---------------------------------------------------------------------------------------------------------------

  /**
   * A call rang, or the customer picked up ours (TW-CALL-011). An inbound call becomes a `ringing` row matched to the customer's
   * contact and thread; our own outbound call becomes `active` and keeps Meta's answer SDP for the dialler's poll. A second `connect`
   * for the same call updates the row.
   */
  private async onConnect(ctx: InboundContext, call: MetaCall): Promise<void> {
    const metaCallId = str(call.id);
    if (!metaCallId) return; // nothing to match it by
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.db.txAs({ orgId: ctx.orgId }, (tx) => this.connect(tx, ctx, metaCallId, call));
        return;
      } catch (err) {
        // Two deliveries of the same connect inserted at once: the second finds the first's row on the retry.
        if ((err as { code?: string }).code !== UNIQUE_VIOLATION || attempt === 1) throw err;
      }
    }
  }

  private async connect(
    tx: Tx,
    ctx: InboundContext,
    metaCallId: string,
    call: MetaCall,
  ): Promise<void> {
    const orgId = ctx.orgId;
    const session = call.session as { sdp_type?: unknown } | undefined;
    const existing = await this.repo.byMetaOrCorrelation(
      tx,
      orgId,
      metaCallId,
      str(call.biz_opaque_callback_data),
    );
    const outbound =
      String(session?.sdp_type ?? '').toLowerCase() === 'answer' ||
      existing?.direction === 'BUSINESS_INITIATED' ||
      call.direction === 'BUSINESS_INITIATED';
    const from = digitsOf(call.from);
    const to = digitsOf(call.to);
    const customer = outbound ? to : from;
    const startedAt = metaTime(call.timestamp) ?? new Date();

    let row: CallRow;
    if (existing) {
      row = existing;
      const live = existing.status === 'ringing' || existing.status === 'connecting';
      await this.repo.patchCall(tx, orgId, existing.id, {
        metaCallId,
        meta: call,
        ...(outbound && live ? { status: 'active', answeredAt: new Date() } : {}),
      });
    } else {
      const thread = await this.repo.threadFor(tx, orgId, ctx.configId, customer);
      const contact = thread?.contactId
        ? { id: thread.contactId }
        : await this.repo.contactByPhone(tx, orgId, customer);
      row = await this.repo.insertCall(tx, orgId, {
        configId: ctx.configId,
        metaCallId,
        direction: outbound ? 'BUSINESS_INITIATED' : 'USER_INITIATED',
        fromPhone: from,
        toPhone: to,
        contactId: contact?.id ?? null,
        conversationId: thread?.conversationId ?? null,
        status: outbound ? 'active' : 'ringing',
        startedAt,
        meta: call,
      });
    }
    await this.repo.logEvent(tx, orgId, row.id, 'connect', call);
  }

  // --- terminate -------------------------------------------------------------------------------------------------------------

  /**
   * The call is over (TW-CALL-017): the row is closed with Meta's own status and duration (Meta's account of it wins over anything the
   * browser said), and the customer's thread gets one bubble saying what happened. A delivery repeated, or one for a call we never
   * saw, changes nothing more.
   */
  private async onTerminate(ctx: InboundContext, call: MetaCall): Promise<void> {
    const metaCallId = str(call.id);
    if (!metaCallId) return;
    const closed = await this.db.txAs({ orgId: ctx.orgId }, async (tx) => {
      const row = await this.repo.byMetaOrCorrelation(tx, ctx.orgId, metaCallId, null);
      if (!row) return null;
      const durationSec = Math.max(0, Math.round(Number(call.duration) || 0));
      const endReason = str(call.status) ?? 'COMPLETED';
      await this.repo.patchCall(tx, ctx.orgId, row.id, {
        status: 'ended',
        endReason,
        endedAt: metaTime(call.end_time) ?? new Date(),
        durationSec,
        errorPayload: call.errors ?? null,
      });
      await this.repo.logEvent(tx, ctx.orgId, row.id, 'terminate', call);
      const customer = row.direction === 'BUSINESS_INITIATED' ? row.toPhone : row.fromPhone;
      const thread = await this.repo.threadFor(tx, ctx.orgId, ctx.configId, customer);
      return {
        row,
        durationSec,
        endReason,
        channelUuid: thread?.conversationId ? thread.channelUuid : null,
        customer,
      };
    });
    if (!closed || !closed.channelUuid) return;

    const bubble = callBubble({
      durationSec: closed.durationSec,
      endReason: closed.endReason,
      direction: closed.row.direction,
    });
    try {
      // The ledger key makes a repeated terminate a no-op: one bubble per call.
      await this.conversations.recordOutbound({
        channelId: closed.channelUuid,
        peerKey: closed.customer,
        source: 'call',
        kind: 'system',
        direction: bubble.side,
        body: bubble.label,
        providerMessageId: `call:${closed.row.uuid}`,
        meta: {
          event: 'call',
          callId: closed.row.uuid,
          callStatus: bubble.callStatus,
          callDirection: bubble.side,
          durationSec: closed.durationSec,
        },
      });
    } catch (err) {
      // The bubble is a courtesy; the call is already closed and logged.
      this.logger.warn({ orgId: ctx.orgId, err }, 'call bubble not written');
    }
  }
}
