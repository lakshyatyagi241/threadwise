import type { RoleResponse, UserResponse } from '@crm/contracts';

/** The five Reference presets, by the `systemKey` the API sends (the Owner row keeps the historical key `admin`). */
export type PresetSlug = 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';

const PRESET_BY_KEY: Record<string, PresetSlug> = {
  admin: 'owner',
  workspace_admin: 'admin',
  manager: 'manager',
  agent: 'agent',
  viewer: 'viewer',
};
const LADDER: readonly PresetSlug[] = ['owner', 'admin', 'manager', 'agent', 'viewer'];

export const presetSlug = (systemKey: string | null): PresetSlug | null =>
  systemKey ? (PRESET_BY_KEY[systemKey] ?? null) : null;

/** Presets in ladder order (Owner first), then custom roles by name. */
export function sortRoles<T extends Pick<RoleResponse, 'name' | 'systemKey'>>(
  roles: readonly T[],
): T[] {
  const rank = (r: T) => {
    const slug = presetSlug(r.systemKey);
    return slug ? LADDER.indexOf(slug) : LADDER.length;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export interface RoleFilterCounts {
  all: number;
  /** Members per role id (a member holding two roles counts once in each). */
  byRole: Map<string, number>;
}

export function roleFilterCounts(members: readonly UserResponse[]): RoleFilterCounts {
  const byRole = new Map<string, number>();
  for (const m of members) {
    for (const r of new Set(m.roles.map((x) => x.id))) byRole.set(r, (byRole.get(r) ?? 0) + 1);
  }
  return { all: members.length, byRole };
}

export interface MemberFilter {
  /** `null` = All. */
  roleId: string | null;
  search: string;
}

export function filterMembers(
  members: readonly UserResponse[],
  { roleId, search }: MemberFilter,
): UserResponse[] {
  const q = search.trim().toLowerCase();
  return members.filter(
    (m) =>
      (roleId === null || m.roles.some((r) => r.id === roleId)) &&
      (q === '' || m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
  );
}

/** Roles the caller may hand to a member: the server marks them, the picker never offers the rest. */
export const grantableRoles = <T extends Pick<RoleResponse, 'grantable'>>(
  roles: readonly T[],
): T[] => roles.filter((r) => r.grantable);

/**
 * Whether the caller may change this member's roles from the UI. The server stays the authority (it checks the
 * target's current roles too); the screen disables what it already knows will be refused: the caller's own row, and a
 * member who holds a role the caller cannot hand out (someone above them).
 */
export function canChangeMemberRoles(args: {
  isSelf: boolean;
  member: Pick<UserResponse, 'roles'>;
  roles: readonly Pick<RoleResponse, 'id' | 'grantable'>[];
  hasPermission: boolean;
}): boolean {
  if (!args.hasPermission || args.isSelf) return false;
  const grantable = new Set(args.roles.filter((r) => r.grantable).map((r) => r.id));
  return args.member.roles.every((r) => grantable.has(r.id));
}

/** True when `selected` (full replacement) differs from the member's current role ids. */
export function rolesChanged(
  current: readonly { id: string }[],
  selected: readonly string[],
): boolean {
  const a = new Set(current.map((r) => r.id));
  return a.size !== new Set(selected).size || selected.some((id) => !a.has(id));
}

/** A password the admin can hand over: 16 characters from four classes, so it satisfies a typical org policy. */
export function generatePassword(random: (n: number) => number = cryptoInt): string {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*-_=+',
  ];
  const all = sets.join('');
  const chars = sets.map((s) => s[random(s.length)]!);
  while (chars.length < 16) chars.push(all[random(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function cryptoInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % max;
}
