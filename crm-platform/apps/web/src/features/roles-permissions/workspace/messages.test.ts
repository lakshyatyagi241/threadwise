import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nav } from '../nav';
import { resolveNav } from '../../_registry/resolve';
import { NAV } from '../../_registry/nav.generated';
import { PLANNED_NAV } from '../../_registry/planned';

const WEB = resolve(__dirname, '../../../..');
const ROOT = 'roles-permissions-workspace';

type Tree = { [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const en = flatten(
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', `${ROOT}.json`), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` calls, paired with the namespace of the nearest preceding `useTranslations`/`getTranslations`. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']+)'|(NS))\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2] ?? '$NS', index: m.index ?? 0 }));
  const nsConst = /const NS = '([^']+)'/.exec(source)?.[1];
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner && (nsConst || owner.ns !== '$NS'))
        out.push(`${owner.ns === '$NS' ? nsConst : owner.ns}.${c[1]}`);
    }
  }
  return out;
}

describe('roles-permissions-workspace messages', () => {
  it('keeps every key under the namespace, non-empty, with no dotted key', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('exist for every literal key the code asks for', () => {
    const files = [
      ...sourceFiles(join(WEB, 'src', 'features', 'roles-permissions', 'workspace')),
      ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(roles-permissions)')),
    ];
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const dynamic = [
      ...nav.map((n) => n.labelKey),
      ...['owner', 'admin', 'manager', 'agent', 'viewer'].flatMap((s) => [
        `${ROOT}.blurb.${s}`,
        `${ROOT}.team.filter.preset.${s}`,
      ]),
      ...['active', 'inactive'].map((s) => `${ROOT}.team.status.${s}`),
      ...['allow', 'deny'].map((e) => `${ROOT}.matrix.${e}`),
      ...['all', 'team', 'own'].map((s) => `${ROOT}.matrix.scope.${s}`),
      ...[
        'unexpected',
        'request',
        'validation',
        'validationField',
        'forbidden',
        'conflict',
        'grantRole',
        'grantPermission',
        'selfRoleChange',
        'lastOwner',
        'selfDeactivate',
        'presetRole',
        'roleInUse',
        'nameTaken',
        'notFound',
      ].map((k) => `${ROOT}.errors.${k}`),
    ];
    expect(dynamic.filter((k) => !(k in en))).toEqual([]);
  });
});

describe('workspace nav', () => {
  it('is picked up by the registry generator', () => {
    for (const item of nav) expect(NAV.some((n) => n.id === item.id)).toBe(true);
  });

  it('gates Team members and Roles on their permissions and leaves the planned inbox entry alone', () => {
    const none = resolveNav(NAV, { permissions: new Set(), planFeatures: null, channels: null });
    expect(none.some((i) => i.href === '/settings/team' || i.href === '/settings/roles')).toBe(
      false,
    );
    const all = resolveNav(
      NAV,
      {
        permissions: new Set(['admin.user.manage', 'admin.role.manage']),
        planFeatures: null,
        channels: null,
      },
      { planned: PLANNED_NAV },
    );
    const team = all.filter((i) => i.id === 'workspace-team');
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ href: '/settings/team', group: 'settings', comingSoon: false });
    expect(all.find((i) => i.href === '/settings/roles')?.group).toBe('settings');
  });
});
