import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../infra/providers/whatsapp/whatsapp.port';
import { WabaConnectionsRepository } from './waba-connections.repository';
import {
  authenticateWebhook,
  HANDLED_FIELDS,
  inboundUrlKey,
  splitWebhook,
  verifyTokenFor,
  type WebhookChange,
} from './waba-rules';

export interface WabaIngestJob {
  changes: WebhookChange[];
}

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

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaConnectionsRepository,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @InjectQueue(QUEUES.WABA_INGEST) private readonly queue: Queue<WabaIngestJob>,
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
    if (mode !== 'subscribe' || !token || !challenge || !safeEqual(token, expected)) {
      throw new AppError('FORBIDDEN', 'Verification failed', 403);
    }
    return challenge;
  }

  async receive(input: {
    rawBody: Buffer | undefined;
    signatureHeader: string | undefined;
    queryKey: string | undefined;
  }): Promise<{ queued: number }> {
    if (!input.rawBody || input.rawBody.length === 0) throw AppError.validation('Empty body');
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw AppError.validation('Body is not JSON');
    }
    const changes = splitWebhook(payload);

    const secrets = [
      this.env.META_APP_SECRET,
      this.config.get('WHATSAPP_APP_SECRET', { infer: true }),
      ...(await this.ownAppSecrets(changes)),
    ].filter((s): s is string => typeof s === 'string' && s !== '');
    const signatureValid =
      Boolean(input.signatureHeader) &&
      secrets.some((s) =>
        this.provider.verifyWebhookSignature(input.rawBody!, input.signatureHeader!, s),
      );
    const auth = authenticateWebhook({
      signatureHeader: input.signatureHeader,
      signatureValid,
      queryKey: input.queryKey,
      expectedKey: inboundUrlKey(this.credentialsKey()),
      requireSignature: this.env.WABA_REQUIRE_INTERAKT_SIGNATURE,
    });
    if (!auth.ok) {
      this.logger.warn({ reason: auth.reason }, 'whatsapp webhook refused');
      throw AppError.unauthenticated('Invalid webhook signature');
    }

    const actionable = changes.filter((c) => HANDLED_FIELDS.has(c.field));
    if (actionable.length === 0) return { queued: 0 };
    // Meta retries a payload it thinks we missed; the same body is the same job, so a retry is absorbed here.
    const jobId = createHash('sha256').update(input.rawBody).digest('hex');
    await this.queue.add('payload', { changes: actionable }, { jobId });
    return { queued: actionable.length };
  }

  /** Numbers connected on the customer's own Meta app sign with that app's secret, stored with their credentials. */
  private async ownAppSecrets(changes: WebhookChange[]): Promise<string[]> {
    const phones = [
      ...new Set(changes.map((c) => c.phoneNumberId).filter((p): p is string => Boolean(p))),
    ].slice(0, 5);
    const out: string[] = [];
    for (const phone of phones) {
      try {
        const found = await this.db.primary.execute(
          sql`SELECT * FROM waba_route_lookup(${phone}, NULL)`,
        );
        const r = found.rows[0] as
          { route_org_id: number | string; route_config_id: number | string } | undefined;
        if (!r) continue;
        const orgId = Number(r.route_org_id);
        const row = await this.db.txAs({ orgId }, (tx) =>
          this.repo.findById(tx, orgId, Number(r.route_config_id)),
        );
        if (!row?.credentials_json) continue;
        const secret = (
          JSON.parse(this.crypto.decrypt(row.credentials_json)) as { app_secret?: string }
        ).app_secret;
        if (secret) out.push(secret);
      } catch (err) {
        this.logger.debug({ err: (err as Error).message }, 'could not read a number app secret');
      }
    }
    return out;
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
