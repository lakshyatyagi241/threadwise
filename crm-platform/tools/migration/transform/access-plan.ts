import {
  roleEntry,
  type AccessConfig,
  type PresetTarget,
  type RoleMapEntry,
} from '../access/config';
import type { KeyDef } from '../access/policy';
import { badText, bool, docKeys, docKeysWith, isDeleted, str, toDate, type Doc } from '../util';
import type { TargetRef } from './types';

/** Everything the roles and users handlers need besides the document: the reviewed maps, the target's catalogue, cross-document plans. */
export interface AccessCtx {
  client: string;
  config: AccessConfig;
  /** permission_defs of the target: key -> category, scope support, plan feature, app. */
  defs: Map<string, KeyDef>;
  /** Is the plan feature open for this organization (platform-owned, override, plan row; no plan row = open; unknown flag = closed). */
  featureOpen(feature: string): boolean;
  /** The preset roles of the organization by system_key (`admin` is the Owner role). */
  presets: Partial<Record<'admin' | PresetTarget, TargetRef>>;
  ownerEmail: string | null;
  /** Every key (_id and id) of every role document -> its plan. */
  roles: Map<string, RolePlan>;
  users: UserPlan;
}

export interface RolePlan {
  key: string;
  deleted: boolean;
  target: 'custom' | PresetTarget;
  entry?: RoleMapEntry;
  name: string;
  renamedFrom?: string;
  noName: boolean;
}

export interface UserPlan {
  /** Primary keys of the documents that own their email (the others are DUPLICATE_EMAIL). */
  winners: Set<string>;
  /** The winner whose email is the owner's: it adopts the existing owner row. */
  ownerDoc: string | null;
  /** How many distinct workspace_id values the live users carry. */
  workspaceIds: number;
}

const PRESET_NAMES = ['owner', 'admin', 'manager', 'agent', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The user's login email: `email`, else an email-like `username`; trimmed, lower-cased, validated. */
export function userEmail(doc: Doc): { email: string | null; present: boolean } {
  const raw = str(doc.email) ?? (str(doc.username)?.includes('@') ? str(doc.username) : null);
  if (!raw) return { email: null, present: false };
  const e = raw.toLowerCase();
  return { email: EMAIL.test(e) && e.length <= 254 ? e : null, present: true };
}

// workspace_enabled is NOT a disable switch: in geta_core.business_user it is false for 2,251 of the 2,882 active users
// (it marks the user's current workspace), so only is_active decides (confirmed against geta_core, OQ-7)
export const userActive = (doc: Doc): boolean => bool(doc.is_active, true);

export function buildRolePlan(
  client: string,
  docs: Doc[],
  cfg: AccessConfig,
): Map<string, RolePlan> {
  const out = new Map<string, RolePlan>();
  const used = new Set(PRESET_NAMES);
  for (const d of docs) {
    const keys = docKeys(d).map((k) => k.key);
    const key = keys[0];
    if (!key || badText(d)) continue;
    const entry = roleEntry(cfg, client, keys);
    const deleted = isDeleted(d);
    const target = entry && entry.to !== 'custom' ? (entry.to.slice(7) as PresetTarget) : 'custom';
    let name = str(d.label) ?? str(d.name);
    const noName = !name;
    let renamedFrom: string | undefined;
    if (!deleted && target === 'custom') {
      if (!name) name = `Waboo role ${key}`;
      let want = name;
      if (PRESET_NAMES.includes(want.toLowerCase())) want = `${name} (Waboo)`;
      let n = 2;
      while (used.has(want.toLowerCase())) want = `${name} (${n++})`;
      used.add(want.toLowerCase());
      if (want !== name) renamedFrom = name;
      name = want;
    }
    const plan: RolePlan = {
      key,
      deleted,
      target,
      entry,
      name: name ?? '',
      renamedFrom,
      noName,
    };
    for (const k of keys) if (!out.has(k)) out.set(k, plan);
  }
  return out;
}

export function buildUserPlan(docs: Doc[], ownerEmail: string | null): UserPlan {
  const byEmail = new Map<string, Doc[]>();
  const ws = new Set<string>();
  for (const d of docs) {
    if (isDeleted(d) || badText(d) || !docKeysWith(d, ['user_id'])[0]) continue;
    const w = str(d.workspace_id);
    if (w) ws.add(w);
    const { email } = userEmail(d);
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) ?? []), d]);
  }
  const winners = new Set<string>();
  let ownerDoc: string | null = null;
  for (const [email, list] of byEmail) {
    // active before inactive, then the newest modified_time, then file order
    let best = list[0]!;
    for (const d of list.slice(1)) {
      const a = Number(userActive(d)) - Number(userActive(best));
      const t =
        (toDate(d.modified_time)?.getTime() ?? 0) - (toDate(best.modified_time)?.getTime() ?? 0);
      if (a > 0 || (a === 0 && t > 0)) best = d;
    }
    const k = docKeys(best)[0]!.key;
    winners.add(k);
    if (ownerEmail && email === ownerEmail) ownerDoc = k;
  }
  return { winners, ownerDoc, workspaceIds: ws.size };
}
