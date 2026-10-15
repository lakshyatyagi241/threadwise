import { sql } from 'drizzle-orm';
import { parse } from 'pg-connection-string';
import {
  createDbClient,
  type DbClient,
  type Database,
  type Tx,
} from '../../../packages/db/src/client';
import { withTenant, withPrivileged } from '../../../packages/db/src/tenant';

export type { Database, DbClient };
export type TenantTx = Tx;
export { sql, withTenant, withPrivileged };

/** A pool for one role. Long statement timeout: a 1000-row batch with big jsonb is not a 15-second query. */
export function connect(url: string, name: string): DbClient {
  return createDbClient({
    url,
    poolMax: 4,
    statementTimeoutMs: 600_000,
    applicationName: `migration-tool:${name}`,
  });
}

/**
 * The tool's own schema. Created by the OWNER (`init`), never by a migration of the app: this tool is throwaway and must not leak
 * into packages/db. No RLS on purpose: it holds provenance, not tenant data; only crm_worker gets access.
 */
export const DDL = `
CREATE SCHEMA IF NOT EXISTS migration;

CREATE TABLE IF NOT EXISTS migration.id_map (
  source_client     text        NOT NULL,
  source_collection text        NOT NULL,
  source_key        text        NOT NULL,
  key_kind          text        NOT NULL CHECK (key_kind IN ('objectid', 'string_id')),
  target_table      text        NOT NULL,
  target_org_id     bigint      NOT NULL,
  target_id         bigint      NOT NULL,
  target_uuid       uuid,
  migrated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_client, source_collection, source_key)
);
CREATE INDEX IF NOT EXISTS id_map_target_idx ON migration.id_map (target_table, target_org_id, target_id);
-- update mode: the row_version the tool's own last UPDATE left on the target row (NULL = never updated by the tool = still the inserted 1).
-- A row whose row_version differs was edited in WaDesk since, and update mode leaves it alone.
ALTER TABLE migration.id_map ADD COLUMN IF NOT EXISTS written_version bigint;

CREATE TABLE IF NOT EXISTS migration.quarantine (
  source_client text        NOT NULL,
  collection    text        NOT NULL,
  source_key    text        NOT NULL,
  reason_code   text        NOT NULL,
  reason        text        NOT NULL,
  doc           jsonb,
  at            timestamptz NOT NULL DEFAULT now(),
  resolved      boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (source_client, collection, source_key, reason_code)
);

CREATE TABLE IF NOT EXISTS migration.run_log (
  source_client text        NOT NULL,
  collection    text        NOT NULL,
  step          text        NOT NULL,
  run_id        text        NOT NULL,
  last_key      bigint      NOT NULL DEFAULT 0,
  state         text        NOT NULL,
  counts        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_sha256 text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_client, collection, step)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker') THEN
    GRANT USAGE ON SCHEMA migration TO crm_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA migration TO crm_worker;
  END IF;
END $$;
`;

export async function ensureSchema(db: Database): Promise<void> {
  await db.execute(sql.raw(DDL));
}

export async function schemaReady(db: Database): Promise<boolean> {
  const r = await db.execute(sql`SELECT to_regclass('migration.id_map') IS NOT NULL AS ok`);
  return Boolean((r.rows[0] as { ok: boolean }).ok);
}

export const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;

// --- production guard ------------------------------------------------------------------------------------------------------------

export interface Target {
  host: string;
  port: string;
  db: string;
  user: string;
}

/** Hostnames of a docker-compose stack that are safe by default. Any other docker-style single label needs --allow-docker-host. */
export const DEFAULT_DOCKER_HOSTS = [
  'crm-postgres',
  'crm-platform-postgres',
  'host.docker.internal',
];

/**
 * The host `pg` will REALLY connect to. A URL such as postgres://u:p@localhost/db?host=evil.example.com looks local but pg connects to
 * the query-string host, so the URL is parsed the way pg parses it (pg-connection-string) and every override is refused.
 */
export function parseTarget(url: string): Target {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      'the database URL cannot be parsed (it is not printed because it holds a password)',
    );
  }
  for (const k of ['host', 'hostaddr', 'service', 'socket', 'unix_socket', 'sslrootcert']) {
    if (u.searchParams.has(k)) {
      throw new Error(
        `refusing a database URL with a ?${k}= override: the connection would not go where the URL host says`,
      );
    }
  }
  const opts = u.searchParams.get('options');
  if (opts !== null && /host/i.test(opts))
    throw new Error('refusing a database URL whose ?options= mentions a host');
  const cfg = parse(url);
  const effective = String(cfg.host ?? '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const urlHost = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (effective === '' || urlHost === '') {
    throw new Error(
      'refusing a database URL with no host: pg would fall back to PGHOST or a unix socket',
    );
  }
  if (effective.startsWith('/') || effective !== urlHost) {
    throw new Error(
      `refusing a database URL whose effective host (${effective}) differs from the URL host (${urlHost}) or is a socket path`,
    );
  }
  return {
    host: effective,
    port: u.port || '5432',
    db: decodeURIComponent(u.pathname.replace(/^\//, '')),
    user: decodeURIComponent(u.username),
  };
}

function loopback(h: string): boolean {
  if (h === 'localhost' || h === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return Boolean(m) && [m![1], m![2], m![3]].every((o) => Number(o) <= 255);
}

/** localhost, 127.0.0.0/8 (dotted quad), ::1, or a docker-compose name on the allow list. Nothing else is "local". */
export function isLocalHost(host: string, extraDockerHosts: string[] = []): boolean {
  const h = host.toLowerCase();
  if (loopback(h)) return true;
  return [...DEFAULT_DOCKER_HOSTS, ...extraDockerHosts.map((x) => x.toLowerCase())].includes(h);
}

export interface GuardOptions {
  allowHosts?: string[];
  allowDockerHosts?: string[];
  confirmDbName?: string | null;
  dryRun?: boolean;
}

/**
 * Refuses to touch a database that is not obviously a scratch one. A non-local host needs `--allow-target-host <host>`; and unless
 * it is a dry run it also needs `--confirm-db-name=<the exact database name>`. A docker-style name outside the default list needs
 * `--allow-docker-host <name>` (or MIGRATION_ALLOW_DOCKER_HOSTS). Returns the line to print before anything is written.
 */
export function assertTargetAllowed(url: string, role: string, opts: GuardOptions = {}): string {
  const t = parseTarget(url);
  const line = `${role}: host=${t.host} port=${t.port} db=${t.db} role=${t.user}`;
  const docker = [
    ...(opts.allowDockerHosts ?? []),
    ...(process.env.MIGRATION_ALLOW_DOCKER_HOSTS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  ];
  if (isLocalHost(t.host, docker)) return line;
  const allowed = (opts.allowHosts ?? []).map((h) => h.toLowerCase()).includes(t.host);
  if (!allowed) {
    throw new Error(
      `refusing to run against ${t.host}: it is not localhost / 127.0.0.0/8 / ::1 / a known docker name. If this really is the intended server, pass --allow-target-host ${t.host} (a docker-compose service name: --allow-docker-host ${t.host}).`,
    );
  }
  if (!opts.dryRun && opts.confirmDbName !== t.db) {
    throw new Error(
      `refusing to write to ${t.host}/${t.db}: a non-local database needs --confirm-db-name=${t.db} typed exactly (dry runs do not).`,
    );
  }
  return line;
}
