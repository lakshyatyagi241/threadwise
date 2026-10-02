import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { igInboundSchema, type IgInboundResult } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { EngineConnectionService } from '../addons-extension-registry';
import { IngestService } from './ingest.service';

/** What the public route answers: a status and a JSON body in the shape the engine already reads. */
export type PushAnswer =
  | { status: 200; body: IgInboundResult }
  | { status: 401 | 422 | 500; body: { ok: false; error: string } };

/** Equal secrets compare equal in the same time whatever the first differing character is. */
const sameSecret = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/**
 * The engine pushing a new message to us (WD-IG-007). The shared secret is the only authentication, so it is checked before
 * anything else is read from the body, and an empty stored secret (the engine is not connected) refuses everyone.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly engines: EngineConnectionService,
    private readonly ingest: IngestService,
  ) {}

  async receive(secret: string, raw: unknown): Promise<PushAnswer> {
    const conn = await this.engines.connection('instagram');
    if (conn.secret === '' || !sameSecret(conn.secret, secret)) {
      return { status: 401, body: { ok: false, error: 'unauthorized' } };
    }

    const parsed = igInboundSchema.safeParse(raw);
    if (!parsed.success) return { status: 422, body: { ok: false, error: 'invalid payload' } };
    const data = parsed.data;

    // A signed push proves the link is live.
    if (!conn.connected) await this.engines.markConnected('instagram');

    const orgId = data.workspace_id;
    const known = await this.db.privileged((tx) =>
      tx.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}`),
    );
    if (known.rows.length === 0) {
      return { status: 422, body: { ok: false, error: 'unknown workspace' } };
    }

    // Only a message is stored; a status or thread event is acknowledged.
    if (data.event !== 'message') return { status: 200, body: { ok: true, received: data.event } };

    try {
      const out = await this.ingest.ingest(orgId, data);
      return {
        status: 200,
        body: {
          ok: true,
          message_id: out.messageId ?? undefined,
          conversation_id: out.conversationId,
        },
      };
    } catch (err) {
      this.logger.error({ err, orgId }, 'instagram inbound store failed');
      return { status: 500, body: { ok: false, error: 'store_failed' } };
    }
  }
}
