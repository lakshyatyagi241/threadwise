import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChannelRuntime } from '../../infra/providers/chat-conversations';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  WHATSAPP_PROVIDER_RESOLVER,
  verifyDelivery,
  type WhatsAppProviderResolver,
} from '../../infra/providers/whatsapp';
import { RateLimitService } from '../auth';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelVault } from './channel-vault';
import { ChannelsRepository } from './channels.repository';

const KIND = 'whatsapp_cloud';
const MAX_BODY_BYTES = 3_000_000;
const PER_MINUTE = 3_000;
const PER_MINUTE_PROVIDER = 30_000;
const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const COUNTER_TTL_SECONDS = 8 * 24 * 3600;

const unauthorized = (): AppError =>
  new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', HttpStatus.UNAUTHORIZED);

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ProviderWebhookResult {
  received: true;
  /** Changes handed to a channel. */
  routed: number;
  /** Changes for a number nobody here has connected (or one connected under another provider): answered 200, counted, not stored. */
  unroutable: number;
}

/**
 * The provider-level WhatsApp webhook: ONE URL per provider (`/v2/webhooks/whatsapp/:providerKey`) that receives the deliveries of every
 * number of the platform's Meta app or BSP account, instead of one URL per channel. Each change inside a delivery is routed to the channel that
 * owns the number it names (`metadata.phone_number_id`), then goes through exactly the path a per-channel delivery takes.
 *
 * Authentication is the PROVIDER's: the delivery is verified with the secret and scheme the resolver gives for this provider key
 * (the platform's Meta app secret, or a shared header secret), before anything in the payload is read. A provider with no secret
 * configured refuses everything (fail closed).
 *
 * A number that no channel owns is not an error: Meta delivers every number of the app, including ones not (yet) connected here. It is
 * answered 200 (a refusal makes Meta redeliver and eventually switch the subscription off), skipped, and counted per provider per day.
 * A channel connected under a different provider than the one that delivered is skipped the same way.
 */
@Injectable()
export class ProviderWebhooksService {
  private readonly logger = new Logger(ProviderWebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly vault: ChannelVault,
    private readonly publisher: ChannelIngestPublisher,
    private readonly rate: RateLimitService,
    @Inject(WHATSAPP_PROVIDER_RESOLVER) private readonly resolver: WhatsAppProviderResolver,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async verifyChallenge(providerKey: string, query: Record<string, unknown>, ip: string | undefined): Promise<string> {
    await this.limit(providerKey, ip);
    const profile = await this.profile(providerKey);
    const token = typeof query['hub.verify_token'] === 'string' ? query['hub.verify_token'] : '';
    const challenge = typeof query['hub.challenge'] === 'string' ? query['hub.challenge'] : '';
    if (query['hub.mode'] !== 'subscribe' || !token || !CHALLENGE.test(challenge)) throw unauthorized();
    const expected = profile.webhook.verifyToken;
    if (!expected || !this.vault.tokenMatches(token, this.vault.hashToken(expected))) throw unauthorized();
    return challenge;
  }

  async receive(
    providerKey: string,
    rawBody: Buffer | undefined,
    headers: IncomingHttpHeaders,
    ip: string | undefined,
  ): Promise<ProviderWebhookResult> {
    await this.limit(providerKey, ip);
    if (!rawBody || rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) throw unauthorized();
    const profile = await this.profile(providerKey);

    const flat = flatten(headers);
    if (!verifyDelivery(profile.webhook.signatureScheme, profile.webhook.secret, profile.webhook.headerName, rawBody, flat)) {
      throw unauthorized();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The body is not valid JSON', HttpStatus.BAD_REQUEST);
    }

    // Group the changes by the number they name, so each channel is looked up once and gets one payload.
    const byNumber = new Map<string, Array<{ entryId: unknown; change: unknown }>>();
    let unroutable = 0;
    for (const entry of isDict(payload) && Array.isArray(payload.entry) ? payload.entry : []) {
      for (const change of isDict(entry) && Array.isArray(entry.changes) ? entry.changes : []) {
        const value = isDict(change) && isDict(change.value) ? change.value : {};
        const phoneId = isDict(value.metadata) && typeof value.metadata.phone_number_id === 'string' ? value.metadata.phone_number_id : null;
        if (!phoneId || !/^\d{5,32}$/.test(phoneId)) {
          unroutable += 1;
          continue;
        }
        const list = byNumber.get(phoneId) ?? [];
        list.push({ entryId: isDict(entry) ? entry.id : undefined, change });
        byNumber.set(phoneId, list);
      }
    }

    let routed = 0;
    for (const [phoneId, parts] of byNumber) {
      const target = await this.target(providerKey, phoneId);
      if (!target) {
        unroutable += parts.length;
        continue;
      }
      const adapter = this.adapters.for(KIND);
      const sub = {
        object: isDict(payload) ? payload.object : undefined,
        entry: parts.map((p) => ({ id: p.entryId, changes: [p.change] })),
      };
      const parsed = adapter.parseInbound(target.runtime, sub);
      await Promise.all([
        ...parsed.messages.map((m) => this.publisher.enqueueInbound(target.orgId, target.runtime.uuid, m)),
        ...parsed.receipts.map((r) => this.publisher.enqueueReceipt(target.orgId, target.runtime.uuid, r)),
      ]);
      routed += parts.length;
    }

    if (unroutable > 0) await this.count(providerKey, unroutable);
    return { received: true, routed, unroutable };
  }

  // --- pieces ------------------------------------------------------------------------------------------------------------------

  private async profile(providerKey: string) {
    if (!PROVIDER_KEY.test(providerKey)) throw AppError.notFound('Provider');
    const profile = await this.resolver.resolveByKey(providerKey);
    if (!profile) throw AppError.notFound('Provider');
    return profile;
  }

  /** The channel that owns this number and belongs to this provider, with its opened credentials; null for anything else. */
  private async target(providerKey: string, phoneId: string): Promise<{ orgId: number; runtime: ChannelRuntime } | null> {
    const found = await this.repo.locateByExternal(this.db.primary, KIND, phoneId);
    if (!found) return null;
    const runtime = await this.db.txAs({ orgId: found.orgId }, async (tx) => {
      const row = await this.repo.byId(tx, found.orgId, found.id);
      return row ? this.channels.runtime(tx, found.orgId, row) : null;
    });
    if (!runtime) return null;
    try {
      const assigned = await this.resolver.resolveForChannel(runtime);
      if (assigned.providerKey !== providerKey) return null;
    } catch {
      return null;
    }
    return { orgId: found.orgId, runtime };
  }

  /** Per provider per day, for the operator's dashboard: how many changes named a number nobody here owns. */
  private async count(providerKey: string, n: number): Promise<void> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const key = `chat:webhook:unroutable:${providerKey}:${day}`;
    try {
      await this.redis.incrby(key, n);
      await this.redis.expire(key, COUNTER_TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'could not count unroutable webhook changes');
    }
  }

  private async limit(providerKey: string, ip: string | undefined): Promise<void> {
    const key = providerKey.slice(0, 41);
    const allowed =
      (await this.rate.allow(`chat:webhook:provider:${key}:${ip ?? 'unknown'}`, PER_MINUTE, 60)) &&
      (await this.rate.allow(`chat:webhook:provider:${key}`, PER_MINUTE_PROVIDER, 60));
    if (!allowed) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, 'Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function flatten(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}
