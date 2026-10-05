import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type {
  ConnectorKind,
  MarketAppKind,
  MarketConnectionStatus,
  MarketHealth,
  MarketInstallStatus,
} from '@crm/contracts';
import { decodeKeyset, encodeKeyset } from './marketplace-rules';
import {
  APP_PRICING_COLUMNS_TEXT,
  SUBSCRIPTION_COLUMNS_TEXT,
  readAppPricing,
  readSubscription,
  type AppPricingRow,
  type SubscriptionRow,
} from './pricing-model';
import { jsonb, textArray, toDate } from './sql-helpers';

type Raw = Record<string, unknown>;

/** An installation with its app, versions, connection and installer, as the manage page and the services need it. Secrets are still sealed. */
export interface InstallationRow {
  id: number;
  uuid: string;
  orgId: number;
  appId: number;
  installedVersionId: number;
  pendingVersionId: number | null;
  status: MarketInstallStatus;
  /** Paused because the paid app's subscription ended (status is then `disabled`). */
  pausedBySubscription: boolean;
  /** What the operator charges for the app, and the workspace's subscription to it. */
  pricing: AppPricingRow;
  sub: SubscriptionRow | null;
  grantedScopes: string[];
  config: Record<string, unknown>;
  credentialsEnc: string | null;
  credentialHints: Record<string, string>;
  health: MarketHealth;
  healthCheckedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  installedAt: Date;
  killReason: string | null;
  rowVersion: number;
  app: {
    uuid: string;
    slug: string;
    name: string;
    kind: MarketAppKind;
    status: string;
    logo: string | null;
    connectorType: ConnectorKind | null;
    categorySlug: string;
    categoryName: string;
  };
  version: string;
  manifest: Record<string, unknown>;
  recipe: Record<string, unknown> | null;
  pending: { version: string; scopes: string[] } | null;
  installer: { uuid: string; name: string } | null;
  connection: ConnectionRow | null;
}

export interface ConnectionRow {
  id: number;
  uuid: string;
  type: ConnectorKind;
  publicKey: string;
  secretEnc: string | null;
  secretHint: string | null;
  status: MarketConnectionStatus;
  pollIntervalSeconds: number | null;
  nextPollAt: Date | null;
  pollCursor: string | null;
  leadSourceId: number | null;
  lastEventAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  received: number;
  accepted: number;
  duplicates: number;
  failed: number;
}

const COLUMNS = sql.raw(`
  i.id, i.uuid, i.org_id, i.app_id, i.installed_version_id, i.pending_version_id, i.status, i.paused_by_subscription, i.granted_scopes, i.config, i.credentials_enc,
  i.credential_hints, i.health_status, i.health_checked_at, i.last_error, i.last_error_at, i.installed_at, i.kill_reason, i.row_version,
  a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name, a.kind AS app_kind, a.status AS app_status, a.listing AS app_listing,
  a.connector_type AS app_connector, c.slug AS category_slug, c.name AS category_name,
  iv.version, iv.manifest, iv.recipe,
  pv.version AS pending_version, pv.scopes AS pending_scopes,
  u.uuid AS installer_uuid, u.full_name AS installer_name,
  n.id AS conn_id, n.uuid AS conn_uuid, n.connector_type AS conn_type, n.public_key AS conn_public_key, n.secret_enc AS conn_secret_enc,
  n.secret_hint AS conn_secret_hint, n.status AS conn_status, n.poll_interval_seconds AS conn_poll, n.next_poll_at AS conn_next_poll,
  n.poll_cursor AS conn_cursor, n.lead_source_id AS conn_lead_source, n.last_event_at AS conn_last_event, n.last_success_at AS conn_last_success,
  n.last_error AS conn_last_error, n.consecutive_failures AS conn_failures, n.received_count AS conn_received, n.accepted_count AS conn_accepted,
  n.duplicate_count AS conn_duplicates, n.failed_count AS conn_failed,
  ${APP_PRICING_COLUMNS_TEXT},
  ${SUBSCRIPTION_COLUMNS_TEXT}`);

const FROM = sql`
  FROM workspace_app_installations i
  JOIN marketplace_apps a ON a.id = i.app_id
  JOIN marketplace_categories c ON c.id = a.category_id
  JOIN marketplace_app_versions iv ON iv.id = i.installed_version_id
  LEFT JOIN marketplace_app_versions pv ON pv.id = i.pending_version_id
  LEFT JOIN users u ON u.org_id = i.org_id AND u.id = i.installed_by
  LEFT JOIN marketplace_connections n ON n.org_id = i.org_id AND n.installation_id = i.id
  LEFT JOIN marketplace_subscriptions s ON s.org_id = i.org_id AND s.app_id = i.app_id`;

export function toInstallation(r: Raw): InstallationRow {
  const listing = (r.app_listing as Record<string, unknown> | null) ?? {};
  const recipe = (r.recipe as Record<string, unknown> | null) ?? null;
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    orgId: Number(r.org_id),
    appId: Number(r.app_id),
    installedVersionId: Number(r.installed_version_id),
    pendingVersionId: r.pending_version_id === null ? null : Number(r.pending_version_id),
    status: r.status as MarketInstallStatus,
    pausedBySubscription: r.paused_by_subscription === true,
    pricing: readAppPricing(r),
    sub: readSubscription(r),
    grantedScopes: (r.granted_scopes as string[]) ?? [],
    config: (r.config as Record<string, unknown>) ?? {},
    credentialsEnc: (r.credentials_enc as string | null) ?? null,
    credentialHints: (r.credential_hints as Record<string, string>) ?? {},
    health: r.health_status as MarketHealth,
    healthCheckedAt: toDate(r.health_checked_at),
    lastError: (r.last_error as string | null) ?? null,
    lastErrorAt: toDate(r.last_error_at),
    installedAt: toDate(r.installed_at)!,
    killReason: (r.kill_reason as string | null) ?? null,
    rowVersion: Number(r.row_version),
    app: {
      uuid: r.app_uuid as string,
      slug: r.app_slug as string,
      name: r.app_name as string,
      kind: r.app_kind as MarketAppKind,
      status: r.app_status as string,
      logo:
        (listing.logo as string | null | undefined) ??
        (recipe?.logo as string | null | undefined) ??
        null,
      connectorType: (r.app_connector as ConnectorKind | null) ?? null,
      categorySlug: r.category_slug as string,
      categoryName: r.category_name as string,
    },
    version: r.version as string,
    manifest: (r.manifest as Record<string, unknown>) ?? {},
    recipe,
    pending: r.pending_version
      ? { version: r.pending_version as string, scopes: (r.pending_scopes as string[]) ?? [] }
      : null,
    installer: r.installer_uuid
      ? { uuid: r.installer_uuid as string, name: (r.installer_name as string) ?? '' }
      : null,
    connection: r.conn_id
      ? {
          id: Number(r.conn_id),
          uuid: r.conn_uuid as string,
          type: r.conn_type as ConnectorKind,
          publicKey: r.conn_public_key as string,
          secretEnc: (r.conn_secret_enc as string | null) ?? null,
          secretHint: (r.conn_secret_hint as string | null) ?? null,
          status: r.conn_status as MarketConnectionStatus,
          pollIntervalSeconds: r.conn_poll === null ? null : Number(r.conn_poll),
          nextPollAt: toDate(r.conn_next_poll),
          pollCursor: (r.conn_cursor as string | null) ?? null,
          leadSourceId: r.conn_lead_source === null ? null : Number(r.conn_lead_source),
          lastEventAt: toDate(r.conn_last_event),
          lastSuccessAt: toDate(r.conn_last_success),
          lastError: (r.conn_last_error as string | null) ?? null,
          consecutiveFailures: Number(r.conn_failures),
          received: Number(r.conn_received),
          accepted: Number(r.conn_accepted),
          duplicates: Number(r.conn_duplicates),
          failed: Number(r.conn_failed),
        }
      : null,
  };
}

/** Column (snake) to the value to write on `workspace_app_installations`; a key that is absent is left alone. */
export type InstallationPatch = Partial<{
  config: Record<string, unknown>;
  credentials_enc: string | null;
  credential_hints: Record<string, string>;
  status: MarketInstallStatus;
  paused_by_subscription: boolean;
  disabled_at: Date | null;
  health_status: MarketHealth;
  health_checked_at: Date | null;
  last_error: string | null;
  last_error_at: Date | null;
  installed_version_id: number;
  pending_version_id: number | null;
  granted_scopes: string[];
}>;
const JSON_COLUMNS = new Set(['config', 'credential_hints']);

export interface NewInstallation {
  uuid: string;
  appId: number;
  versionId: number;
  grantedScopes: string[];
  config: Record<string, unknown>;
  credentialsEnc: string | null;
  credentialHints: Record<string, string>;
  installedBy: number | null;
}

export interface NewConnection {
  installationId: number;
  type: ConnectorKind;
  publicKey: string;
  secretEnc: string | null;
  secretHint: string | null;
  pollIntervalSeconds: number | null;
  leadSourceId: number | null;
}

export interface EventRow {
  id: number;
  uuid: string;
  externalId: string;
  status: 'accepted' | 'failed' | 'rejected';
  error: string | null;
  seenCount: number;
  receivedAt: Date;
}

/** Statements on the tenant's installation tables, run inside the caller's tenant transaction. */
@Injectable()
export class InstallationsRepository {
  async list(
    tx: Tx,
    orgId: number,
    f: { kind?: MarketAppKind; status?: MarketInstallStatus },
  ): Promise<InstallationRow[]> {
    const where: SQL[] = [sql`i.org_id = ${orgId}`];
    if (f.kind) where.push(sql`a.kind = ${f.kind}`);
    if (f.status) where.push(sql`i.status = ${f.status}`);
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM} WHERE ${sql.join(where, sql` AND `)} ORDER BY i.installed_at DESC, i.id DESC`);
    return (res.rows as Raw[]).map(toInstallation);
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<InstallationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM} WHERE i.org_id = ${orgId} AND i.uuid = ${uuid}::uuid
      ${forUpdate ? sql`FOR UPDATE OF i` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toInstallation(row) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<InstallationRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} ${FROM} WHERE i.org_id = ${orgId} AND i.id = ${id}`,
    );
    const row = (res.rows as Raw[])[0];
    return row ? toInstallation(row) : null;
  }

  async byAppId(
    tx: Tx,
    orgId: number,
    appId: number,
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid FROM workspace_app_installations WHERE org_id = ${orgId} AND app_id = ${appId}`,
    );
    const row = (res.rows as Raw[])[0];
    return row ? { id: Number(row.id), uuid: row.uuid as string } : null;
  }

  async insert(tx: Tx, orgId: number, v: NewInstallation): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO workspace_app_installations
        (org_id, uuid, app_id, installed_version_id, granted_scopes, config, credentials_enc, credential_hints, installed_by)
      VALUES (${orgId}, ${v.uuid}::uuid, ${v.appId}, ${v.versionId}, ${textArray(v.grantedScopes)}, ${jsonb(v.config)},
              ${v.credentialsEnc}, ${jsonb(v.credentialHints)}, ${v.installedBy})
      RETURNING id`);
    return Number((res.rows as Raw[])[0]!.id);
  }

  /** Optimistic when `expectedVersion` is given: a stale value updates nothing and returns false. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    patch: InstallationPatch,
    expectedVersion?: number,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    for (const [column, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!/^[a-z_]+$/.test(column)) throw new Error(`bad column ${column}`);
      if (column === 'granted_scopes')
        sets.push(sql`granted_scopes = ${textArray(value as string[])}`);
      else if (JSON_COLUMNS.has(column)) sets.push(sql`${sql.raw(column)} = ${jsonb(value)}`);
      else if (value instanceof Date)
        sets.push(sql`${sql.raw(column)} = ${value.toISOString()}::timestamptz`);
      else sets.push(sql`${sql.raw(column)} = ${value}`);
    }
    if (sets.length === 0) return true;
    const version =
      expectedVersion === undefined ? sql`` : sql` AND row_version = ${expectedVersion}`;
    const res = await tx.execute(sql`
      UPDATE workspace_app_installations SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}${version} RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM workspace_app_installations WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async insertConsent(
    tx: Tx,
    orgId: number,
    c: {
      installationId: number;
      appId: number;
      versionId: number;
      action: 'install' | 'reconsent' | 'uninstall';
      scopes: string[];
      previousScopes: string[];
      dataChoice: 'keep' | 'delete' | null;
      consentedBy: number | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO marketplace_consents
        (org_id, installation_id, app_id, version_id, action, scopes, previous_scopes, data_choice, consented_by)
      VALUES (${orgId}, ${c.installationId}, ${c.appId}, ${c.versionId}, ${c.action}, ${textArray(c.scopes)},
              ${textArray(c.previousScopes)}, ${c.dataChoice}, ${c.consentedBy})`);
  }

  async insertConnection(tx: Tx, orgId: number, c: NewConnection): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO marketplace_connections
        (org_id, installation_id, connector_type, public_key, secret_enc, secret_hint, poll_interval_seconds, next_poll_at, lead_source_id)
      VALUES (${orgId}, ${c.installationId}, ${c.type}, ${c.publicKey}, ${c.secretEnc}, ${c.secretHint}, ${c.pollIntervalSeconds},
              ${c.pollIntervalSeconds ? sql`now()` : sql`NULL`}, ${c.leadSourceId})
      RETURNING id`);
    return Number((res.rows as Raw[])[0]!.id);
  }

  async setConnectionSecret(
    tx: Tx,
    orgId: number,
    id: number,
    secretEnc: string,
    hint: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET secret_enc = ${secretEnc}, secret_hint = ${hint}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setConnectionStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: MarketConnectionStatus,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE marketplace_connections SET status = ${status} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * New credentials for a pull connection: one that stopped on a refusal or too many failures polls again, and one that was backing off
   * does not wait the back-off out; the next poll is the soonest the portal's minimum interval allows. A paused connection stays paused.
   */
  async resumePolling(
    tx: Tx,
    orgId: number,
    id: number,
    minIntervalSeconds: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET
        status = 'active', consecutive_failures = 0,
        next_poll_at = GREATEST(now(), COALESCE(last_poll_at + (${minIntervalSeconds} || ' seconds')::interval, now()))
      WHERE org_id = ${orgId} AND id = ${id} AND connector_type = 'pull' AND status IN ('active', 'error')`);
  }

  async setLeadSource(tx: Tx, orgId: number, id: number, leadSourceId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE marketplace_connections SET lead_source_id = ${leadSourceId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * Counts a delivery's outcome on the connection and moves the installation's health with it: a success resets the failure run and
   * makes it healthy; three failures in a row make it degraded. One statement each, so a burst of deliveries cannot lose a count.
   */
  async recordDelivery(
    tx: Tx,
    orgId: number,
    connectionId: number,
    installationId: number,
    o: {
      received: number;
      accepted: number;
      duplicates: number;
      failed: number;
      error: string | null;
    },
  ): Promise<void> {
    const ok = o.failed === 0 && o.accepted + o.duplicates > 0;
    await tx.execute(sql`
      UPDATE marketplace_connections SET
        received_count = received_count + ${o.received}, accepted_count = accepted_count + ${o.accepted},
        duplicate_count = duplicate_count + ${o.duplicates}, failed_count = failed_count + ${o.failed},
        last_event_at = now(),
        last_success_at = CASE WHEN ${ok} THEN now() ELSE last_success_at END,
        consecutive_failures = CASE WHEN ${ok} THEN 0 WHEN ${o.failed > 0} THEN consecutive_failures + 1 ELSE consecutive_failures END,
        last_error = CASE WHEN ${ok} AND status <> 'error' THEN NULL WHEN ${o.error !== null} THEN ${o.error} ELSE last_error END,
        last_error_at = CASE WHEN ${o.error !== null} THEN now() ELSE last_error_at END
      WHERE org_id = ${orgId} AND id = ${connectionId}`);
    // A connection that polls AND receives (IndiaMART) and has stopped on a refused key stays stopped, and unhealthy, until the key is
    // replaced: a lead that arrives by its push address says nothing about the key. (Only a pull connection is ever in `error`.)
    if (ok) {
      await tx.execute(sql`
        UPDATE workspace_app_installations SET health_status = 'healthy', health_checked_at = now(), last_error = NULL
        WHERE org_id = ${orgId} AND id = ${installationId} AND status = 'active'
          AND NOT EXISTS (SELECT 1 FROM marketplace_connections WHERE org_id = ${orgId} AND id = ${connectionId} AND status = 'error')`);
    } else if (o.error !== null) {
      await tx.execute(sql`
        UPDATE workspace_app_installations SET
          health_status = CASE WHEN (SELECT consecutive_failures FROM marketplace_connections WHERE org_id = ${orgId} AND id = ${connectionId}) >= 3
                               THEN 'degraded' ELSE health_status END,
          health_checked_at = now(), last_error = ${o.error}, last_error_at = now()
        WHERE org_id = ${orgId} AND id = ${installationId} AND status = 'active'`);
    }
  }

  // --- deliveries -----------------------------------------------------------------------------------------------------------------------

  async eventOf(
    tx: Tx,
    orgId: number,
    connectionId: number,
    externalId: string,
  ): Promise<{ id: number; status: string } | null> {
    const res = await tx.execute(sql`
      SELECT id, status FROM marketplace_connection_events
      WHERE org_id = ${orgId} AND connection_id = ${connectionId} AND external_id = ${externalId} FOR UPDATE`);
    const row = (res.rows as Raw[])[0];
    return row ? { id: Number(row.id), status: row.status as string } : null;
  }

  async bumpSeen(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE marketplace_connection_events SET seen_count = seen_count + 1, last_seen_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** One row per delivery id: a retry of a failed one turns it into the outcome of the retry. */
  async recordEvent(
    tx: Tx,
    orgId: number,
    connectionId: number,
    externalId: string,
    status: 'accepted' | 'failed' | 'rejected',
    error: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO marketplace_connection_events (org_id, connection_id, external_id, status, error)
      VALUES (${orgId}, ${connectionId}, ${externalId}, ${status}, ${error})
      ON CONFLICT (org_id, connection_id, external_id) DO UPDATE
        SET status = EXCLUDED.status, error = EXCLUDED.error, seen_count = marketplace_connection_events.seen_count + 1,
            last_seen_at = now()`);
  }

  async events(
    tx: Tx,
    orgId: number,
    connectionId: number,
    q: { limit: number; cursor?: string },
  ): Promise<{ rows: Array<EventRow & { cursor: string }>; badCursor: boolean }> {
    const k = q.cursor ? decodeKeyset(q.cursor, 1) : null;
    if (q.cursor && !k) return { rows: [], badCursor: true };
    const res = await tx.execute(sql`
      SELECT id, uuid, external_id, status, error, seen_count, received_at, received_at::text AS k0
      FROM marketplace_connection_events
      WHERE org_id = ${orgId} AND connection_id = ${connectionId}
        ${k ? sql`AND (received_at, id) < (${k.keys[0]!}::timestamptz, ${k.id}::bigint)` : sql``}
      ORDER BY received_at DESC, id DESC LIMIT ${q.limit + 1}`);
    return {
      rows: (res.rows as Raw[]).map((r) => ({
        id: Number(r.id),
        uuid: r.uuid as string,
        externalId: r.external_id as string,
        status: r.status as EventRow['status'],
        error: (r.error as string | null) ?? null,
        seenCount: Number(r.seen_count),
        receivedAt: toDate(r.received_at)!,
        cursor: encodeKeyset([String(r.k0)], Number(r.id)),
      })),
      badCursor: false,
    };
  }
}
