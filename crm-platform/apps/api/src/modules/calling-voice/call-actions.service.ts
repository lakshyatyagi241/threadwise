import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import {
  CALL_RING_WINDOW_MINUTES,
  ERROR_CODES,
  type DialInput,
  type DialProgress,
  type DialResult,
  type PendingCallList,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { CALLING_GRAPH, type CallingGraph } from '../../infra/providers/calling-voice';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { SendWindowService } from '../compliance-center';
import { ConsentGate } from '../contact-consent';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WabaConnectService } from '../whatsapp-cloud-api-waba';
import { digitsOf, isPermissionRefusal, usableAnswer } from './calling.rules';
import { CallsRepository, type CallRow } from './calls.repository';
import { CallPermissionService } from './call-permission.service';
import { caller, notFound, refused, unprocessable, usableNumber } from './calling-support';

/** Meta needs a moment between pre_accept and accept; accept without it clips the opening audio (TW-CALL-013 rule 3). */
export const PRE_ACCEPT_GAP_MS = 900;

/** What a failed dial stores as the reason the call never happened. */
const NO_PERMISSION = 'NO_PERMISSION';

/**
 * What an operator does with a call (TW-CALL-008, 010, 012, 013, 015, 016): place one, follow its progress, see the ringing ones,
 * answer, decline, hang up. Every action tells Meta first and writes the local state from the answer; the call is finally closed by
 * Meta's own `terminate` event (`CallEventsService`), whatever the browser did.
 */
@Injectable()
export class CallActionsService {
  private readonly logger = new Logger(CallActionsService.name);

  /** Replaceable in tests so the gap between pre_accept and accept does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly waba: WabaConnectService,
    private readonly permissions: CallPermissionService,
    private readonly plans: PlanEntitlementService,
    @Inject(CALLING_GRAPH) private readonly graph: CallingGraph,
    private readonly consentGate: ConsentGate,
    private readonly sendWindow: SendWindowService,
  ) {}

  // --- dial ------------------------------------------------------------------------------------------------------------------

  /**
   * Places an outbound call (TW-CALL-008). Permission first: with no usable grant no call is placed, a permission request goes out
   * instead and the answer is 422 `CALL_PERMISSION_REQUESTED`. The call row is written before Meta is asked (the correlation id comes
   * back in the connect webhook) and, unlike Reference, is marked `failed` when Meta refuses, so no `ringing` call is left behind.
   */
  async dial(input: DialInput): Promise<DialResult> {
    const { orgId, userId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const to = digitsOf(input.to);
    const ctx = await this.db.tx(async (tx) => {
      const u = await usableNumber(tx, orgId, this.repo, this.waba, { uuid: input.numberId });
      if (!u.number.callingEnabled) {
        throw unprocessable('CALL_NOT_ENABLED', 'Calling is not switched on for this number.');
      }
      const contactId = input.contactId
        ? await this.repo.contactIdByUuid(tx, orgId, input.contactId)
        : null;
      const conversationId = input.conversationId
        ? await this.repo.conversationIdByUuid(tx, orgId, input.conversationId)
        : null;
      return { ...u, contactId, conversationId };
    });

    // An operator's call (and its permission request) is a service action, voice modality (BL-141): it is refused only for a contact
    // who withdrew the service purpose by voice. A campaign call would be `marketing_messaging` and honour STOP; none exists yet.
    if (ctx.contactId !== null) {
      const verdict = await this.consentGate.check(
        orgId,
        { type: 'contact', id: ctx.contactId },
        'voice',
        'service_messaging',
        'voice',
      );
      if (verdict.decision === 'deny') {
        throw unprocessable('CONSENT_OPTED_OUT', 'This contact has asked not to be called.');
      }
    }
    await this.assertCallingWindow(orgId, ctx.contactId, ctx.conversationId, to);
    if (!(await this.permissions.mayCall(orgId, ctx.number.id, to))) {
      const alreadyPermitted = await this.permissions.send(orgId, ctx.number, ctx.conn, to);
      if (!alreadyPermitted) throw this.permissionRequested();
    }

    const correlation = randomUUID();
    const call = await this.db.tx(async (tx) => {
      const row = await this.repo.insertCall(tx, orgId, {
        configId: ctx.number.id,
        correlationId: correlation,
        direction: 'BUSINESS_INITIATED',
        fromPhone: digitsOf(ctx.number.phoneNumber),
        toPhone: to,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        status: 'ringing',
        startedAt: new Date(),
      });
      await this.repo.logEvent(tx, orgId, row.id, 'dial_sent', { to, by: userId });
      return row;
    });

    try {
      const meta = await this.graph.callAction(ctx.conn, 'connect', {
        to,
        sdp: { type: 'offer', sdp: input.sdpOffer },
        opaque: correlation,
      });
      const calls = (meta as { calls?: Array<{ id?: string }> }).calls;
      const metaCallId = calls?.[0]?.id ?? (typeof meta.id === 'string' ? meta.id : null);
      await this.db.tx((tx) => this.repo.patchCall(tx, orgId, call.id, { metaCallId, meta }));
      return { callId: call.uuid, metaCallId, correlation };
    } catch (err) {
      const message = err instanceof WabaApiError ? (err.userMessage ?? err.message) : String(err);
      // Meta's code 138006 says it outright; older answers only say "permission" in a sentence.
      const noPermission =
        isPermissionRefusal(message) || (err instanceof WabaApiError && err.code === 138006);
      await this.db.tx(async (tx) => {
        await this.repo.patchCall(tx, orgId, call.id, {
          status: 'failed',
          endedAt: new Date(),
          endReason: noPermission ? NO_PERMISSION : 'META_REFUSED',
          errorPayload: err instanceof WabaApiError ? err.body : { message },
        });
        await this.repo.logEvent(tx, orgId, call.id, 'dial_failed', { message });
      });
      if (noPermission) {
        // Meta says there is no approved permission (our ledger was stale): ask for it, as if we had known.
        await this.permissions.send(orgId, ctx.number, ctx.conn, to).catch(() => undefined);
        throw this.permissionRequested();
      }
      throw refused(err, 'Meta refused the call');
    }
  }

  /**
   * The calling window (BL-177): a business-initiated call outside the hours the workspace set is refused, because a live call cannot wait
   * for the window to open (a message would be held; a call has no queue). The refusal names the instant the window opens. A call back to
   * someone who reached us in the last 24 hours (a message or a call) is service and is never held. Runs before anything is asked of Meta,
   * so no permission request goes out and no call row is written.
   */
  private async assertCallingWindow(
    orgId: number,
    contactId: number | null,
    conversationId: number | null,
    to: string,
  ): Promise<void> {
    const decision = await this.sendWindow.check(orgId, 'call', { contactId, phone: to });
    if (decision.decision !== 'hold') return;
    const answered = await this.db.tx((tx) =>
      this.repo.contactedUsRecently(tx, orgId, { conversationId, phone: to, hours: 24 }),
    );
    if (answered) return;
    throw unprocessable(
      'CALL_OUTSIDE_WINDOW',
      `Calls to this contact are allowed from ${decision.until}. It is outside the workspace's calling hours.`,
      [
        { path: 'opensAt', message: decision.until },
        ...(decision.zone ? [{ path: 'zone', message: decision.zone }] : []),
        { path: 'zoneSource', message: decision.zoneSource },
      ],
    );
  }

  private permissionRequested(): AppError {
    return unprocessable(
      'CALL_PERMISSION_REQUESTED',
      'No calling permission yet - we have sent them a request. You can call once they tap "Allow".',
    );
  }

  /** The dialler's poll (TW-CALL-010): has the customer picked up, and what is Meta's answer to the offer? */
  async progress(callUuid: string): Promise<DialProgress> {
    const { orgId } = caller();
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    const answer = call.meta?.session as { sdp?: unknown; sdp_type?: unknown } | undefined;
    const ended = call.status === 'ended' || call.status === 'failed';
    return {
      status: call.status,
      sdpAnswer: call.status === 'active' ? usableAnswer(answer?.sdp_type, answer?.sdp) : null,
      ended,
      endReason: ended ? call.endReason : null,
    };
  }

  // --- ringing ---------------------------------------------------------------------------------------------------------------

  /** The calls ringing now, for the incoming-call toast (TW-CALL-012): inbound, started in the last two minutes, newest first, five. */
  async pending(): Promise<PendingCallList> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const rows = await this.db.tx((tx) =>
      this.repo.ringing(tx, orgId, CALL_RING_WINDOW_MINUTES, 5),
    );
    return {
      calls: rows.map((r) => {
        const session = (r.meta_payload as { session?: { sdp?: unknown } } | null)?.session;
        return {
          id: String(r.uuid),
          direction: r.direction as 'USER_INITIATED',
          fromPhone: String(r.from_phone),
          toPhone: String(r.to_phone),
          contactId: (r.contact_uuid as string | null) ?? null,
          contactName: (r.contact_name as string | null) ?? null,
          startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
          metaCallId: (r.meta_call_id as string | null) ?? null,
          sdpOffer: typeof session?.sdp === 'string' ? session.sdp : null,
          aiHandled: r.assistant_id !== null,
        };
      }),
    };
  }

  // --- answering, declining, hanging up --------------------------------------------------------------------------------------

  /**
   * An operator answers (TW-CALL-013). One statement claims the ringing call for this person, so two operators pressing Accept at once
   * get one success and one 409. Then Meta's two steps: pre_accept, a short pause, accept, with the same SDP answer both times. If
   * either fails the call goes back to ringing so someone else can take it.
   */
  async accept(callUuid: string, sdpAnswer: string): Promise<void> {
    const { orgId, userId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const claimed = await this.db.tx(async (tx) => {
      const row = await this.repo.claim(tx, orgId, callUuid, userId ?? 0);
      if (row) return row;
      const existing = await this.repo.byUuid(tx, orgId, callUuid);
      if (!existing) throw notFound('CALL_NOT_FOUND', 'Call');
      throw new AppError(
        ERROR_CODES.CALL_STATE_CONFLICT,
        `This call is already ${existing.status === 'connecting' || existing.status === 'active' ? 'taken' : existing.status}.`,
        HttpStatus.CONFLICT,
      );
    });
    const { conn } = await this.connectionOf(orgId, claimed);
    if (!claimed.metaCallId) {
      await this.db.tx((tx) => this.repo.release(tx, orgId, claimed.id));
      throw unprocessable('CALL_META_REFUSED', 'This call has no WhatsApp id yet.');
    }
    try {
      const sdp = { type: 'answer' as const, sdp: sdpAnswer };
      await this.graph.callAction(conn, 'pre_accept', { callId: claimed.metaCallId, sdp });
      await this.db.tx((tx) =>
        this.repo.logEvent(tx, orgId, claimed.id, 'pre_accept_sent', { by: userId }),
      );
      await this.sleep(PRE_ACCEPT_GAP_MS);
      await this.graph.callAction(conn, 'accept', { callId: claimed.metaCallId, sdp });
    } catch (err) {
      await this.db.tx(async (tx) => {
        await this.repo.release(tx, orgId, claimed.id);
        await this.repo.logEvent(tx, orgId, claimed.id, 'accept_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
      throw refused(err, 'Meta refused to accept the call');
    }
    await this.db.tx(async (tx) => {
      await this.repo.patchCall(tx, orgId, claimed.id, {
        status: 'active',
        answeredAt: new Date(),
      });
      await this.repo.logEvent(tx, orgId, claimed.id, 'accept_sent', { by: userId });
    });
  }

  /** Declines a call that is still ringing (TW-CALL-015). A call already taken or over is a 409: nobody can reject a live call. */
  async reject(callUuid: string, reason?: string): Promise<void> {
    const { orgId } = caller();
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    if (call.status !== 'ringing') {
      throw new AppError(
        ERROR_CODES.CALL_STATE_CONFLICT,
        `This call is already ${call.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    const { conn } = await this.connectionOf(orgId, call);
    if (!call.metaCallId)
      throw unprocessable('CALL_META_REFUSED', 'This call has no WhatsApp id yet.');
    try {
      await this.graph.callAction(conn, 'reject', {
        callId: call.metaCallId,
        reason: reason ?? 'REJECTED',
      });
    } catch (err) {
      throw refused(err, 'Meta refused to reject the call');
    }
    await this.db.tx(async (tx) => {
      // The local reason is always REJECTED; Meta's terminate event later writes its own authoritative reason and duration.
      await this.repo.patchCall(tx, orgId, call.id, {
        status: 'ended',
        endReason: 'REJECTED',
        endedAt: new Date(),
      });
      await this.repo.logEvent(tx, orgId, call.id, 'reject_sent', { reason: reason ?? 'REJECTED' });
    });
  }

  /**
   * Ends a live call, or cancels one we placed that is still ringing (TW-CALL-016). The row is not closed here: Meta's terminate event
   * closes it with the official reason and duration. Idempotent: asking again for a call that is over answers 200 without Meta.
   */
  async terminate(callUuid: string): Promise<void> {
    const { orgId } = caller();
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    if (call.status === 'ended' || call.status === 'failed') return;
    const { conn } = await this.connectionOf(orgId, call);
    if (!call.metaCallId)
      throw unprocessable('CALL_META_REFUSED', 'This call has no WhatsApp id yet.');
    try {
      await this.graph.callAction(conn, 'terminate', { callId: call.metaCallId });
    } catch (err) {
      throw refused(err, 'Meta refused to end the call');
    }
    await this.db.tx((tx) => this.repo.logEvent(tx, orgId, call.id, 'terminate_sent', {}));
  }

  private async connectionOf(orgId: number, call: CallRow) {
    if (call.configId === null)
      throw unprocessable('CALL_NUMBER_NOT_CONNECTED', 'The number of this call was removed.');
    return this.db.tx((tx) =>
      usableNumber(tx, orgId, this.repo, this.waba, { id: call.configId! }),
    );
  }
}
