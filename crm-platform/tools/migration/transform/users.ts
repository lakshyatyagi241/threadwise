import {
  bool,
  docKeysWith,
  isDeleted,
  mask,
  Oid,
  plain,
  scrub,
  setOwn,
  str,
  toDate,
  type Doc,
} from '../util';
import { c, TS_COLS } from './common';
import { transformHooks } from './contacts';
import { userActive, userEmail } from './access-plan';
import type { Ctx, HandlerSpec, Outcome, Soft, TargetRef } from './types';

const LIST_CONFIGS = [
  'contact_list_config',
  'marketing_list_config',
  'segment_contact_config',
  'deal_list_config',
  'company_list_config',
];

const USER_FIELDS: Record<string, string> = {
  _id: 'id',
  user_id: 'id (second key, registered in id_map: contact_owner and created_by use it)',
  username: 'col:email (only when email is absent and the username is an email address)',
  email: 'col:email (trimmed, lower-cased)',
  first_name: 'col:full_name',
  last_name: 'col:full_name',
  is_active: 'col:status (false = inactive)',
  workspace_enabled:
    'settings.legacy.waboo.workspace_enabled (history only: NOT a disable switch, false is normal for an active user)',
  is_staff:
    'settings.legacy.waboo.is_staff (kept as history; NEVER read for privilege, a role comes from role-map only)',
  date_joined: 'col:created_at (earliest) and col:joined_at',
  created_time: 'col:created_at (earliest) / invited_at',
  modified_time: 'col:updated_at',
  is_deleted: 'drop:soft-delete flag; deleted users are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp',
  phone: 'user_profiles.phone_e164',
  is_phone_verified: 'user_profiles.phone_verified_at (approximated by modified_time)',
  is_email_verified: 'user_security.email_verified_at (approximated by modified_time)',
  role_id: 'user_roles (through role-map; missing, deleted or unknown = Viewer)',
  business_id: 'settings.legacy.waboo.business_id',
  group_id: 'settings.legacy.waboo.group_id (string or int in the source; stored as a string)',
  module_id: 'settings.legacy.waboo.module_id',
  workspace_id: 'drop:one organization per client (a second distinct value is reported)',
  gender: 'settings.legacy.waboo.gender',
  chat_limit:
    'user_profiles.chat_limit (1..1000, empty or 0 = no limit) and settings.legacy.waboo.chat_limit (history)',
  contact_list_config: 'settings.legacy.waboo.listConfigs (column_sequence and columns only)',
  marketing_list_config: 'settings.legacy.waboo.listConfigs (column_sequence and columns only)',
  segment_contact_config: 'settings.legacy.waboo.listConfigs (column_sequence and columns only)',
  deal_list_config: 'settings.legacy.waboo.listConfigs (column_sequence and columns only)',
  company_list_config: 'settings.legacy.waboo.listConfigs (column_sequence and columns only)',
  password: 'drop:credential. Never read, copied, logged or quarantined',
  whatsapp_action_preference:
    'drop:no column in WaDesk (a per-user WhatsApp action preference); logged in missing-in-wadesk-log.md',
};

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * A Waboo role named `admin` (case and spaces ignored). Its users become Owners of the migrated workspace: the owner's decision of
 * 2026-10-21 (see the admin branch of the role step below).
 */
export const isWabooAdminRole = (name: string | null | undefined): boolean =>
  (name ?? '').trim().toLowerCase() === 'admin';

/** Waboo "Concurrent Chat": a whole number from 1; missing, empty, 0 or not a number = no limit; above 1000 is 1000 (the column's cap). */
export const chatLimitOf = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(1000, Math.floor(n)) : null;
};

/** Waboo users, invited-style: no password, no token, no mail. The role comes from role-map or is Viewer; Owner only for the owner. */
export const users: HandlerSpec = {
  handler: 'users',
  collection: 'user',
  mapCollection: 'user',
  aliasKeys: ['user_id'],
  fields: USER_FIELDS,
  tables: {
    users: {
      columns: [
        c('email', 'citext'),
        c('full_name', 'text'),
        c('password_hash', 'text'),
        c('auth_subject', 'text'),
        c('status', 'text'),
        c('settings', 'jsonb'),
        c('invited_at', 'timestamptz'),
        c('joined_at', 'timestamptz'),
        ...TS_COLS,
      ],
      fp: ['email', 'full_name', 'status'],
      constants: { row_version: 1 },
    },
    user_profiles: {
      keyless: { parent: 'users', parentCol: 'user_id' },
      columns: [
        c('user_id', 'bigint'),
        c('display_name', 'text'),
        c('phone_e164', 'text'),
        c('phone_verified_at', 'timestamptz'),
        c('chat_limit', 'integer'),
        c('locale', 'text'),
        c('theme', 'text'),
        ...TS_COLS,
      ],
      constants: { row_version: 1 },
    },
    user_security: {
      keyless: { parent: 'users', parentCol: 'user_id' },
      columns: [
        c('user_id', 'bigint'),
        c('email_verified_at', 'timestamptz'),
        c('password_changed_at', 'timestamptz'),
        c('force_password_change', 'boolean'),
        c('last_login_at', 'timestamptz'),
        c('mfa_enabled', 'boolean'),
        ...TS_COLS,
      ],
      constants: {
        mfa_secret_enc: null,
        mfa_confirmed_at: null,
        mfa_last_step: null,
        mfa_recovery_hashes: [],
        row_version: 1,
      },
    },
    user_roles: {
      keyless: { parent: 'users', parentCol: 'user_id' },
      columns: [c('user_id', 'bigint'), c('role_id', 'bigint')],
    },
  },
  transform(raw: Doc, ctx: Ctx): Outcome {
    // a credential is never looked at: whatever its name, it is gone before anything else reads the document
    const doc: Doc = {};
    for (const [k, v] of Object.entries(raw))
      if (!/pass|pwd|secret|token/i.test(k)) setOwn(doc, k, v);

    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const acc = ctx.access;
    const key = docKeysWith(doc, ['user_id'])[0]?.key;
    if (!acc || !key)
      return {
        kind: 'quarantine',
        code: 'ACCESS_NOT_READY',
        reason: 'no user plan for this document',
      };

    const { email, present: hasEmail } = userEmail(doc);
    if (!email)
      return {
        kind: 'quarantine',
        code: 'INVALID_EMAIL',
        reason: hasEmail ? 'not an email address' : 'no email (and no email-like username)',
      };
    if (!acc.users.winners.has(key))
      return {
        kind: 'quarantine',
        code: 'DUPLICATE_EMAIL',
        reason:
          'another user document owns this email (active first, then the newest modified_time)',
      };
    const soft: Soft[] = [];
    if (acc.users.ownerDoc === key && acc.ownerEmail) {
      soft.push({
        code: 'OWNER_ADOPTED',
        reason:
          'this person is the --owner-email user: the existing Owner row is kept as it is (role, name, status, password); no second row, no role from Waboo',
      });
      return { kind: 'adopt', table: 'users', column: 'email', value: acc.ownerEmail, soft };
    }

    // --- dates -----------------------------------------------------------------------------------------------------------------------
    const joinedDoc = toDate(doc.date_joined);
    const createdDoc = toDate(doc.created_time);
    const stamps = [joinedDoc, createdDoc].filter((d): d is Date => d !== null);
    let created: Date;
    if (stamps.length) created = new Date(Math.min(...stamps.map((d) => d.getTime())));
    else {
      const fromId = (raw._id instanceof Oid ? raw._id.date : null) ?? new Date(ctx.fallbackAt);
      created = fromId;
      soft.push({
        code: 'NO_DATE',
        reason: 'no usable date: stamped with the ObjectId time or the dump manifest time',
      });
    }
    const updated = toDate(doc.modified_time) ?? created;
    const iso = (d: Date): string => d.toISOString();

    // --- identity --------------------------------------------------------------------------------------------------------------------
    const names = [str(doc.first_name), str(doc.last_name)].filter((x): x is string => x !== null);
    const fullName = names.join(' ') || email.split('@')[0]!;
    const status = userActive(doc) ? 'active' : 'inactive';
    const usable = bool(doc.is_email_verified);
    const joinedAt = usable ? iso(joinedDoc ?? created) : null;

    // --- phone -----------------------------------------------------------------------------------------------------------------------
    let phone: string | null = null;
    const rawPhone = str(doc.phone);
    if (rawPhone) {
      phone = transformHooks.phoneOf(rawPhone, null, ctx.defaultCountryCode);
      if (!phone)
        soft.push({
          code: 'INVALID_PHONE',
          reason: 'cannot be read as an E.164 number; left empty (the raw value is not stored)',
          detail: mask(rawPhone),
        });
    }

    // --- role: never from is_staff, never from a name; Viewer when in doubt -----------------------------------------------------------
    const viewer = acc.presets.viewer;
    if (!viewer)
      return {
        kind: 'quarantine',
        code: 'NO_VIEWER_PRESET',
        reason: 'the Viewer preset role is missing',
      };
    let role: TargetRef = viewer;
    const roleKey = typeof doc.role_id === 'string' ? doc.role_id.trim() : '';
    const plan = roleKey ? acc.roles.get(roleKey) : undefined;
    if (!roleKey || !plan)
      soft.push({
        code: 'ROLE_MISSING',
        reason: 'role_id is missing, not a string, or matches no role: the user gets Viewer',
        detail: roleKey ? 'unknown role id' : 'no role id',
      });
    else if (plan.deleted)
      soft.push({
        code: 'ROLE_DELETED',
        reason: 'the role is soft-deleted: the user gets Viewer',
      });
    else if (isWabooAdminRole(plan.renamedFrom ?? plan.name) && acc.presets.admin) {
      // The owner's decision (2026-10-21): the old account's admins are Owners of the migrated workspace, the locked top preset, not a
      // custom role called "admin". Only this rule gives Owner: the role map still refuses preset:admin (access/config.ts).
      role = acc.presets.admin;
      soft.push({
        code: 'ADMIN_IS_OWNER',
        reason: 'a Waboo admin becomes an Owner of the migrated workspace (the owner decided this for every migrated admin)',
      });
    } else {
      const ref = ctx.ref('roles', roleKey);
      if (!ref || ref.uuid === acc.presets.admin?.uuid)
        soft.push({
          code: 'ROLE_NOT_LOADED',
          reason:
            'the role did not load (or points at the Owner role, which is refused): the user gets Viewer',
        });
      else role = ref;
    }
    if (acc.users.workspaceIds > 1)
      soft.push({
        code: 'WORKSPACE_ID_MISMATCH',
        reason: 'the users carry more than one workspace_id; this client is one organization',
      });
    if (present(doc.group_id))
      soft.push({
        code: 'GROUP_ID_UNRESOLVED',
        reason: 'group_id is kept in settings only: the dump has no groups collection',
      });

    // --- settings: history only, nothing in here grants anything ---------------------------------------------------------------------
    const waboo: Record<string, unknown> = {
      sourceUserId: str(doc.user_id) ?? key,
      is_staff: bool(doc.is_staff),
    };
    for (const k of ['business_id', 'module_id', 'gender', 'chat_limit'])
      if (present(doc[k])) waboo[k] = plain(doc[k]);
    if (present(doc.group_id)) waboo.group_id = String(doc.group_id);
    if (present(doc.workspace_enabled)) waboo.workspace_enabled = bool(doc.workspace_enabled);
    if (present(doc.is_active)) waboo.is_active = bool(doc.is_active);
    const listConfigs: Record<string, unknown> = {};
    for (const k of LIST_CONFIGS) {
      const v = doc[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const o = v as Record<string, unknown>;
      const keep: Record<string, unknown> = {};
      for (const f of ['column_sequence', 'columns']) if (present(o[f])) keep[f] = plain(o[f]);
      listConfigs[k] = scrub(keep).value;
    }
    if (Object.keys(listConfigs).length) waboo.listConfigs = listConfigs;

    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'users',
          sub: '',
          row: {
            email,
            full_name: fullName,
            password_hash: null,
            auth_subject: null,
            status,
            settings: { legacy: { waboo } },
            invited_at: iso(created),
            joined_at: joinedAt,
            created_at: iso(created),
            updated_at: iso(updated),
          },
        },
        {
          table: 'user_profiles',
          sub: '#profile',
          row: {
            display_name: null,
            phone_e164: phone,
            phone_verified_at: phone && bool(doc.is_phone_verified) ? iso(updated) : null,
            chat_limit: chatLimitOf(doc.chat_limit),
            locale: null,
            theme: 'paper',
            created_at: iso(created),
            updated_at: iso(updated),
          },
        },
        {
          table: 'user_security',
          sub: '#security',
          row: {
            email_verified_at: usable ? iso(updated) : null,
            password_changed_at: null,
            force_password_change: false,
            last_login_at: null,
            mfa_enabled: false,
            created_at: iso(created),
            updated_at: iso(updated),
          },
        },
        { table: 'user_roles', sub: '#role', row: { role_id: role.id } },
      ],
    };
  },
};
