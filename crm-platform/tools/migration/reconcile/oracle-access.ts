/**
 * INDEPENDENT oracle for roles, grants and users, written for the verifier. It imports nothing from transform/ or access/ (no loader
 * code, no policy code, no admin-class list): the rules of the spec are written down a second time here, so a bug or a "fix" in the
 * loader's version makes the target disagree with this one and reconcile fails. Shared on purpose: the pure helpers `uuidv5` and
 * `scrub` of util.ts (a hash and the one credential definition) and the oracle's own date / phone helpers.
 */
import { scrub, uuidv5 } from '../util';
import { dateOf, hexKey, oidDate, oracleDeleted, oraclePhone, text, truthy } from './oracle';

type Doc = Record<string, unknown>;

// --- admin-class: written again, deliberately not imported ---------------------------------------------------------------------------
const ADMIN_PREFIXES = [
  'billing.',
  'paygw.',
  'admin.',
  'org.',
  'bsp.billing.',
  'api.keys.',
  'aiadm.keys.',
  'partner.',
];
const ADMIN_EXACT = new Set([
  'plan.subscription.manage',
  'webhooks.manage',
  'inbox.integration.manage',
  'inbox.channel.manage',
  'auth.branding.update',
  'market.apps.manage',
]);
export function adminClass(key: string, category: string | null | undefined): boolean {
  if (category === 'admin') return true;
  return (
    ADMIN_PREFIXES.some((p) => key.startsWith(p)) ||
    ADMIN_EXACT.has(key) ||
    /^wallet\.[a-z_.]*(topup|adjust|manage)/.test(key)
  );
}

export interface OKeyDef {
  category: string;
  supportsScope: boolean;
  planFeature: string | null;
  appSlug: string | null;
}
export interface OEntry {
  status?: string;
  reviewedBy?: string;
  create?: string[];
  read?: string[];
  update?: string[];
  delete?: string[];
  use?: string[];
  scope?: string | null;
}
export interface ORoleMap {
  to: string;
  approvedBy?: string;
  allowAdminClass?: boolean;
}

const flag = (v: unknown, dflt: boolean): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(true|1|yes|y|t)$/i.test(v.trim());
  if (typeof v === 'number') return v !== 0;
  return dflt;
};
const hasBadText = (v: unknown): boolean => {
  if (typeof v === 'string')
    return (
      v.includes(String.fromCharCode(0)) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v)
    );
  if (Array.isArray(v)) return v.some(hasBadText);
  if (
    v &&
    typeof v === 'object' &&
    !(v instanceof Date) &&
    typeof (v as { toJSON?: unknown }).toJSON !== 'function'
  )
    return Object.entries(v as Doc).some(([k, x]) => hasBadText(k) || hasBadText(x));
  return false;
};
const keysOf = (d: Doc, extra: string[] = []): string[] => {
  const out: string[] = [];
  const add = (v: unknown): void => {
    const t = text(v);
    if (t && !out.includes(t)) out.push(t);
  };
  add(d._id === undefined || d._id === null ? '' : hexKey(d._id));
  add(d.id);
  for (const e of extra) add(d[e]);
  return out;
};
const isoOf = (d: Date): string => d.toISOString();
const plainJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

// --- roles --------------------------------------------------------------------------------------------------------------------------
export interface ORole {
  key: string;
  keys: string[];
  deleted: boolean;
  kind: 'custom' | 'preset';
  preset: string | null;
  approver: boolean;
  allowAdmin: boolean;
  name: string;
  created: string;
  updated: string;
  uuid: string;
  /** key -> scope the custom role must hold */
  grants: Map<string, string>;
  /** every key reachable from an accessible Waboo permission through a REVIEWED entry (the ceiling) */
  reachable: Set<string>;
}

const PRESET_NAMES = ['owner', 'admin', 'manager', 'agent', 'viewer'];
const WIDTH: Record<string, number> = { own: 1, team: 2, all: 3 };

export class AccessOracle {
  readonly roles = new Map<string, ORole>(); // every key of a role -> role
  readonly rolePrimary: ORole[] = [];
  readonly users = new Map<string, OUser>(); // winner primary key -> user
  readonly userByKey = new Map<string, OUser>(); // any key of a loaded user -> user
  workspaceIds = 0;

  constructor(
    private readonly a: {
      client: string;
      roleDocs: Doc[];
      userDocs: Doc[];
      entries: Record<string, OEntry>;
      roleMap: Record<string, ORoleMap>;
      defs: Map<string, OKeyDef>;
      featureOpen: (f: string) => boolean;
      ownerEmail: string | null;
      defaultCc: string | null;
      fallbackAt: string;
    },
  ) {
    this.buildRoles();
    this.buildUsers();
  }

  private buildRoles(): void {
    const taken = new Set(PRESET_NAMES);
    for (const d of this.a.roleDocs) {
      const keys = keysOf(d);
      if (keys.length === 0 || hasBadText(d)) continue;
      const mapped = keys.map((k) => this.a.roleMap[k]).find((m) => m !== undefined);
      const preset = mapped && mapped.to !== 'custom' ? mapped.to.replace('preset:', '') : null;
      const deleted = oracleDeleted(d);
      const allowAdmin = Boolean(mapped?.allowAdminClass && text(mapped?.approvedBy) !== '');
      let name = text(d.label) || text(d.name);
      if (!deleted && !preset) {
        if (!name) name = `Waboo role ${keys[0]}`;
        let want = PRESET_NAMES.includes(name.toLowerCase()) ? `${name} (Waboo)` : name;
        for (let n = 2; taken.has(want.toLowerCase()); n++) want = `${name} (${n})`;
        taken.add(want.toLowerCase());
        name = want;
      }
      const created =
        dateOf(
          [d.created_time, d.created_at].find(
            (v) => v !== undefined && v !== null && text(v) !== '',
          ),
        ) ??
        oidDate(d._id) ??
        new Date(this.a.fallbackAt);
      const updated =
        dateOf(
          [d.modified_time, d.updated_at].find(
            (v) => v !== undefined && v !== null && text(v) !== '',
          ),
        ) ?? created;
      const role: ORole = {
        key: keys[0]!,
        keys,
        deleted,
        kind: preset ? 'preset' : 'custom',
        preset,
        approver: Boolean(mapped && text(mapped.approvedBy) !== ''),
        allowAdmin,
        name,
        created: isoOf(created),
        updated: isoOf(updated),
        uuid: uuidv5(`${this.a.client}|roles|${keys[0]}`),
        grants: new Map(),
        reachable: new Set(),
      };
      if (!deleted && !preset) this.grants(d, role);
      this.rolePrimary.push(role);
      for (const k of keys) if (!this.roles.has(k)) this.roles.set(k, role);
    }
  }

  private grants(d: Doc, role: ORole): void {
    const list = Array.isArray(d.permission_config) ? d.permission_config : [];
    const STD = ['id', 'name', 'is_accessible', 'has_crud', 'create', 'read', 'update', 'delete'];
    // Waboo CRUD values: true / global_access = everything, restricted_access = own records, none / false / absent = nothing
    const waScope = (v: unknown): string | null => {
      if (v === true) return 'all';
      const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
      return s === 'global_access' || s === 'true' || s === 'all'
        ? 'all'
        : s === 'restricted_access' || s === 'own'
          ? 'own'
          : null;
    };
    const take = (ident: string, e: OEntry | undefined, keys: string[], over?: string): void => {
      if (!e || e.status !== 'REVIEWED' || text(e.reviewedBy) === '') return;
      for (const k of keys) {
        role.reachable.add(k);
        const def = this.a.defs.get(k);
        if (!def) continue;
        if (adminClass(k, def.category) && !role.allowAdmin) continue;
        if (def.planFeature && !this.a.featureOpen(def.planFeature)) continue;
        if (def.appSlug) continue;
        const scope = def.supportsScope ? (over ?? e.scope ?? 'all') : 'all';
        const have = role.grants.get(k);
        if (!have || WIDTH[scope]! > WIDTH[have]!) role.grants.set(k, scope);
      }
      void ident;
    };
    const entry = (id: string): OEntry | undefined =>
      id !== '' && Object.hasOwn(this.a.entries, id) ? this.a.entries[id] : undefined;
    for (const el of list) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
      const e = el as Doc;
      const id = text(e.id);
      const name = text(e.name);
      if (id !== '' || name !== '') {
        if (!truthy(e.is_accessible)) continue;
        const m = entry(id) ?? entry(name);
        if (truthy(e.has_crud)) {
          for (const x of ['create', 'read', 'update', 'delete'] as const) {
            const sc = waScope(e[x]);
            if (sc) take(id || name, m, m?.[x] ?? [], sc);
          }
        } else take(id || name, m, m?.use ?? []);
      } else {
        for (const [k, v] of Object.entries(e)) {
          if (STD.includes(k) || !truthy(v)) continue;
          take(k, entry(k), entry(k)?.use ?? []);
        }
      }
    }
  }

  // --- users ------------------------------------------------------------------------------------------------------------------------
  private buildUsers(): void {
    const emailOf = (d: Doc): string | null => {
      const raw = text(d.email) || (text(d.username).includes('@') ? text(d.username) : '');
      const e = raw.toLowerCase();
      return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
    };
    const active = (d: Doc): boolean => flag(d.is_active, true);
    const groups = new Map<string, Doc[]>();
    const ws = new Set<string>();
    for (const d of this.a.userDocs) {
      if (oracleDeleted(d) || hasBadText(d) || keysOf(d, ['user_id']).length === 0) continue;
      if (text(d.workspace_id)) ws.add(text(d.workspace_id));
      const e = emailOf(d);
      if (e) groups.set(e, [...(groups.get(e) ?? []), d]);
    }
    this.workspaceIds = ws.size;
    for (const [email, list] of groups) {
      const stamp = (d: Doc): number => dateOf(d.modified_time)?.getTime() ?? 0;
      const best = list.reduce((b, d) => {
        if (active(d) !== active(b)) return active(d) ? d : b;
        return stamp(d) > stamp(b) ? d : b;
      });
      const keys = keysOf(best, ['user_id']);
      const u = this.makeUser(best, keys, email, active(best));
      this.users.set(keys[0]!, u);
      for (const k of keys) this.userByKey.set(k, u);
    }
  }

  private makeUser(d: Doc, keys: string[], email: string, active: boolean): OUser {
    const joined = dateOf(d.date_joined);
    const createdDoc = dateOf(d.created_time);
    const stamps = [joined, createdDoc].filter((x): x is Date => x !== null);
    const created = stamps.length
      ? new Date(Math.min(...stamps.map((x) => x.getTime())))
      : (oidDate(d._id) ?? new Date(this.a.fallbackAt));
    const updated = dateOf(d.modified_time) ?? created;
    const names = [text(d.first_name), text(d.last_name)].filter((x) => x !== '');
    const verified = flag(d.is_email_verified, false);
    const rawPhone = text(d.phone);
    const phone = rawPhone ? oraclePhone(rawPhone, null, this.a.defaultCc) : null;

    // role: a string id that names a live role; anything else is Viewer
    let role: OUser['role'] = { kind: 'viewer' };
    const rk = typeof d.role_id === 'string' ? d.role_id.trim() : '';
    const r = rk ? this.roles.get(rk) : undefined;
    if (r && !r.deleted)
      role =
        r.kind === 'preset'
          ? { kind: 'preset', preset: r.preset!, role: r }
          : { kind: 'custom', role: r };

    const w: Record<string, unknown> = {
      sourceUserId: text(d.user_id) || keys[0],
      is_staff: flag(d.is_staff, false),
    };
    const has = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
    for (const k of ['business_id', 'module_id', 'gender', 'chat_limit'])
      if (has(d[k])) w[k] = plainJson(d[k]);
    if (has(d.group_id)) w.group_id = String(d.group_id);
    if (has(d.workspace_enabled)) w.workspace_enabled = flag(d.workspace_enabled, false);
    if (has(d.is_active)) w.is_active = flag(d.is_active, false);
    const lc: Record<string, unknown> = {};
    for (const k of [
      'contact_list_config',
      'marketing_list_config',
      'segment_contact_config',
      'deal_list_config',
      'company_list_config',
    ]) {
      const v = d[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const o = v as Doc;
      const keep: Record<string, unknown> = {};
      for (const f of ['column_sequence', 'columns']) if (has(o[f])) keep[f] = plainJson(o[f]);
      lc[k] = scrub(keep).value;
    }
    if (Object.keys(lc).length > 0) w.listConfigs = lc;

    return {
      key: keys[0]!,
      keys,
      uuid: uuidv5(`${this.a.client}|user|${keys[0]}`),
      adoptsOwner: this.a.ownerEmail !== null && email === this.a.ownerEmail,
      email,
      fullName: names.join(' ') || email.split('@')[0]!,
      status: active ? 'active' : 'inactive',
      settings: { legacy: { waboo: w } },
      created: isoOf(created),
      updated: isoOf(updated),
      invited: isoOf(created),
      joined: verified ? isoOf(joined ?? created) : null,
      phone,
      phoneVerified: phone && flag(d.is_phone_verified, false) ? isoOf(updated) : null,
      // written independently: a count from 1, capped at 1000 (the column's CHECK); empty, 0 or text means no limit
      chatLimit: (() => {
        const n = Number(typeof d.chat_limit === 'string' ? d.chat_limit.trim() : d.chat_limit);
        return typeof d.chat_limit !== 'boolean' && Number.isFinite(n) && n >= 1
          ? Math.min(1000, Math.trunc(n))
          : null;
      })(),
      emailVerified: verified ? isoOf(updated) : null,
      role,
    };
  }

  /** Waboo contact_owner (any key of a user) -> the user it must resolve to, or null. */
  ownerOf(value: unknown): OUser | null {
    const k = text(value);
    return k ? (this.userByKey.get(k) ?? null) : null;
  }
}

export interface OUser {
  key: string;
  keys: string[];
  uuid: string;
  adoptsOwner: boolean;
  email: string;
  fullName: string;
  status: string;
  settings: Record<string, unknown>;
  created: string;
  updated: string;
  invited: string;
  joined: string | null;
  phone: string | null;
  phoneVerified: string | null;
  chatLimit: number | null;
  emailVerified: string | null;
  role:
    | { kind: 'viewer' }
    | { kind: 'preset'; preset: string; role: ORole }
    | { kind: 'custom'; role: ORole };
}
