import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { WebhookDb } from '../../infra/db/side-pools';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { TtlCache } from '../../common/cache/ttl-cache';
import { QUEUES } from '../../infra/queue/queues';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../infra/providers/whatsapp/whatsapp.port';
import { sealJson } from '../../common/crypto/sealed-json';
import { addOrRevive } from '../../infra/queue/add-or-revive';
import { WebhookFanoutService } from '../webhook-fanout';
import { verifyPayloadProviders, WhatsAppProviderResolver } from '../whatsapp-provider-registry';
import { WabaConnectionsRepository } from './waba-connections.repository';
import {
  authenticateWebhook,
  HANDLED_FIELDS,
  inboundUrlKey,
  splitWebhook,
  verifyTokenFor,
  type WebhookChange,
} from './waba-rules';

/**
 * The queued job. `sealed` is `{ changes }` sealed with the credentials key (message text and phone numbers never sit in Redis in
 * the clear). `changes` is the pre-sealing shape, still accepted by the worker so a job queued before a deploy is not stranded.
 */
export interface WabaIngestJob {
  sealed?: string;
  changes?: WebhookChange[];
}

/**
 * How long the answers a delivery needs before it is queued (who owns the numbers, which secret signs them) are reused. A delivery
 * then takes no database connection once warm. A changed app secret or a moved number is honoured within this time.
 */
const ROUTE_CACHE_MS = 30_000;
const ROUTE_CACHE_MAX = 2_000;
/**
 * An authenticated delivery is remembered by (body, signature, url key) for this long; the same request again is answered at once.
 * Only a request that was authenticated and queued leaves a mark, so a forgery can never hit it.
 */
const REPLAY_WINDOW_S = 120;
const REPLAY_PREFIX = 'waba:wh:seen:';

/**
 * The public side of the WhatsApp webhook (TW-WABA-029..031): the GET handshake and the POST receiver. It authenticates,
 * splits the envelope, queues, and answers; everything slow happens in the worker.
 *
 * Authentication (TW-WABA-030): Meta signs the raw body with the app secret. Interakt documents no signature, so a request is
 * also accepted when it carries the platform secret from the callback URL we registered (`?k=`). A request with neither is a
 * forgery and is refused before anything is parsed into a job.
 */
@Injectable()
export class WabaWebhookService {
  private readonly logger = new Logger(WabaWebhookService.name);
  private readonly providersCache = new TtlCache<{
    custom: Awaited<ReturnType<WhatsAppProviderResolver['payloadProviders']>>['custom'];
    hasBuiltin: boolean;
  }>(ROUTE_CACHE_MS, ROUTE_CACHE_MAX);
  private readonly secretsCache = new TtlCache<string[] | null>(ROUTE_CACHE_MS, ROUTE_CACHE_MAX);

  constructor(
    private readonly db: WebhookDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly repo: WabaConnectionsRepository,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @InjectQueue(QUEUES.WABA_INGEST) private readonly queue: Queue<WabaIngestJob>,
    private readonly fanout: WebhookFanoutService,
    private readonly providers: WhatsAppProviderResolver,
  ) {}

  /** The GET handshake: echo the challenge when the verify token is ours (constant-time compare). */
  handshake(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expected = verifyTokenFor(
      this.env.WABA_VERIFY_TOKEN ?? this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true }),
      this.credentialsKey(),
    );
    // A provider of the registry may hold a verify token of its own (its subscription is answered with that one).
    const accepted = [expected, ...this.providers.verifyTokens()];
    if (
      mode !== 'subscribe' ||
      !token ||
      !challenge ||
      !accepted.some((t) => safeEqual(token, t))
    ) {
      throw new AppError('FORBIDDEN', 'Verification failed', 403);
    }
    return challenge;
  }

  async receive(input: {
    rawBody: Buffer | undefined;
    /**
     * What the JSON body parser already made of `rawBody` (`req.body`). When it is an object it is used as the payload instead of
     * parsing the same bytes a second time: at the 4 MiB cap that second parse (and the 4 MiB string it needs) was about a quarter of
     * the loop time one delivery cost (EL-B09). The signature is still checked against `rawBody`, the bytes as sent.
     */
    parsedBody?: unknown;
    signatureHeader: string | undefined;
    contentType?: string | undefined;
    queryKey: string | undefined;
    /** The client address after `TRUST_PROXY`, matched against `WABA_TRUSTED_FORWARDER_IPS`. */
    sourceIp?: string | undefined;
    /** Any request header by lower-case name (a provider of the registry may sign with a header of its own). */
    header?: (name: string) => string | undefined;
  }): Promise<{ queued: number }> {
    if (!input.rawBody || input.rawBody.length === 0) throw AppError.validation('Empty body');
    const replayKey = this.replayKey(input.rawBody, input.signatureHeader, input.queryKey);
    // An exact repeat of a delivery that was authenticated and queued. Unless its job has failed since (then the normal path below
    // replaces it, ASYNC-018), there is nothing left to do.
    if (await this.seenRecently(replayKey)) {
      if (
        (await this.jobState(createHash('sha256').update(input.rawBody).digest('hex'))) !== 'failed'
      ) {
        return { queued: 0 };
      }
    }
    let payload: unknown;
    if (typeof input.parsedBody === 'object' && input.parsedBody !== null) {
      payload = input.parsedBody;
    } else {
      try {
        payload = JSON.parse(input.rawBody.toString('utf8'));
      } catch {
        throw AppError.validation('Body is not JSON');
      }
    }
    const changes = splitWebhook(payload);

    // The platform app signs deliveries for every number it serves. A customer's own Meta app signs only its own numbers, and one
    // signature covers the whole body, so it is accepted only when EVERY number and WABA the body names belongs to that app's workspace.
    const platformSecrets = [
      this.env.META_APP_SECRET,
      this.config.get('WHATSAPP_APP_SECRET', { infer: true }),
    ].filter((s): s is string => typeof s === 'string' && s !== '');
    const verifies = (s: string) =>
      this.provider.verifyWebhookSignature(input.rawBody!, input.signatureHeader!, s);
    let signatureValid = Boolean(input.signatureHeader) && platformSecrets.some(verifies);
    if (!signatureValid && input.signatureHeader) {
      // A database failure is not cached: it propagates out of the cache, is logged, and this delivery is refused (Meta redelivers).
      let own: string[] | null = null;
      try {
        own = await this.secretsCache.get(this.routeKey(changes), () =>
          this.ownAppSecrets(changes),
        );
      } catch (err) {
        this.logger.debug({ err: (err as Error).message }, 'could not read a number app secret');
      }
      signatureValid = own !== null && own.some(verifies);
    }
    const auth = authenticateWebhook({
      signatureHeader: input.signatureHeader,
      signatureValid,
      queryKey: input.queryKey,
      expectedKey: inboundUrlKey(this.credentialsKey()),
      requireSignature: this.env.WABA_REQUIRE_INTERAKT_SIGNATURE,
      trustedSource: this.isTrustedForwarder(input.sourceIp),
    });
    // Numbers on a provider of the registry are authenticated by that provider's own scheme (signature, shared secret header, or the
    // URL secret for a provider that signs nothing). A number on a built-in route keeps the rule above, unchanged.
    const phoneIds = changes.map((c) => c.phoneNumberId).filter((p): p is string => Boolean(p));
    const { custom, hasBuiltin } = await this.providersCache.get(
      JSON.stringify([...new Set(phoneIds)].sort()),
      () => this.providers.payloadProviders(phoneIds, (fn) => this.db.privileged(fn)),
      // A provider the registry does not know yet comes back as a placeholder with no base URL; it is not kept, so a provider created
      // a moment ago is found again at the resolver's own 2 s reload, not after this cache's 30 s.
      (r) => r.custom.every((p) => p.baseUrl !== ''),
    );
    let ok = auth.ok;
    let reason = auth.ok ? '' : auth.reason;
    if (custom.length > 0) {
      const verdict = verifyPayloadProviders(custom, {
        header: input.header ?? (() => undefined),
        urlKeyValid:
          typeof input.queryKey === 'string' &&
          safeEqual(input.queryKey, inboundUrlKey(this.credentialsKey())),
        signatureMatches: (header, secret) =>
          this.provider.verifyWebhookSignature(input.rawBody!, header, secret),
      });
      ok = verdict !== null && verdict.ok && (!hasBuiltin || auth.ok);
      if (!ok) reason = verdict && !verdict.ok ? verdict.reason : reason;
    }
    if (!ok) {
      this.logger.warn({ reason }, 'whatsapp webhook refused');
      throw AppError.unauthenticated('Invalid webhook signature');
    }

    // Forward the raw body to every platform-configured target, unchanged and before our own processing. Authenticated
    // traffic only, so this cannot be used to spam the targets. Never throws.
    await this.fanout.forward({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      contentType: input.contentType,
      fields: [...new Set(changes.map((c) => c.field))],
    });

    const actionable = changes.filter((c) => HANDLED_FIELDS.has(c.field));
    if (actionable.length === 0) {
      void this.markSeen(replayKey);
      return { queued: 0 };
    }
    // Meta retries a payload it thinks we missed; the same body is the same job, so a retry is absorbed here.
    const jobId = createHash('sha256').update(input.rawBody).digest('hex');
    // A job of this id that already failed would swallow Meta's redelivery and we would still answer 200, so it is replaced (ASYNC-018).
    await addOrRevive(
      this.queue,
      'payload',
      { sealed: sealJson(this.crypto, { changes: actionable }) },
      { jobId },
    );
    void this.markSeen(replayKey);
    return { queued: actionable.length };
  }

  private replayKey(
    raw: Buffer,
    signature: string | undefined,
    queryKey: string | undefined,
  ): string {
    return (
      REPLAY_PREFIX +
      createHash('sha256')
        .update(raw)
        .update('\0')
        .update(signature ?? '')
        .update('\0')
        .update(queryKey ?? '')
        .digest('hex')
    );
  }

  /** Fails open: if Redis cannot answer, the delivery is processed as before (the queue's job id still absorbs a repeat). */
  private async seenRecently(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  private async jobState(jobId: string): Promise<string> {
    try {
      return await this.queue.getJobState(jobId);
    } catch {
      return 'unknown';
    }
  }

  private async markSeen(key: string): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', REPLAY_WINDOW_S);
    } catch (err) {
      this.logger.debug({ err: (err as Error).message }, 'could not mark a webhook as seen');
    }
  }

  private routeKey(changes: WebhookChange[]): string {
    const phones = [...new Set(changes.map((c) => c.phoneNumberId ?? ''))].sort();
    const wabas = [...new Set(changes.map((c) => c.wabaId))].sort();
    // JSON, not a delimiter join: the ids come from an unauthenticated body, and "a,b" (one id) must never share a key with ["a", "b"].
    return JSON.stringify([phones, wabas]);
  }

  /**
   * The app secrets of the single workspace that owns every number and WABA id named in the payload, or null when the payload
   * names anything else (an unknown id, or ids of two workspaces): such a body cannot be authenticated by one tenant's secret.
   */
  private async ownAppSecrets(changes: WebhookChange[]): Promise<string[] | null> {
    const phones = [
      ...new Set(changes.map((c) => c.phoneNumberId).filter((p): p is string => Boolean(p))),
    ];
    const wabas = [...new Set(changes.map((c) => c.wabaId).filter(Boolean))];
    if (changes.length === 0 || phones.length + wabas.length > 50) return null;
    let orgId: number | null = null;
    const out: string[] = [];
    const same = (org: number): boolean => {
      if (orgId === null) orgId = org;
      return orgId === org;
    };
    // A change that names a phone number is routed by it, a change without one by its WABA id (waba_route_lookup).
    const routes = new Map(changes.map((c) => [c.phoneNumberId ?? `waba:${c.wabaId}`, c]));
    for (const c of routes.values()) {
      const found = await this.db.primary.execute(
        sql`SELECT * FROM waba_route_lookup(${c.phoneNumberId}, ${c.phoneNumberId ? null : c.wabaId})`,
      );
      const r = found.rows[0] as
        { route_org_id: number | string; route_config_id: number | string } | undefined;
      if (!r || !same(Number(r.route_org_id))) return null;
    }
    // A WABA id that resolves must resolve to the same workspace as the numbers.
    for (const waba of wabas) {
      const found = await this.db.primary.execute(
        sql`SELECT * FROM waba_route_lookup(NULL, ${waba})`,
      );
      const r = found.rows[0] as { route_org_id: number | string } | undefined;
      if (r && !same(Number(r.route_org_id))) return null;
    }
    if (orgId === null) return null;
    const org: number = orgId;
    for (const phone of phones) {
      const found = await this.db.primary.execute(
        sql`SELECT * FROM waba_route_lookup(${phone}, NULL)`,
      );
      const r = found.rows[0] as { route_config_id: number | string } | undefined;
      if (!r) continue;
      const row = await this.db.txAs({ orgId: org }, (tx) =>
        this.repo.findById(tx, org, Number(r.route_config_id)),
      );
      if (!row?.credentials_json) continue;
      try {
        const secret = (
          JSON.parse(this.crypto.decrypt(row.credentials_json)) as { app_secret?: string }
        ).app_secret;
        if (secret) out.push(secret);
      } catch {
        return null; // an unreadable envelope: the body cannot be vouched for (as before, all or nothing)
      }
    }
    return out;
  }

  /** True when the request came from an address listed in `WABA_TRUSTED_FORWARDER_IPS` (an IPv4-mapped IPv6 form is unwrapped). */
  private isTrustedForwarder(ip: string | undefined): boolean {
    if (!ip) return false;
    const plain = ip.replace(/^::ffff:/i, '');
    return this.env.WABA_TRUSTED_FORWARDER_IPS.includes(plain);
  }

  private credentialsKey(): string {
    return this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
