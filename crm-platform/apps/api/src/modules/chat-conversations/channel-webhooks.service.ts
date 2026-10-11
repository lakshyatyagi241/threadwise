import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RateLimitService } from '../auth';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelVault } from './channel-vault';
import { ChannelsRepository } from './channels.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Meta documents webhook payloads of up to 3 MB; anything past this is not one. */
const MAX_BODY_BYTES = 3_000_000;
const PER_MINUTE = 600;
/** Every address together: a channel's whole inbound traffic. High enough for a busy number, low enough to stop a flood. */
const PER_MINUTE_CHANNEL = 6000;
/** What a provider's challenge looks like (Meta sends digits). Anything else is not echoed back into a response body. */
const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;

const unauthorized = (): AppError =>
  new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', HttpStatus.UNAUTHORIZED);

/**
 * Inbound provider webhooks, one URL per channel (`/v2/webhooks/channels/:channelUuid`).
 *
 * The signature is the only authentication, so it is checked over the RAW body before anything in the payload is read, with the
 * adapter's verifier and this channel's own secret. Nothing is processed here: a verified delivery is normalised and put on the
 * ingest queue, and the answer goes back at once (a slow answer makes the provider redeliver, which makes duplicates).
 *
 * Failure answers carry no detail: an unknown channel, a channel of a kind with no public webhook (the simulator, the web chat widget), a missing body, a
 * wrong signature all look the same from outside, apart from 404 for a uuid that is not a channel at all.
 */
@Injectable()
export class ChannelWebhooksService {
  private readonly logger = new Logger(ChannelWebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly vault: ChannelVault,
    private readonly publisher: ChannelIngestPublisher,
    private readonly rate: RateLimitService,
  ) {}

  /** Meta's subscription challenge: echo `hub.challenge` when `hub.verify_token` is this channel's token. */
  async verifyChallenge(
    channelUuid: string,
    query: Record<string, unknown>,
    ip: string | undefined,
  ): Promise<string> {
    await this.limit(channelUuid, ip);
    const found = await this.locate(channelUuid);
    const token = typeof query['hub.verify_token'] === 'string' ? query['hub.verify_token'] : '';
    const challenge = typeof query['hub.challenge'] === 'string' ? query['hub.challenge'] : '';
    if (query['hub.mode'] !== 'subscribe' || !token || !CHALLENGE.test(challenge))
      throw unauthorized();

    const stored = await this.db.txAs({ orgId: found.orgId }, async (tx) => {
      const row = await this.repo.byId(tx, found.orgId, found.id);
      if (!row || !this.adapters.find(row.kind)?.publicWebhook) return null;
      return this.repo.webhookTokenHashOf(tx, found.orgId, found.id);
    });
    if (!this.vault.tokenMatches(token, stored)) throw unauthorized();
    return challenge;
  }

  async receive(
    channelUuid: string,
    rawBody: Buffer | undefined,
    headers: IncomingHttpHeaders,
    ip: string | undefined,
  ): Promise<{ received: true }> {
    await this.limit(channelUuid, ip);
    if (!rawBody || rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) throw unauthorized();
    const found = await this.locate(channelUuid);

    const runtime = await this.db.txAs({ orgId: found.orgId }, async (tx) => {
      const row = await this.repo.byId(tx, found.orgId, found.id);
      if (!row || !this.adapters.find(row.kind)?.publicWebhook) return null;
      return this.channels.runtime(tx, found.orgId, row);
    });
    const adapter = runtime ? this.adapters.find(runtime.kind) : undefined;
    // Fail closed: nothing to verify against means nothing is accepted.
    if (!runtime || !adapter) throw unauthorized();
    if (!(await adapter.verifyInbound(runtime, rawBody, flatten(headers)))) throw unauthorized();

    // From here the sender is authenticated; its payload is still data.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The body is not valid JSON',
        HttpStatus.BAD_REQUEST,
      );
    }
    const parsed = adapter.parseInbound(runtime, payload);
    // Enqueue everything or fail the whole delivery (the provider redelivers; the job ids and the ledger make that harmless).
    await Promise.all([
      ...parsed.messages.map((m) => this.publisher.enqueueInbound(found.orgId, runtime.uuid, m)),
      ...parsed.receipts.map((r) => this.publisher.enqueueReceipt(found.orgId, runtime.uuid, r)),
    ]);
    if (parsed.ignored?.length) {
      this.logger.debug(
        { channel: runtime.uuid, ignored: parsed.ignored.slice(0, 20) },
        'webhook parts not stored',
      );
    }
    return { received: true };
  }

  private async locate(channelUuid: string): Promise<{ id: number; orgId: number }> {
    if (!UUID.test(channelUuid)) throw AppError.notFound('Channel');
    const found = await this.repo.locate(this.db.primary, channelUuid);
    if (!found) throw AppError.notFound('Channel');
    return found;
  }

  private async limit(channelUuid: string, ip: string | undefined): Promise<void> {
    const key = channelUuid.slice(0, 36);
    const allowed =
      (await this.rate.allow(`chat:webhook:${key}:${ip ?? 'unknown'}`, PER_MINUTE, 60)) &&
      (await this.rate.allow(`chat:webhook:${key}`, PER_MINUTE_CHANNEL, 60));
    if (!allowed) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function flatten(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}
