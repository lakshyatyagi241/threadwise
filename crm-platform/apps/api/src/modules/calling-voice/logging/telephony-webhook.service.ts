import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { AppError } from '../../../common/errors/app-error';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import { TelephonyProviderRegistry } from '../../../infra/providers/telephony';
import { QUEUES } from '../../../infra/queue/queues';

/** One finished call to apply, as it travels on the queue: ids and the normalised call, never the raw callback. */
export interface TelephonyJob {
  orgId: number;
  connectionUuid: string;
  event: {
    eventId: string;
    callId: string;
    direction: 'inbound' | 'outbound';
    status: string;
    customerNumber: string | null;
    ourNumber: string | null;
    startedAt: string;
    durationSec: number;
    recordingRef: string | null;
  };
}

export const TELEPHONY_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const unauthenticated = () => AppError.unauthenticated('Invalid signature');

/**
 * The telephony provider's status callback (`POST /v2/public/webhooks/telephony/:connection`), the three rules of a webhook:
 *
 *  1. VERIFY. The connection in the address names the workspace and the secret; the provider adapter proves the callback is signed with
 *     it over the raw bytes, in constant time, inside the replay window. An unknown connection and a bad signature answer the same 401, so
 *     the address cannot be used to find out which connections exist. A DISABLED connection is acknowledged and ignored (the provider
 *     must not keep retrying a callback nobody wants).
 *  2. ACK FAST. The adapter reads the payload; each finished call is put on the queue and the request ends. Nothing is written here.
 *  3. IDEMPOTENT. The job id carries the provider's event id, and the entry is unique on (source, the provider's call id), so a retry
 *     that arrives twice - or after the job already ran - changes nothing.
 */
@Injectable()
export class TelephonyWebhookService {
  private readonly logger = new Logger(TelephonyWebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: TelephonyProviderRegistry,
    private readonly crypto: CryptoService,
    @InjectQueue(QUEUES.TELEPHONY_INGEST) private readonly queue: Queue<TelephonyJob>,
  ) {}

  async receive(
    connectionUuid: string,
    rawBody: Buffer | undefined,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<void> {
    if (!rawBody || !/^[0-9a-f-]{36}$/i.test(connectionUuid)) throw unauthenticated();
    const found = await this.db.primary.execute(
      sql`SELECT * FROM telephony_connection_for_webhook(${connectionUuid}::uuid)`,
    );
    const conn = (found as { rows: Array<Record<string, unknown>> }).rows[0];
    if (!conn) throw unauthenticated();
    const provider = this.registry.get(String(conn.conn_provider));
    if (!provider) throw unauthenticated();

    let secret: string;
    try {
      secret = this.crypto.decrypt(String(conn.conn_secret_cipher));
    } catch {
      // A secret sealed with a key this deployment no longer holds: nothing can prove the callback.
      throw unauthenticated();
    }
    if (!provider.verifyWebhook(rawBody, headers, secret)) throw unauthenticated();
    if (conn.conn_status !== 'active') return;

    const orgId = Number(conn.conn_org_id);
    for (const e of provider.parseWebhook(rawBody)) {
      await this.queue.add(
        'call',
        {
          orgId,
          connectionUuid,
          event: {
            eventId: e.eventId,
            callId: e.callId,
            direction: e.direction,
            status: e.status,
            customerNumber: e.customerNumber,
            ourNumber: e.ourNumber,
            startedAt: e.startedAt.toISOString(),
            durationSec: e.durationSec,
            recordingRef: e.recordingRef,
          },
        },
        // BullMQ job ids cannot hold a colon; the event id is the provider's own (a retry carries the same one).
        {
          ...TELEPHONY_JOB_OPTIONS,
          jobId: `tel-${connectionUuid}-${e.eventId.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        },
      );
    }
    this.logger.debug({ orgId }, '[CALL] telephony callback accepted');
  }
}
