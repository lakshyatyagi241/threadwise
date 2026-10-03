import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  MARKET_HOOK_KEY_RE,
  MARKET_HOOK_MAX_BYTES,
  type MarketHookResult,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ConnectorRegistry, isInbound } from '../../infra/providers/marketplace';
import { DeliveryService } from './delivery.service';
import { HookThrottle } from './hook-throttle';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';

/**
 * A delivery to a connection's public address (`POST /v2/public/marketplace/hooks/:publicKey`): a push portal or a webhook relay posting a
 * lead. There is no session; the address names the connection and the sender proves itself with the connection's secret.
 *
 * Order, and why: throttle first (cheap, protects everything below); the address resolves to a tenant through a SECURITY DEFINER lookup that
 * returns two ids and nothing else; the connection must be live (installation active, connection active, app not killed); then
 * authentication over the RAW bytes (a signature is never checked against a re-serialised body); then size and JSON; then the recipe's
 * mapping; then the leads go to the pipeline and the sender is answered only after that. A sender that retries on an error therefore
 * never loses a lead, and one that repeats a lead is told `duplicate`.
 *
 * Answers: 404 unknown address, 410 killed, 409 paused, 401 wrong secret, 413 too large, 400 not JSON, 422 nothing mappable, 429 throttled,
 * 503 when the pipeline cannot take it, 200 with counts otherwise.
 */
@Injectable()
export class RelayService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly crypto: CryptoService,
    private readonly registry: ConnectorRegistry,
    private readonly throttle: HookThrottle,
    private readonly delivery: DeliveryService,
  ) {}

  async receive(
    publicKey: string,
    ip: string | undefined,
    headers: Record<string, string | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<MarketHookResult> {
    await this.throttle.checkIp(ip);
    if (!MARKET_HOOK_KEY_RE.test(publicKey)) throw this.notFound();

    const found = await this.db.primary.execute(
      sql`SELECT * FROM marketplace_connection_lookup(${publicKey})`,
    );
    const hit = (
      found.rows as Array<{ conn_org_id: string | number; conn_id: string | number }>
    )[0];
    if (!hit) throw this.notFound();
    const orgId = Number(hit.conn_org_id);
    const connectionId = Number(hit.conn_id);

    const row = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const r = await tx.execute(
        sql`SELECT installation_id FROM marketplace_connections WHERE org_id = ${orgId} AND id = ${connectionId}`,
      );
      const installationId = Number(
        (r.rows as Array<{ installation_id: string | number }>)[0]?.installation_id,
      );
      return Number.isFinite(installationId) ? this.repo.byId(tx, orgId, installationId) : null;
    });
    const conn = row?.connection;
    if (!row || !conn) throw this.notFound();

    if (row.status === 'killed' || row.app.status === 'killed') {
      throw new AppError(
        ERROR_CODES.MKT_INSTALLATION_KILLED,
        'This connection has been switched off by the platform.',
        HttpStatus.GONE,
      );
    }
    if (row.status !== 'active' || conn.status === 'paused' || conn.status === 'disabled') {
      throw new AppError(
        ERROR_CODES.MKT_INSTALLATION_DISABLED,
        'This connection is paused.',
        HttpStatus.CONFLICT,
      );
    }

    const recipe = readRecipe(row.recipe);
    const type = recipe ? this.registry.get(recipe.connector.type) : null;
    if (!recipe || !type || !isInbound(type)) throw this.notFound();

    await this.throttle.checkConnection(publicKey, recipe.rateLimits.perMinute);

    const credentials = this.openCredentials(row.credentialsEnc);
    const connectionSecret = conn.secretEnc ? this.crypto.decrypt(conn.secretEnc) : null;
    const secret = type.secretFor(recipe, credentials, connectionSecret);
    const body = rawBody ?? Buffer.alloc(0);
    if (!secret || !type.authenticate(recipe, { rawBody: body, headers }, secret)) {
      await this.throttle.authFailed(publicKey);
      throw new AppError(
        ERROR_CODES.MKT_WEBHOOK_UNAUTHORIZED,
        'The delivery is not authorised.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (body.length > MARKET_HOOK_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'The delivery is too large.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(body.toString('utf8'));
    } catch {
      throw this.badPayload('The body is not valid JSON.');
    }

    const parsed = type.parse(recipe, json);
    if (parsed.leads.length === 0) {
      // Nothing usable: counted as a failed delivery so the connection page shows it, and the sender is told why.
      await this.delivery.process(
        {
          orgId,
          connectionId,
          installationId: row.id,
          installationUuid: row.uuid,
          appSlug: row.app.slug,
          appName: row.app.name,
          leadSourceId: conn.leadSourceId,
        },
        [],
        Math.max(parsed.rejected.length, 1),
      );
      throw this.badPayload(
        parsed.rejected[0]
          ? `No lead could be read from the delivery (${parsed.rejected[0].reason}).`
          : 'The delivery holds no lead.',
        parsed.rejected.slice(0, 5).map((r) => ({ path: `items.${r.index}`, message: r.reason })),
      );
    }

    const counts = await this.delivery.process(
      {
        orgId,
        connectionId,
        installationId: row.id,
        installationUuid: row.uuid,
        appSlug: row.app.slug,
        appName: row.app.name,
        leadSourceId: conn.leadSourceId,
      },
      parsed.leads,
      parsed.rejected.length,
    );
    if (counts.failed > 0) {
      throw new AppError(
        counts.pipelineDown ? ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE : ERROR_CODES.INTERNAL,
        'The lead could not be stored. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: counts.accepted === 0 && counts.duplicates > 0 ? 'duplicate' : 'accepted',
      received: counts.received,
      accepted: counts.accepted,
      duplicates: counts.duplicates,
      rejected: counts.rejected,
    };
  }

  /** The opened credential fields of an installation (empty when none are stored). */
  openCredentials(enc: string | null): Record<string, string> {
    if (!enc) return {};
    try {
      return JSON.parse(this.crypto.decrypt(enc)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, 'Not found', HttpStatus.NOT_FOUND);
  }

  private badPayload(
    message: string,
    details?: Array<{ path: string; message: string }>,
  ): AppError {
    return new AppError(
      ERROR_CODES.MKT_WEBHOOK_BAD_PAYLOAD,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }
}
