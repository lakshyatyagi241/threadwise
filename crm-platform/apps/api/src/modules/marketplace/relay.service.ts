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
import {
  ConnectorRegistry,
  describeReadFailure,
  guessFormat,
  isInbound,
  readDelivery,
  type InboundFormat,
  type InboundMethod,
  type RawDelivery,
} from '../../infra/providers/marketplace';
import { DeliveryService } from './delivery.service';
import { HookThrottle } from './hook-throttle';
import { InboundIntake, keptHeaders } from './inbound-intake.service';
import { InstallationsRepository } from './installations.repository';
import { readRecipe } from './marketplace.mapper';

/** One request to a connection's public address, as the controller read it. */
export interface HookCall {
  publicKey: string;
  /** The secret as the second segment of the address, when the request has one. */
  pathToken: string | undefined;
  method: string;
  ip: string | undefined;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  rawBody: Buffer | undefined;
  /** The URL's query string without the `?`. */
  query: string;
}

/**
 * A delivery to a connection's public address (`/v2/public/marketplace/hooks/:publicKey[/:token]`): a push portal or a webhook relay
 * posting (or, for a portal that cannot POST, GETting) a lead. There is no session; the address names the connection and the sender
 * proves itself with the connection's secret, in a header, as a signature of the body, or as the last segment of the address.
 *
 * Order, and why: throttle first (cheap, protects everything below); the address resolves to a tenant through a SECURITY DEFINER lookup
 * that returns two ids and nothing else; the connection must be live (installation active, connection active, app not killed); then
 * authentication over the RAW bytes (a signature is never checked against a re-serialised body); then the size, the method and the
 * format (JSON, form, XML or the query string, as the recipe allows). From there two modes, the recipe's choice:
 *  - `sync` (the generic webhook): the body is read and mapped, the leads go to the pipeline and the sender is answered only after that,
 *    so a sender that retries on a non-2xx never loses a lead and a repeat is told `duplicate`;
 *  - `async` (a portal that turns itself off after a day or two of errors): the delivery is stored whole, the sender is answered 200 at
 *    once, and the worker maps it, hands the leads to the pipeline and retries from the stored copy. A 200 means "we have it".
 *
 * Answers: 404 unknown address, 410 killed, 409 paused, 401 wrong secret, 405 a method the recipe does not take, 413 too large, 415 a
 * format the recipe does not read, 400 not JSON, 422 nothing mappable, 429 throttled, 503 when the pipeline cannot take it (sync) or the
 * delivery could not be stored (async), 200 with counts otherwise.
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
    private readonly intake: InboundIntake,
  ) {}

  async receive(call: HookCall): Promise<MarketHookResult> {
    const { publicKey } = call;
    await this.throttle.checkIp(call.ip);
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
    const spec = recipe && type && isInbound(type) ? type.describeAuth(recipe) : null;
    if (!recipe || !type || !isInbound(type) || !spec) throw this.notFound();

    await this.throttle.checkConnection(publicKey, recipe.rateLimits.perMinute);

    const credentials = this.openCredentials(row.credentialsEnc);
    const connectionSecret = conn.secretEnc ? this.crypto.decrypt(conn.secretEnc) : null;
    const secret = type.secretFor(recipe, credentials, connectionSecret);
    const body = call.rawBody ?? Buffer.alloc(0);
    if (
      !secret ||
      !type.authenticate(
        recipe,
        { rawBody: body, headers: call.headers, pathToken: call.pathToken },
        secret,
      )
    ) {
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
    const method = call.method.toUpperCase();
    if (!spec.methods.includes(method as InboundMethod)) {
      throw new AppError(
        ERROR_CODES.MKT_WEBHOOK_BAD_PAYLOAD,
        `This address takes ${spec.methods.join(' and ')}.`,
        HttpStatus.METHOD_NOT_ALLOWED,
      );
    }
    const raw: RawDelivery = {
      method,
      contentType: call.headers['content-type'],
      body,
      query: call.query,
    };
    const guess = guessFormat(raw);
    if (guess === 'multipart' || (guess !== 'empty' && !spec.formats.includes(guess))) {
      throw new AppError(
        ERROR_CODES.MKT_WEBHOOK_BAD_PAYLOAD,
        `This address reads ${spec.formats.join(', ')}.`,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const target = {
      orgId,
      connectionId,
      installationId: row.id,
      installationUuid: row.uuid,
      appSlug: row.app.slug,
      appName: row.app.name,
      leadSourceId: conn.leadSourceId,
    };

    if (spec.mode === 'async') {
      // A request that carries nothing (a portal checking that the address answers) is acknowledged and not counted as a failure.
      if (guess === 'empty')
        return { status: 'accepted', received: 0, accepted: 0, duplicates: 0, rejected: 0 };
      const stored = await this.storeDelivery(orgId, connectionId, guess, raw, call);
      return {
        status: 'queued',
        received: 0,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        event: stored,
      };
    }

    // Sync: read, map and hand over before answering. A delivery that says nothing reads in the first format the recipe takes, so its
    // failure is that format's ("not valid JSON" for the generic webhook, as it always was).
    const format: InboundFormat = guess === 'empty' ? spec.formats[0]! : guess;
    const read = readDelivery(format, raw);
    if (!read.ok) throw this.badPayload(describeReadFailure(format, read.reason));
    const parsed = type.parse(recipe, read.value);
    if (parsed.leads.length === 0) {
      // Nothing usable: counted as a failed delivery so the connection page shows it, and the sender is told why.
      await this.delivery.process(target, [], Math.max(parsed.rejected.length, 1));
      throw this.badPayload(
        parsed.rejected[0]
          ? `No lead could be read from the delivery (${parsed.rejected[0].reason}).`
          : 'The delivery holds no lead.',
        parsed.rejected.slice(0, 5).map((r) => ({ path: `items.${r.index}`, message: r.reason })),
      );
    }

    const counts = await this.delivery.process(target, parsed.leads, parsed.rejected.length);
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

  /** Writes the delivery to the inbox. When that fails the sender is told to try again (503): nothing is acknowledged that is not stored. */
  private async storeDelivery(
    orgId: number,
    connectionId: number,
    format: InboundFormat,
    raw: RawDelivery,
    call: HookCall,
  ): Promise<string> {
    try {
      const stored = await this.intake.accept(orgId, {
        connectionId,
        method: raw.method as InboundMethod,
        format,
        contentType: raw.contentType?.slice(0, 200) ?? null,
        body: format === 'query' ? raw.query : raw.body.toString('utf8'),
        headers: keptHeaders(call.headers),
        sourceIp: call.ip?.slice(0, 64) ?? null,
      });
      return stored.uuid;
    } catch {
      throw new AppError(
        ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE,
        'The delivery could not be stored. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
