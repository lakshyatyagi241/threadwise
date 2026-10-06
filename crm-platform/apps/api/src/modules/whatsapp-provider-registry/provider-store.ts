import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PlatformStore } from '../auth';

/** A `whatsapp_providers` row as it comes out of the database (secrets still sealed). */
export interface ProviderRow {
  id: number;
  uuid: string;
  key: string;
  label: string;
  builtin: 'meta' | 'interakt' | null;
  adapter_kind: string;
  base_url: string;
  api_version: string;
  auth_scheme: 'bearer' | 'custom_headers';
  header_templates: Record<string, string>;
  credential_mode: 'platform_token' | 'channel_token';
  credentials_enc: string | null;
  credential_hints: Record<string, string>;
  webhook_mode: 'meta_app_level' | 'number_level_override';
  signature_scheme: 'meta_app_secret_sha256' | 'shared_secret_header' | 'none';
  signature_header_name: string | null;
  billing_mode: 'provider_credit_line' | 'customer_direct' | 'meta_reseller';
  capabilities: { mediaUpload: boolean };
  onboarding: 'manual' | 'embedded_signup';
  onboarding_app_id: string | null;
  onboarding_config_id: string | null;
  partner_program: 'pinnacle' | null;
  partner_solution_id: string | null;
  status: 'active' | 'disabled' | 'archived';
  is_default: boolean;
  notes: string | null;
  last_test: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  row_version: number;
  /** Only on `list`: numbers on this provider and workspaces overriding to it. */
  number_count?: number;
  workspace_count?: number;
}

export interface NewProviderRow {
  key: string;
  label: string;
  adapterKind: string;
  baseUrl: string;
  apiVersion: string;
  authScheme: string;
  headerTemplates: Record<string, string>;
  credentialMode: string;
  credentialsEnc: string | null;
  credentialHints: Record<string, string>;
  webhookMode: string;
  signatureScheme: string;
  signatureHeaderName: string | null;
  billingMode: string;
  capabilities: { mediaUpload: boolean };
  onboarding: string;
  onboardingAppId: string | null;
  onboardingConfigId: string | null;
  partnerProgram: string | null;
  partnerSolutionId: string | null;
  notes: string | null;
  operatorId: number;
}

/** Column name (snake) to the value to write; a key that is absent is left alone. */
export type ProviderPatch = Partial<{
  label: string;
  base_url: string;
  api_version: string;
  auth_scheme: string;
  header_templates: Record<string, string>;
  credential_mode: string;
  credentials_enc: string | null;
  credential_hints: Record<string, string>;
  webhook_mode: string;
  signature_scheme: string;
  signature_header_name: string | null;
  billing_mode: string;
  capabilities: { mediaUpload: boolean };
  onboarding: string;
  onboarding_app_id: string | null;
  onboarding_config_id: string | null;
  partner_program: string | null;
  partner_solution_id: string | null;
  notes: string | null;
  status: string;
  is_default: boolean;
  last_test: Record<string, unknown> | null;
}>;

const JSON_COLUMNS = new Set(['header_templates', 'credential_hints', 'capabilities', 'last_test']);

const COLUMN_LIST = [
  'id',
  'uuid',
  'key',
  'label',
  'builtin',
  'adapter_kind',
  'base_url',
  'api_version',
  'auth_scheme',
  'header_templates',
  'credential_mode',
  'credentials_enc',
  'credential_hints',
  'webhook_mode',
  'signature_scheme',
  'signature_header_name',
  'billing_mode',
  'capabilities',
  'onboarding',
  'onboarding_app_id',
  'onboarding_config_id',
  'partner_program',
  'partner_solution_id',
  'status',
  'is_default',
  'notes',
  'last_test',
  'created_at',
  'updated_at',
  'row_version',
];
const COLUMNS = sql.raw(COLUMN_LIST.map((c) => `p.${c}`).join(', '));
const COLUMNS_NO_ALIAS = sql.raw(COLUMN_LIST.join(', '));

/** The key a connection is on: `meta_json.provider_key`, else the legacy `provider` value. The same rule as `providerKeyOf` in TypeScript. */
export const CONNECTION_PROVIDER_KEY = sql.raw(
  `COALESCE(NULLIF(w.meta_json ->> 'provider_key', ''), CASE WHEN w.meta_json ->> 'provider' = 'interakt' THEN 'interakt' ELSE 'meta' END)`,
);

const toRow = (r: Record<string, unknown>): ProviderRow => ({
  ...(r as unknown as ProviderRow),
  id: Number(r.id),
  row_version: Number(r.row_version),
  created_at: new Date(r.created_at as string),
  updated_at: new Date(r.updated_at as string),
  ...(r.number_count !== undefined ? { number_count: Number(r.number_count) } : {}),
  ...(r.workspace_count !== undefined ? { workspace_count: Number(r.workspace_count) } : {}),
});

/** A workspace's connected WABA number, as the switch and the tenant read need it. */
export interface NumberRow {
  id: number;
  uuid: string;
  status: string;
  phone_number: string | null;
  display_label: string | null;
  meta_json: Record<string, unknown> | null;
  credentials_json: string | null;
}

export interface AssignmentRow {
  org_id: number;
  provider_id: number;
  provider_uuid: string;
  provider_key: string;
  provider_label: string;
  provider_status: string;
  updated_at: Date;
}

/**
 * Every statement on `whatsapp_providers` and `org_whatsapp_provider_assignment`, run on the platform store (the privileged door the
 * auth domain owns). The registry is platform data, so nothing here takes an org except to scope a per-workspace read.
 */
@Injectable()
export class ProviderStore {
  constructor(private readonly platform: PlatformStore) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.platform.tx(fn);
  }

  async all(tx: Tx): Promise<ProviderRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS},
            (SELECT count(*)::int FROM wa_provider_configs w
              WHERE w.provider = 'waba' AND ${CONNECTION_PROVIDER_KEY} = p.key) AS number_count,
            (SELECT count(*)::int FROM org_whatsapp_provider_assignment a WHERE a.provider_id = p.id) AS workspace_count
          FROM whatsapp_providers p
          ORDER BY p.builtin IS NULL, p.is_default DESC, p.key`,
    );
    return res.rows.map(toRow);
  }

  /** Every row, no counts: what the send path keeps in memory. */
  async forRouting(tx: Tx): Promise<ProviderRow[]> {
    const res = await tx.execute(sql`SELECT ${COLUMNS} FROM whatsapp_providers p`);
    return res.rows.map(toRow);
  }

  async byUuid(tx: Tx, uuid: string): Promise<ProviderRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM whatsapp_providers p WHERE p.uuid = ${uuid}::uuid`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async byId(tx: Tx, id: number): Promise<ProviderRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM whatsapp_providers p WHERE p.id = ${id}`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async byKey(tx: Tx, key: string): Promise<ProviderRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM whatsapp_providers p WHERE p.key = ${key}`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async defaultActive(tx: Tx): Promise<ProviderRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM whatsapp_providers p WHERE p.is_default AND p.status = 'active'`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async insert(tx: Tx, v: NewProviderRow): Promise<ProviderRow> {
    const res = await tx.execute(
      sql`INSERT INTO whatsapp_providers
            (key, label, adapter_kind, base_url, api_version, auth_scheme, header_templates, credential_mode, credentials_enc,
             credential_hints, webhook_mode, signature_scheme, signature_header_name, billing_mode, capabilities, onboarding,
             onboarding_app_id, onboarding_config_id, partner_program, partner_solution_id, notes, created_by_operator_id)
          VALUES
            (${v.key}, ${v.label}, ${v.adapterKind}, ${v.baseUrl}, ${v.apiVersion}, ${v.authScheme},
             ${JSON.stringify(v.headerTemplates)}::jsonb, ${v.credentialMode}, ${v.credentialsEnc},
             ${JSON.stringify(v.credentialHints)}::jsonb, ${v.webhookMode}, ${v.signatureScheme}, ${v.signatureHeaderName},
             ${v.billingMode}, ${JSON.stringify(v.capabilities)}::jsonb, ${v.onboarding}, ${v.onboardingAppId},
             ${v.onboardingConfigId}, ${v.partnerProgram}, ${v.partnerSolutionId}, ${v.notes}, ${v.operatorId})
          RETURNING ${COLUMNS_NO_ALIAS}`,
    );
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /** Optimistic: a stale `expectedVersion` updates nothing and returns null. */
  async update(
    tx: Tx,
    id: number,
    patch: ProviderPatch,
    expectedVersion?: number,
  ): Promise<ProviderRow | null> {
    const sets: SQL[] = [];
    for (const [column, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!/^[a-z_]+$/.test(column)) throw new Error(`bad column ${column}`);
      sets.push(
        JSON_COLUMNS.has(column)
          ? sql`${sql.raw(column)} = ${value === null ? null : JSON.stringify(value)}::jsonb`
          : sql`${sql.raw(column)} = ${value}`,
      );
    }
    if (sets.length === 0) return this.byId(tx, id);
    const version =
      expectedVersion === undefined ? sql`` : sql` AND row_version = ${expectedVersion}`;
    const res = await tx.execute(
      sql`UPDATE whatsapp_providers SET ${sql.join(sets, sql`, `)}
          WHERE id = ${id}${version}
          RETURNING ${COLUMNS_NO_ALIAS}`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async clearDefault(tx: Tx): Promise<void> {
    await tx.execute(sql`UPDATE whatsapp_providers SET is_default = false WHERE is_default`);
  }

  async recordTest(tx: Tx, id: number, result: Record<string, unknown>): Promise<void> {
    await tx.execute(
      sql`UPDATE whatsapp_providers SET last_test = ${JSON.stringify(result)}::jsonb, last_tested_at = now() WHERE id = ${id}`,
    );
  }

  /** The default moves in one statement so the partial unique index never sees two. */
  async makeDefault(tx: Tx, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE whatsapp_providers SET is_default = false WHERE is_default AND id <> ${id}`,
    );
    await tx.execute(sql`UPDATE whatsapp_providers SET is_default = true WHERE id = ${id}`);
  }

  // --- assignments ----------------------------------------------------------------------------------------------------------------

  async assignmentOf(tx: Tx, orgId: number): Promise<AssignmentRow | null> {
    const res = await tx.execute(
      sql`SELECT a.org_id, a.provider_id, p.uuid AS provider_uuid, p.key AS provider_key, p.label AS provider_label,
                 p.status AS provider_status, a.updated_at
          FROM org_whatsapp_provider_assignment a JOIN whatsapp_providers p ON p.id = a.provider_id
          WHERE a.org_id = ${orgId}`,
    );
    const r = res.rows[0] as Record<string, unknown> | undefined;
    return r
      ? ({
          ...(r as unknown as AssignmentRow),
          org_id: Number(r.org_id),
          provider_id: Number(r.provider_id),
          updated_at: new Date(r.updated_at as string),
        } as AssignmentRow)
      : null;
  }

  async setAssignment(
    tx: Tx,
    orgId: number,
    providerId: number,
    operatorId: number,
    note: string | null,
  ): Promise<void> {
    await tx.execute(
      sql`INSERT INTO org_whatsapp_provider_assignment (org_id, provider_id, assigned_by_operator_id, note)
          VALUES (${orgId}, ${providerId}, ${operatorId}, ${note})
          ON CONFLICT (org_id) DO UPDATE
            SET provider_id = EXCLUDED.provider_id, assigned_by_operator_id = EXCLUDED.assigned_by_operator_id,
                note = EXCLUDED.note`,
    );
  }

  async clearAssignment(tx: Tx, orgId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM org_whatsapp_provider_assignment WHERE org_id = ${orgId} RETURNING org_id`,
    );
    return res.rows.length > 0;
  }

  /** Workspaces for the operator's assignment list, keyset on (created_at, id) of the organization. */
  async workspaces(
    tx: Tx,
    q: {
      search?: string;
      overrideOnly?: boolean;
      orgId?: number;
      limit: number;
      after?: { iso: string; id: number };
    },
  ): Promise<
    Array<{
      id: number;
      uuid: string;
      name: string;
      slug: string;
      created_at: Date;
      created_at_iso: string;
      provider_uuid: string | null;
      provider_key: string | null;
      provider_label: string | null;
      assigned_at: Date | null;
      number_count: number;
      numbers_by_key: Record<string, number>;
    }>
  > {
    const where: SQL[] = [sql`true`];
    if (q.search) {
      const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
    }
    if (q.overrideOnly) where.push(sql`a.org_id IS NOT NULL`);
    if (q.orgId !== undefined) where.push(sql`o.id = ${q.orgId}`);
    if (q.after)
      where.push(sql`(o.created_at, o.id) < (${q.after.iso}::timestamptz, ${q.after.id})`);
    const res = await tx.execute(
      sql`SELECT o.id, o.uuid, o.name, o.slug, o.created_at,
                 to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
                 p.uuid AS provider_uuid, p.key AS provider_key, p.label AS provider_label, a.updated_at AS assigned_at,
                 COALESCE((SELECT jsonb_object_agg(k, n) FROM (
                    SELECT ${CONNECTION_PROVIDER_KEY} AS k, count(*)::int AS n FROM wa_provider_configs w
                    WHERE w.org_id = o.id AND w.provider = 'waba' AND w.status = 'connected' GROUP BY 1) s), '{}'::jsonb) AS numbers_by_key
          FROM organizations o
          LEFT JOIN org_whatsapp_provider_assignment a ON a.org_id = o.id
          LEFT JOIN whatsapp_providers p ON p.id = a.provider_id
          WHERE ${sql.join(where, sql` AND `)}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ${q.limit + 1}`,
    );
    return res.rows.map((r) => {
      const byKey = (r.numbers_by_key ?? {}) as Record<string, number>;
      return {
        id: Number(r.id),
        uuid: String(r.uuid),
        name: String(r.name),
        slug: String(r.slug),
        created_at: new Date(r.created_at as string),
        created_at_iso: String(r.created_at_iso),
        provider_uuid: (r.provider_uuid as string | null) ?? null,
        provider_key: (r.provider_key as string | null) ?? null,
        provider_label: (r.provider_label as string | null) ?? null,
        assigned_at: r.assigned_at ? new Date(r.assigned_at as string) : null,
        number_count: Object.values(byKey).reduce((a, b) => a + Number(b), 0),
        numbers_by_key: byKey,
      };
    });
  }

  async orgByUuid(
    tx: Tx,
    uuid: string,
  ): Promise<{ id: number; uuid: string; name: string; slug: string } | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid, name, slug FROM organizations WHERE uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      { id: number | string; uuid: string; name: string; slug: string } | undefined;
    return r ? { ...r, id: Number(r.id) } : null;
  }

  /** A workspace's connected-or-not WABA numbers (provider 'waba'), newest first. */
  async numbersOf(tx: Tx, orgId: number): Promise<NumberRow[]> {
    const res = await tx.execute(
      sql`SELECT id, uuid, status, phone_number, display_label, meta_json, credentials_json
          FROM wa_provider_configs w WHERE w.org_id = ${orgId} AND w.provider = 'waba'
          ORDER BY w.is_primary DESC, w.connected_at DESC NULLS LAST, w.id DESC`,
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      uuid: String(r.uuid),
      status: String(r.status),
      phone_number: (r.phone_number as string | null) ?? null,
      display_label: (r.display_label as string | null) ?? null,
      meta_json: (r.meta_json as Record<string, unknown> | null) ?? null,
      credentials_json: (r.credentials_json as string | null) ?? null,
    }));
  }

  /** The provider keys of the connections that own these phone number ids, for the webhook (public: no tenant yet). */
  async keysOfPhones(tx: Tx, phoneNumberIds: string[]): Promise<string[]> {
    if (phoneNumberIds.length === 0) return [];
    const res = await tx.execute(
      sql`SELECT DISTINCT ${CONNECTION_PROVIDER_KEY} AS k FROM wa_provider_configs w
          WHERE w.provider = 'waba'
            AND w.meta_json ->> 'phone_number_id' IN (${sql.join(
              phoneNumberIds.map((p) => sql`${p}`),
              sql`, `,
            )})`,
    );
    return res.rows.map((r) => String(r.k));
  }
}
