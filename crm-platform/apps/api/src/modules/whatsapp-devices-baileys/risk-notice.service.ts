import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  PERSONAL_WA_NOTICE_VERSION,
  personalWaNoticeCanonicalText,
  type AcknowledgementInput,
  type RiskNoticeStatus,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { isCurrentNotice } from './device-rules';
import { DevicesRepository } from './devices.repository';

/** SHA-256 (hex) of the canonical English text of the version in force: stored with every acknowledgement as proof of the wording shown. */
export const noticeTextSha256 = (): string =>
  createHash('sha256').update(personalWaNoticeCanonicalText(), 'utf8').digest('hex');

/** A hash of the caller's address, never the address (spec 6.2). */
const ipHashOf = (ip: string | undefined): string | null =>
  ip ? createHash('sha256').update(`wadev-ack:${ip}`, 'utf8').digest('hex') : null;

/** 409 PERSONAL_WA_NOTICE_REQUIRED: the caller has not accepted the CURRENT version. */
export const noticeRequired = (): AppError =>
  new AppError(
    ERROR_CODES.PERSONAL_WA_NOTICE_REQUIRED,
    'Read and accept the notice about connecting a personal WhatsApp number before you continue.',
    HttpStatus.CONFLICT,
    [{ path: 'requiredVersion', message: PERSONAL_WA_NOTICE_VERSION }],
  );

/**
 * The risk acknowledgement (spec 6): who accepted which version of the notice, when, with a hash of the exact English text, the locale it
 * was shown in, and a hash of the address. Append-only (a trigger refuses edits). Each person accepts for themselves; a device is created
 * and every pairing is started only by someone who has accepted the CURRENT version, so raising the version asks everybody again.
 */
@Injectable()
export class RiskNoticeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DevicesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The caller's own standing for the version in force. */
  async status(): Promise<RiskNoticeStatus> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => this.statusIn(tx, ctx.orgId, ctx.userId));
  }

  async statusIn(tx: Tx, orgId: number, userId: number | null): Promise<RiskNoticeStatus> {
    const ack =
      userId === null
        ? null
        : await this.repo.acknowledgementOf(tx, orgId, userId, PERSONAL_WA_NOTICE_VERSION);
    return {
      version: PERSONAL_WA_NOTICE_VERSION,
      accepted: ack !== null,
      acceptedAt: ack ? ack.acceptedAt.toISOString() : null,
    };
  }

  /** `POST /v2/devices/risk-notice`: records one acknowledgement; idempotent per (person, version). */
  async accept(input: AcknowledgementInput): Promise<RiskNoticeStatus> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.ensure(tx, ctx.orgId, ctx.userId, input, null);
      return this.statusIn(tx, ctx.orgId, ctx.userId);
    });
  }

  /**
   * Makes sure the caller has accepted the current version inside `tx` and returns that acknowledgement's id. An existing one is reused;
   * otherwise the inline acknowledgement is recorded (audit and outbox in the same transaction); with neither: 409.
   */
  async ensure(
    tx: Tx,
    orgId: number,
    userId: number | null,
    inline: AcknowledgementInput | undefined | null,
    deviceUuid: string | null,
  ): Promise<number> {
    if (userId === null) throw AppError.forbidden('wa.devices.create');
    const existing = await this.repo.acknowledgementOf(
      tx,
      orgId,
      userId,
      PERSONAL_WA_NOTICE_VERSION,
    );
    if (existing) return existing.id;
    if (!inline) throw noticeRequired();
    // An older version, or flags that are not all ticked, is not an acknowledgement of the text in force.
    if (!isCurrentNotice(inline.version)) throw noticeRequired();
    const ctx = RequestContextStore.require();
    const name = (await this.repo.userName(tx, orgId, userId)) ?? 'Unknown';
    const ack = await this.repo.insertAcknowledgement(tx, orgId, {
      userId,
      userName: name,
      version: PERSONAL_WA_NOTICE_VERSION,
      textSha256: noticeTextSha256(),
      locale: inline.locale,
      deviceUuid,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
      ipHash: ipHashOf(ctx.ip),
    });
    await this.audit.record(tx, {
      module: 'device_risk_acknowledgements',
      recordId: ack.id,
      action: 'insert',
      delta: { policy_version: { old: null, new: PERSONAL_WA_NOTICE_VERSION } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'device_risk_acknowledgements',
      aggregateId: ack.id,
      eventType: 'device.risk_acknowledged',
      payload: { policyVersion: PERSONAL_WA_NOTICE_VERSION, locale: inline.locale },
    });
    return ack.id;
  }
}
