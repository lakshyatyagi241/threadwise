import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES, FLOW_HOOK_MAX_BODY_BYTES, type FlowWebhookInfo } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { liveTrigger } from '../runtime/live-graph';
import { deliveryKey, payloadVariables, personOf } from './external-payload';
import { flowHookToken, flowHookTokenMatches } from './flow-hook-token';
import { FlowTriggerService } from './trigger.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A delivery id is remembered this long: a sender's retry after a timeout, a day later at the latest, starts nothing. */
const DELIVERY_TTL_SECONDS = 86_400;
/** Posts one flow takes in a minute (a flow is not a broadcast). Over it the sender is told to wait. */
export const FLOW_HOOK_PER_FLOW_PER_MINUTE = 300;

/** One answer for "no such hook": a wrong token, an unknown flow, a draft, a paused flow, another trigger. Nothing tells them apart. */
const unknownHook = (): AppError => AppError.notFound('Flow hook');

export interface FlowHookAck {
  ok: true;
  /** `started`: a run began. `duplicate`: this delivery was already received. `not_started`: the contact is already in the flow, or it refused. */
  status: 'started' | 'duplicate' | 'not_started';
}

/**
 * The public door of the Webhook trigger: `POST /v2/public/flow-hooks/<flow uuid>/<token>`. The token is an HMAC of the flow's uuid
 * (`flowHookToken`), checked in constant time BEFORE the database is touched, so a guess costs no query and an unknown flow answers
 * exactly like a wrong token. Only a published, active flow whose live trigger is a Webhook starts; anything else is the same 404.
 *
 * Past that door the sender is trusted with that one flow: a body that names nobody is told so (422). A delivery is remembered
 * (the sender's `Idempotency-Key` / `X-Delivery-Id`, else a hash of the body) so a retry starts nothing; a start that could not
 * find or make a contact forgets it again, so the corrected post goes through.
 */
@Injectable()
export class FlowHookService {
  private readonly logger = new Logger(FlowHookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly triggers: FlowTriggerService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The server secrets a token is made under: the current key first, then the retired ones still kept for rotation. */
  secrets(): string[] {
    const current = this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    const previous = (
      this.config.get('CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS', { infer: true }) ?? ''
    )
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    return [current, ...previous];
  }

  /** The token staff paste into the other system. */
  tokenFor(flowUuid: string): string {
    return flowHookToken(this.secrets()[0]!, flowUuid);
  }

  /** The address of one flow of the caller's workspace, and whether it can start from it now. A flow of another workspace is a 404. */
  async info(flowUuid: string): Promise<FlowWebhookInfo> {
    const orgId = RequestContextStore.require().orgId;
    const row = await this.db.tx(async (tx) => {
      const res = (await tx.execute(sql`
        SELECT is_published, is_active, ${liveTrigger('trigger_kind')} AS kind FROM flows
         WHERE org_id = ${orgId} AND uuid = ${flowUuid}::uuid`)) as unknown as {
        rows: Array<{ is_published: boolean; is_active: boolean; kind: string | null }>;
      };
      return res.rows[0];
    });
    if (!row) throw AppError.notFound('Flow');
    const path = `/v2/public/flow-hooks/${flowUuid.toLowerCase()}/${this.tokenFor(flowUuid)}`;
    const base = this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
    return {
      path,
      url: `${base}${path}`,
      live: row.is_published && row.is_active && row.kind === 'webhook',
    };
  }

  async receive(
    flowUuid: string,
    token: string,
    raw: Buffer,
    deliveryHeader: string | undefined,
  ): Promise<FlowHookAck> {
    if (!UUID.test(flowUuid) || token.length > 128) throw unknownHook();
    if (!flowHookTokenMatches(this.secrets(), flowUuid, token)) throw unknownHook();
    const flow = await this.liveFlow(flowUuid.toLowerCase());
    if (!flow) throw unknownHook();

    if (!(await this.withinRate(flow.id))) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many posts for this flow; wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const body = this.bodyOf(raw);
    const key = deliveryKey(deliveryHeader, raw);
    const claimKey = `flr:hook:${flow.id}:${key}`;
    const claimed = await this.redis.set(claimKey, '1', 'EX', DELIVERY_TTL_SECONDS, 'NX');
    if (claimed === null) return { ok: true, status: 'duplicate' };

    try {
      const vars = payloadVariables(body);
      const result = await this.triggers.onExternalEvent(
        flow.orgId,
        flow.id,
        'flow_webhook',
        `webhook:${flow.id}:${key}`,
        personOf(vars),
        vars,
      );
      if (result === 'plan_limit') {
        await this.redis.del(claimKey).catch(() => 0);
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'The workspace has reached its contact limit, so this contact could not be created.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (result === 'no_contact') {
        await this.redis.del(claimKey).catch(() => 0);
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'The body needs a usable "phone" (or "email") to find or create the contact.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return { ok: true, status: result };
    } catch (err) {
      // A failure of ours (not the sender's 422) must not eat the delivery: the sender's retry has to be able to start the flow.
      if (!(err instanceof AppError)) {
        await this.redis.del(claimKey).catch(() => 0);
        this.logger.error({ err, flowId: flow.id }, '[FLR] flow hook failed');
      }
      throw err;
    }
  }

  private async liveFlow(uuid: string): Promise<{ orgId: number; id: number } | null> {
    return this.db.privileged(async (tx) => {
      const res = (await tx.execute(sql`
        SELECT org_id, id FROM flows
         WHERE uuid = ${uuid}::uuid AND is_published AND is_active AND ${liveTrigger('trigger_kind')} = 'webhook'`)) as unknown as {
        rows: Array<{ org_id: string | number; id: string | number }>;
      };
      const r = res.rows[0];
      return r ? { orgId: Number(r.org_id), id: Number(r.id) } : null;
    });
  }

  private async withinRate(flowId: number): Promise<boolean> {
    const key = `flr:hook:rate:${flowId}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 90);
      return n <= FLOW_HOOK_PER_FLOW_PER_MINUTE;
    } catch {
      return true;
    }
  }

  private bodyOf(raw: Buffer): Record<string, unknown> {
    if (raw.length > FLOW_HOOK_MAX_BODY_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'The request body is too large.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      parsed = null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Send a JSON object, for example {"phone":"+12025550123","name":"Asha"}.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return parsed as Record<string, unknown>;
  }
}
