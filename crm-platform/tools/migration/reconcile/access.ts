import type { AccessCtx } from '../transform/access-plan';
import type { Doc } from '../util';
import { mask } from '../util';
import { ORG_COLLECTION } from '../load/org';
import { ROLES_VERSION_STEP, seatWarning } from '../load/access';
import { sql, withTenant, type Database } from '../load/db';
import { AccessOracle, adminClass, type OEntry, type ORole, type ORoleMap } from './oracle-access';

type Row = Record<string, unknown>;

const TS = (c: string): string =>
  `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${c.split('.').pop()}`;
/** A source ISO millisecond timestamp as the target reads back (microseconds). */
const us = (iso: string | null): string | null => (iso === null ? null : iso.slice(0, -1) + '000');
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Row)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}
const PRESETS = ['admin', 'workspace_admin', 'manager', 'agent', 'viewer'];

export interface AccessVerifyInput {
  db: Database;
  orgId: number;
  client: string;
  access: AccessCtx;
  roleDocs: Doc[];
  userDocs: Doc[];
  contactDocs: Doc[];
  hasUsers: boolean;
  defaultCc: string | null;
  fallbackAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
}

/**
 * Everything the roles and users steps write, held against an independent oracle (reconcile/oracle-access.ts): every column of every
 * row, extra rows, the grant sets, id_map both ways, the NO-ADMIN invariant over the whole organization, the secrets scan and the
 * owner of every contact.
 */
export async function verifyAccess(a: AccessVerifyInput): Promise<void> {
  const { db, orgId, client, alarm } = a;
  const q = async (text: string): Promise<Row[]> =>
    (await withTenant(db, { orgId }, (tx) => tx.execute(sql.raw(text)))).rows as Row[];

  const oracle = new AccessOracle({
    client,
    roleDocs: a.roleDocs,
    userDocs: a.userDocs,
    entries: a.access.config.permissionMap.entries as Record<string, OEntry>,
    roleMap: (a.access.config.roleMap[client] ?? {}) as Record<string, ORoleMap>,
    defs: a.access.defs,
    featureOpen: a.access.featureOpen,
    ownerEmail: a.access.ownerEmail,
    defaultCc: a.defaultCc,
    fallbackAt: a.fallbackAt,
  });

  // --- what is in the target -------------------------------------------------------------------------------------------------------
  const roleRows = await q(
    `SELECT id, uuid::text AS uuid, name, system_key, is_locked, row_version, ${TS('created_at')}, ${TS('updated_at')} FROM roles WHERE org_id = ${orgId}`,
  );
  const grantRows = await q(
    `SELECT g.permission_key, g.effect::text AS effect, g.record_scope::text AS scope, r.uuid::text AS role_uuid, r.system_key
     FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE g.org_id = ${orgId}`,
  );
  const userRows = await q(
    `SELECT id, uuid::text AS uuid, email::text AS email, full_name, password_hash IS NOT NULL AS has_pw, auth_subject, status, settings, row_version,
            ${TS('invited_at')}, ${TS('joined_at')}, ${TS('created_at')}, ${TS('updated_at')} FROM users WHERE org_id = ${orgId}`,
  );
  const profileRows = await q(
    `SELECT user_id, display_name, phone_e164, ${TS('phone_verified_at')}, locale, theme, row_version, ${TS('created_at')}, ${TS('updated_at')} FROM user_profiles WHERE org_id = ${orgId}`,
  );
  const securityRows = await q(
    `SELECT user_id, ${TS('email_verified_at')}, ${TS('password_changed_at')}, force_password_change, ${TS('last_login_at')}, mfa_enabled,
            mfa_secret_enc IS NOT NULL AS has_mfa_secret, ${TS('mfa_confirmed_at')}, mfa_last_step, mfa_recovery_hashes::text AS mfa_recovery,
            row_version, ${TS('created_at')}, ${TS('updated_at')} FROM user_security WHERE org_id = ${orgId}`,
  );
  const userRoleRows = await q(`SELECT user_id, role_id FROM user_roles WHERE org_id = ${orgId}`);
  const orgRow = (
    await q(`SELECT settings->>'ownerUserId' AS owner FROM organizations WHERE id = ${orgId}`)
  )[0];
  const ownerUuid = (orgRow?.owner as string | null) ?? null;

  const roleByUuid = new Map(roleRows.map((r) => [String(r.uuid), r]));
  const presetRole = (key: string): Row | undefined => roleRows.find((r) => r.system_key === key);
  const userByUuid = new Map(userRows.map((r) => [String(r.uuid), r]));

  // --- roles -----------------------------------------------------------------------------------------------------------------------
  const customRoles = oracle.rolePrimary.filter((r) => !r.deleted && r.kind === 'custom');
  const wantRoleUuids = new Set(customRoles.map((r) => r.uuid));
  for (const r of customRoles) {
    const t = roleByUuid.get(r.uuid);
    if (!t) {
      alarm(`ROLE_MISSING_IN_TARGET: custom role ${r.key} has no roles row`);
      continue;
    }
    const bad: string[] = [];
    if (t.name !== r.name) bad.push('name');
    if (t.created_at !== us(r.created)) bad.push('created_at');
    if (t.updated_at !== us(r.updated)) bad.push('updated_at');
    if (t.system_key !== null) bad.push('system_key');
    if (t.is_locked !== false) bad.push('is_locked');
    if (Number(t.row_version) !== 1) bad.push('row_version');
    if (bad.length > 0)
      alarm(
        `ORACLE_MISMATCH: roles ${r.key}: ${bad.join(', ')} differ from the independent expectation`,
      );
  }
  if (!a.allowExtraRows)
    for (const t of roleRows)
      if (t.system_key === null && !wantRoleUuids.has(String(t.uuid)))
        alarm(
          `EXTRA_ROWS: roles: a custom role (uuid ${String(t.uuid)}) is not accounted for by any Waboo role`,
        );
  const seenKeys = new Set<string>();
  for (const t of roleRows) {
    const k = t.system_key as string | null;
    if (k !== null && (!PRESETS.includes(k) || seenKeys.has(k)))
      alarm(
        `ROLE_SYSTEM_KEY: role "${String(t.name)}" carries system_key ${k}: only the five presets, once each`,
      );
    if (k !== null) seenKeys.add(k);
    if (t.is_locked === true && k !== 'admin')
      alarm(`ROLE_LOCKED: role "${String(t.name)}" is locked but is not the Owner preset`);
  }

  // --- grants of the custom roles: the exact set, never above the ceiling, never admin-class without an approver ---------------------
  const gotGrants = new Map<string, Map<string, string>>();
  for (const g of grantRows) {
    if (g.effect !== 'allow')
      alarm(
        `DENY_ROW: a role_grants row has effect ${String(g.effect)}; the migration writes allow only`,
      );
    if (g.system_key !== null) continue; // presets are held by the baseline digest
    const m = gotGrants.get(String(g.role_uuid)) ?? new Map<string, string>();
    m.set(String(g.permission_key), String(g.scope));
    gotGrants.set(String(g.role_uuid), m);
  }
  for (const r of customRoles) {
    const got = gotGrants.get(r.uuid) ?? new Map<string, string>();
    for (const [k, s] of r.grants)
      if (got.get(k) !== s)
        alarm(
          `GRANT_MISSING: role ${r.key}: expected ${k} (${s}) ${got.has(k) ? `but found scope ${got.get(k)}` : 'is not granted'}`,
        );
    for (const [k, s] of got) {
      if (r.grants.get(k) === s) continue;
      alarm(
        `GRANT_EXTRA: role ${r.key}: ${k} (${s}) is granted but the independent computation does not grant it`,
      );
      if (!r.reachable.has(k))
        alarm(
          `OVER_GRANT: role ${r.key}: ${k} is not reachable from any accessible Waboo permission through a reviewed map entry`,
        );
      if (adminClass(k, a.access.defs.get(k)?.category) && !r.allowAdmin)
        alarm(
          `ADMIN_CLASS_GRANT: role ${r.key} holds ${k} without allowAdminClass and an approver in role-map.json`,
        );
    }
  }
  for (const [uuid, m] of gotGrants)
    if (!wantRoleUuids.has(uuid) && m.size > 0)
      alarm(
        `EXTRA_ROWS: role_grants: ${m.size} grant(s) on a custom role no Waboo role accounts for`,
      );

  // --- users -----------------------------------------------------------------------------------------------------------------------
  const wantUsers = [...oracle.users.values()].filter((u) => !u.adoptsOwner);
  const wantUuids = new Set(wantUsers.map((u) => u.uuid));
  const rolesOf = (userId: number): number[] =>
    userRoleRows.filter((r) => Number(r.user_id) === userId).map((r) => Number(r.role_id));
  const profile = new Map(profileRows.map((r) => [Number(r.user_id), r]));
  const security = new Map(securityRows.map((r) => [Number(r.user_id), r]));
  const expectedRoleRow = (u: (typeof wantUsers)[number]): Row | undefined =>
    u.role.kind === 'custom'
      ? roleByUuid.get(u.role.role.uuid)
      : presetRole(u.role.kind === 'preset' ? u.role.preset : 'viewer');
  for (const u of wantUsers) {
    const t = userByUuid.get(u.uuid);
    if (!t) {
      alarm(`USER_MISSING_IN_TARGET: user ${u.key} has no users row`);
      continue;
    }
    const bad: string[] = [];
    const cmp = (name: string, got: unknown, want: unknown): void => {
      if (got !== want) bad.push(name);
    };
    cmp('email', t.email, u.email);
    cmp('full_name', t.full_name, u.fullName);
    cmp('status', t.status, u.status);
    cmp('created_at', t.created_at, us(u.created));
    cmp('updated_at', t.updated_at, us(u.updated));
    cmp('invited_at', t.invited_at, us(u.invited));
    cmp('joined_at', t.joined_at, us(u.joined));
    cmp('row_version', Number(t.row_version), 1);
    if (t.has_pw) bad.push('password_hash');
    if (t.auth_subject !== null) bad.push('auth_subject');
    if (stable(t.settings) !== stable(u.settings)) bad.push('settings');
    if (bad.length > 0)
      alarm(
        `ORACLE_MISMATCH: users ${u.key}: ${bad.join(', ')} differ from the independent expectation`,
      );
    const id = Number(t.id);
    const p = profile.get(id);
    const pb: string[] = [];
    if (!p) pb.push('row');
    else {
      if (p.display_name !== null) pb.push('display_name');
      if (p.phone_e164 !== u.phone) pb.push('phone_e164');
      if (p.phone_verified_at !== us(u.phoneVerified)) pb.push('phone_verified_at');
      if (p.locale !== null) pb.push('locale');
      if (p.theme !== 'paper') pb.push('theme');
      if (Number(p.row_version) !== 1) pb.push('row_version');
      if (p.created_at !== us(u.created)) pb.push('created_at');
      if (p.updated_at !== us(u.updated)) pb.push('updated_at');
    }
    if (pb.length > 0) alarm(`ORACLE_MISMATCH: user_profiles ${u.key}: ${pb.join(', ')}`);
    const s = security.get(id);
    const sb: string[] = [];
    if (!s) sb.push('row');
    else {
      if (s.email_verified_at !== us(u.emailVerified)) sb.push('email_verified_at');
      for (const c of [
        'password_changed_at',
        'last_login_at',
        'mfa_confirmed_at',
        'mfa_last_step',
        'mfa_secret_enc',
      ])
        if (s[c] !== undefined && s[c] !== null) sb.push(c);
      if (s.force_password_change !== false) sb.push('force_password_change');
      if (s.mfa_enabled !== false) sb.push('mfa_enabled');
      if (s.has_mfa_secret !== false) sb.push('mfa_secret_enc');
      if (s.mfa_recovery !== '[]') sb.push('mfa_recovery_hashes');
      if (Number(s.row_version) !== 1) sb.push('row_version');
      if (s.created_at !== us(u.created)) sb.push('created_at');
      if (s.updated_at !== us(u.updated)) sb.push('updated_at');
    }
    if (sb.length > 0) alarm(`ORACLE_MISMATCH: user_security ${u.key}: ${sb.join(', ')}`);
    const want = expectedRoleRow(u);
    const have = rolesOf(id);
    if (!want || have.length !== 1 || have[0] !== Number(want.id))
      alarm(
        `ROLE_ASSIGNMENT: user ${u.key} must hold exactly one role (${u.role.kind}${u.role.kind === 'preset' ? ` ${u.role.preset}` : ''}) but holds ${have.length}`,
      );
  }
  if (!a.allowExtraRows)
    for (const t of userRows)
      if (String(t.uuid) !== ownerUuid && !wantUuids.has(String(t.uuid)))
        alarm(
          `EXTRA_ROWS: users: a user (${mask(t.email)}) is neither the owner nor accounted for by a Waboo user`,
        );

  // --- the owner: exactly the --owner-email user holds Owner; an adopted Waboo user is that row, untouched -------------------------------
  const ownerRole = presetRole('admin');
  const holders = userRoleRows.filter(
    (r) => ownerRole && Number(r.role_id) === Number(ownerRole.id),
  );
  const ownerRow = ownerUuid ? userByUuid.get(ownerUuid) : undefined;
  if (a.access.ownerEmail) {
    if (!ownerRow || holders.length !== 1 || Number(holders[0]!.user_id) !== Number(ownerRow.id))
      alarm(
        `OWNER_ROLE: exactly one user (the --owner-email user) must hold the Owner role, found ${holders.length}`,
      );
  } else if (holders.length > 0 && !a.allowExtraRows) {
    alarm(
      `OWNER_ROLE: ${holders.length} user(s) hold the Owner role but no owner was created by this tool`,
    );
  }
  for (const u of oracle.users.values())
    if (u.adoptsOwner && !ownerRow)
      alarm(`OWNER_ADOPT: user ${u.key} is the owner's email but the owner row is missing`);

  // --- NO-ADMIN, over EVERY user of the organization -------------------------------------------------------------------------------------
  const allGrants = await q(
    `SELECT r.id AS role_id, r.name, r.system_key, g.permission_key FROM roles r LEFT JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id AND g.effect = 'allow' WHERE r.org_id = ${orgId}`,
  );
  const roleInfo = new Map<number, { name: string; system: string | null; adminKeys: string[] }>();
  for (const g of allGrants) {
    const id = Number(g.role_id);
    const info = roleInfo.get(id) ?? {
      name: String(g.name),
      system: (g.system_key as string | null) ?? null,
      adminKeys: [],
    };
    const key = g.permission_key as string | null;
    // the app's own presets (Manager, Agent, Viewer) are judged by what they are; custom roles by what they hold
    if (key && info.system === null && adminClass(key, a.access.defs.get(key)?.category))
      info.adminKeys.push(key);
    roleInfo.set(id, info);
  }
  const holders2: string[] = [];
  for (const t of userRows) {
    const rs = rolesOf(Number(t.id))
      .map((id) => roleInfo.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const admin = rs.filter(
      (r) => r.system === 'admin' || r.system === 'workspace_admin' || r.adminKeys.length > 0,
    );
    if (admin.length === 0) continue;
    holders2.push(`${mask(t.email)} (${admin.map((r) => r.name).join(', ')})`);
    if (String(t.uuid) === ownerUuid) continue;
    const ou = [...oracle.users.values()].find((u) => u.uuid === String(t.uuid));
    const approved =
      ou?.role.kind === 'preset'
        ? ou.role.role.approver
        : ou?.role.kind === 'custom'
          ? ou.role.role.allowAdmin
          : false;
    if (!approved)
      alarm(
        `NO_ADMIN: user ${mask(t.email)} holds an admin-class role (${admin.map((r) => r.name).join(', ')}) and role-map.json has no approved mapping for it`,
      );
  }
  a.warnings.push(
    `NO-ADMIN: ${holders2.length} user(s) hold an admin-class role: ${holders2.length ? holders2.join('; ') : 'none'} (each must be the owner or an approved mapping)`,
  );

  // --- id_map, both ways, from the oracle ---------------------------------------------------------------------------------------------
  const map = (
    await db.execute(
      sql`SELECT source_collection, source_key, target_uuid::text AS uuid FROM migration.id_map WHERE source_client = ${client} AND source_collection IN ('roles', 'user')`,
    )
  ).rows as Array<{ source_collection: string; source_key: string; uuid: string | null }>;
  const want = new Map<string, string>();
  for (const r of oracle.rolePrimary) {
    if (r.deleted) continue;
    const u = r.kind === 'custom' ? r.uuid : (presetRole(r.preset!)?.uuid as string | undefined);
    if (u) for (const k of r.keys) if (!want.has(`roles\0${k}`)) want.set(`roles\0${k}`, u);
  }
  for (const u of oracle.users.values())
    for (const k of u.keys) want.set(`user\0${k}`, u.adoptsOwner ? (ownerUuid ?? '') : u.uuid);
  const have = new Map(map.map((m) => [`${m.source_collection}\0${m.source_key}`, m.uuid]));
  for (const [k, u] of want) {
    if (!have.has(k))
      alarm(`IDMAP_MISSING: id_map has no entry for ${k.replace('\0', ' ')} (independent check)`);
    else if (have.get(k) !== u)
      alarm(
        `IDMAP_WRONG: id_map ${k.replace('\0', ' ')} points at the wrong row (independent check)`,
      );
  }
  for (const k of have.keys())
    if (!want.has(k))
      alarm(
        `IDMAP_EXTRA: id_map has ${k.replace('\0', ' ')} that no Waboo role or user owns (independent check)`,
      );

  // --- secrets: a password value from the dump must be nowhere ---------------------------------------------------------------------
  const secrets = new Set<string>();
  for (const d of a.userDocs)
    for (const [k, v] of Object.entries(d))
      if (/pass|pwd/i.test(k) && typeof v === 'string' && v.length >= 4) secrets.add(v);
  if (secrets.size > 0) {
    const list = JSON.stringify([...secrets]);
    const leak = async (label: string, body: string): Promise<void> => {
      const r = await withTenant(db, { orgId }, (tx) =>
        tx.execute(sql.raw(body.replace('$LIST', `'${list.replace(/'/g, "''")}'::jsonb`))),
      );
      if (Number((r.rows[0] as { n: number }).n) > 0)
        alarm(
          `PASSWORD_LEAK: a password value from the dump appears in ${label} (the value is not printed)`,
        );
    };
    const any = (txt: string): string =>
      `EXISTS (SELECT 1 FROM jsonb_array_elements_text($LIST) s WHERE position(s in ${txt}) > 0)`;
    await leak(
      'users',
      `SELECT count(*)::int AS n FROM users x WHERE x.org_id = ${orgId} AND ${any('to_jsonb(x)::text')}`,
    );
    await leak(
      'user_profiles',
      `SELECT count(*)::int AS n FROM user_profiles x WHERE x.org_id = ${orgId} AND ${any('to_jsonb(x)::text')}`,
    );
    await leak(
      'user_security',
      `SELECT count(*)::int AS n FROM user_security x WHERE x.org_id = ${orgId} AND ${any('to_jsonb(x)::text')}`,
    );
    await leak(
      'migration.quarantine',
      `SELECT count(*)::int AS n FROM migration.quarantine x WHERE x.source_client = '${client.replace(/'/g, "''")}' AND ${any('to_jsonb(x)::text')}`,
    );
    await leak(
      'migration.run_log',
      `SELECT count(*)::int AS n FROM migration.run_log x WHERE x.source_client = '${client.replace(/'/g, "''")}' AND ${any('to_jsonb(x)::text')}`,
    );
  }

  // --- who owns each contact -----------------------------------------------------------------------------------------------------------
  const docs = new Map<string, Doc>();
  for (const d of a.contactDocs) docs.set(String(d._id), d);
  const owners = await q(
    `SELECT c.legacy_id, u.uuid::text AS owner_uuid FROM contacts c LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.owner_id WHERE c.org_id = ${orgId} AND c.legacy_id IS NOT NULL`,
  );
  let wrongOwner = 0;
  for (const r of owners) {
    const d = docs.get(String(r.legacy_id));
    if (!d) continue;
    const raw = d.contact_owner;
    const u =
      a.hasUsers && raw !== undefined && raw !== null && String(raw).trim() !== ''
        ? oracle.ownerOf(raw)
        : null;
    const wantOwner = u ? (u.adoptsOwner ? ownerUuid : u.uuid) : null;
    if ((r.owner_uuid ?? null) !== wantOwner) wrongOwner++;
  }
  if (wrongOwner > 0)
    alarm(
      `CONTACT_OWNER: ${wrongOwner} contact(s) have an owner_id that differs from the independent resolution of contact_owner`,
    );

  // --- RBAC cache key, plan seats, lost-access summary -------------------------------------------------------------------------------
  const touched = customRoles.length + wantUsers.length > 0;
  if (touched) {
    const marker = (
      await db.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = ${ROLES_VERSION_STEP}`,
      )
    ).rows[0] as { counts?: { before: number; after: number } } | undefined;
    const cur = Number(
      (await q(`SELECT roles_version FROM organizations WHERE id = ${orgId}`))[0]!.roles_version,
    );
    // the loader's bump must still be in effect. The app may bump it again later (a role edit after the run), so a higher value is
    // fine; only a value below the loader's own bump means the cache key went back.
    if (!marker?.counts || !(marker.counts.after > marker.counts.before) || cur < marker.counts.after)
      alarm(
        'ROLES_VERSION: organizations.roles_version was not increased after roles and users were written (RBAC could serve a stale grant set)',
      );
  }
  const seats = await seatWarning(db, orgId);
  if (seats) a.warnings.push(seats);
  const lost = (
    await db.execute(
      sql`SELECT collection, reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_client = ${client} AND collection IN ('roles', 'user') AND source_key LIKE '%#%' GROUP BY 1, 2 ORDER BY 1, 2`,
    )
  ).rows as Array<{ collection: string; reason_code: string; n: number }>;
  if (lost.length > 0)
    a.warnings.push(
      `ACCESS REVIEW: ${lost.map((l) => `${l.collection}:${l.reason_code} x${l.n}`).join(', ')} (PERM_* = access Waboo had that the new roles do not; ROLE_* = users who got Viewer)`,
    );
}

export type { ORole };
