import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type ConnectSmsSenderInput,
  type LookupSmsNumberInput,
  type SmsLookupResponse,
  type SmsSenderListResponse,
  type SmsSenderResponse,
  type ToggleSmsSenderInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  SMS_GATEWAY,
  type SmsCredentials,
  type SmsGateway,
} from '../../infra/providers/channel-sms/sms.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  credentialsToStore,
  deliveryReportUrl,
  isAlphanumeric,
  mergeMeta,
  randomToken,
  senderKey,
  smsLabel,
} from './sender-rules';
import { SmsAvailability } from './sms-availability.service';
import { SmsSendersRepository, type SenderRow } from './sms-senders.repository';

const MODULE_KEY = 'sms_senders';
const LOOKUP_TTL_SECONDS = 90 * 24 * 3600;

/** The keys a sender is stored with, as the encrypted JSON on its row. */
interface StoredCredentials {
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
}

/**
 * Connecting and managing SMS senders (TW-SMS-001 to 008).
 *
 * Connect follows Reference's order: the provider proves the keys, then the sender is saved (the same From value updates its row),
 * so nothing is stored for keys the provider refused. The keys are encrypted at rest and never returned.
 */
@Injectable()
export class SmsSendersService {
  private readonly logger = new Logger(SmsSendersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SmsSendersRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    private readonly entitlements: PlanEntitlementService,
    private readonly availability: SmsAvailability,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  /** What the API shows of a sender: never a key. */
  toResponse(row: SenderRow): SmsSenderResponse {
    const provider = row.meta.sms_provider === 'msg91' ? 'msg91' : 'twilio';
    return {
      id: row.uuid,
      senderKey: senderKey(row.uuid),
      provider,
      label: row.label || smsLabel(provider),
      fromNumber: row.fromNumber,
      alphanumeric: isAlphanumeric(row.fromNumber),
      active: row.status === 'connected',
      senderId: row.meta.sender_id ?? '',
      dltTemplateId: row.meta.dlt_template_id ?? '',
      ratePerSegment: row.meta.rate_per_segment ?? null,
      currency: row.meta.currency ?? 'USD',
      lastError: row.meta.last_error ?? null,
      deliveryReportUrl:
        provider === 'msg91' && row.meta.dlr_secret
          ? deliveryReportUrl(this.appUrl(), row.meta.dlr_secret)
          : null,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      rowVersion: row.rowVersion,
    };
  }

  /** The keys of a stored sender, decrypted; null when they cannot be read (a changed encryption key, a damaged row). */
  credentialsOf(row: SenderRow): SmsCredentials | null {
    if (!row.credentials) return null;
    try {
      const c = JSON.parse(this.crypto.decrypt(row.credentials)) as StoredCredentials;
      return {
        provider: row.meta.sms_provider === 'msg91' ? 'msg91' : 'twilio',
        from: row.fromNumber,
        accountSid: c.account_sid ?? '',
        authToken: c.auth_token ?? '',
        senderId: row.meta.sender_id ?? '',
        dltTemplateId: row.meta.dlt_template_id ?? '',
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<SmsSenderListResponse> {
    const { orgId } = RequestContextStore.require();
    const [rows, platformEnabled] = await Promise.all([
      this.db.tx((tx) => this.repo.list(tx, orgId)),
      this.availability.platformEnabled(),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      deliveryReportUrl: deliveryReportUrl(this.appUrl()),
      platformEnabled,
    };
  }

  async connect(input: ConnectSmsSenderInput): Promise<SmsSenderResponse> {
    const ctx = RequestContextStore.require();

    // Blank Twilio keys borrow the workspace's WhatsApp Twilio keys, each field on its own (TW-SMS-003 rule 1).
    let reuse: { accountSid: string; authToken: string } | null = null;
    if (input.provider === 'twilio' && (!input.accountSid || !input.authToken)) {
      const sealed = await this.db.tx((tx) => this.repo.twilioWhatsappCredentials(tx, ctx.orgId));
      if (sealed) {
        try {
          const c = JSON.parse(this.crypto.decrypt(sealed)) as StoredCredentials;
          reuse = { accountSid: c.account_sid ?? '', authToken: c.auth_token ?? '' };
        } catch {
          reuse = null;
        }
      }
    }
    const keys = credentialsToStore(input, reuse);
    const creds: SmsCredentials = {
      provider: input.provider,
      from: input.fromNumber,
      ...keys,
      senderId: input.senderId,
      dltTemplateId: input.dltTemplateId,
    };

    // The provider proves the keys BEFORE anything is stored.
    const verified = await this.gateway.verify(creds);
    if (!verified.ok) {
      throw new AppError(
        ERROR_CODES.SMS_CREDENTIALS_REJECTED,
        verified.error,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'accountSid', message: verified.error }],
      );
    }

    const sealed = this.crypto.encrypt(
      JSON.stringify({
        account_sid: keys.accountSid,
        auth_token: keys.authToken,
        from_number: input.fromNumber,
      } satisfies StoredCredentials),
    );

    const saved = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByFrom(tx, ctx.orgId, input.fromNumber);
      // The cap is checked only for a NEW sender: updating one never needs a place (TW-SMS-002 rule 6).
      if (!existing) {
        await this.entitlements.assertWithinLimit(
          ctx.orgId,
          'devices',
          await this.repo.countDeviceRows(tx, ctx.orgId),
        );
      }
      const { row, created } = await this.repo.upsert(tx, ctx.orgId, {
        from: input.fromNumber,
        label: smsLabel(input.provider),
        credentials: sealed,
        meta: mergeMeta(existing?.meta, input, () => randomToken()),
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: created ? 'insert' : 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'sms.sender.connected',
        payload: { uuid: row.uuid, provider: input.provider, reconnected: !created },
      });
      return row;
    });
    this.logger.log({ orgId: ctx.orgId, provider: input.provider }, 'sms sender connected');
    return this.toResponse(saved);
  }

  /** Switch a sender on or off without losing its keys. A stale `rowVersion` is a 409. */
  async toggle(uuid: string, input: ToggleSmsSenderInput): Promise<SmsSenderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('SMS number', uuid);
      if (row.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('SMS number');
      const was = row.status === 'connected';
      if (was === input.active) return this.toResponse(row);
      const next = await this.repo.setStatus(
        tx,
        ctx.orgId,
        row.id,
        input.active ? 'connected' : 'disconnected',
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { active: { old: was, new: input.active } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'sms.sender.toggled',
        payload: { uuid: row.uuid, active: input.active },
      });
      return this.toResponse(next);
    });
  }

  /**
   * Delete a sender and its keys. An unknown (or another workspace's) id changes nothing and answers the same, as Reference's
   * "SMS number removed." did. Broadcasts and campaigns that named it keep a dangling id and fall back to the next connected
   * sender at send time (TW-SMS-007 rule 2).
   */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) return;
      await this.repo.remove(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'sms.sender.removed',
        payload: { uuid: row.uuid, provider: row.meta.sms_provider ?? 'twilio' },
      });
    });
  }

  /** "Check a number before you text it" (TW-SMS-008). Answers 200 with a sentence whatever the outcome. */
  async lookup(input: LookupSmsNumberInput): Promise<SmsLookupResponse> {
    const { orgId } = RequestContextStore.require();
    const digits = input.number.replace(/\D+/g, '');
    if (!digits) return unknown(digits, 'That is not a phone number.');

    const sender = await this.db.tx((tx) => this.repo.firstConnectedTwilio(tx, orgId));
    const creds = sender ? this.credentialsOf(sender) : null;
    if (!creds) return unknown(digits, 'Connect a Twilio SMS number first.');

    // Scoped by workspace: Reference shared one cache across every workspace (and every provider).
    const cacheKey = `sms:lookup:${orgId}:${digits}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as SmsLookupResponse;
      } catch {
        // an unreadable entry is a miss
      }
    }

    const res = await this.gateway.lookup(creds, digits);
    const out: SmsLookupResponse = {
      digits: res.digits || digits,
      kind: res.kind,
      carrier: res.carrier,
      message: res.message,
    };
    // Only a real verdict is kept: a provider error must not stick for 90 days.
    if (res.ok)
      await this.redis
        .set(cacheKey, JSON.stringify(out), 'EX', LOOKUP_TTL_SECONDS)
        .catch(() => undefined);
    return out;
  }
}

const unknown = (digits: string, message: string): SmsLookupResponse => ({
  digits,
  kind: 'unknown',
  carrier: null,
  message,
});
