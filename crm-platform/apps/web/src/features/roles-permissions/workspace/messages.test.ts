import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settings } from '../settings';
import { CAPABILITIES_UNKNOWN } from '../../_registry/resolve';
import { resolveSettings } from '../../_registry/settings-resolve';
import { PLANNED_SETTINGS } from '../../_registry/settings-planned';
import { SETTINGS } from '../../_registry/settings.generated';
import { NAV } from '../../_registry/nav.generated';

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
      ...['owner', 'admin', 'manager', 'agent', 'viewer'].flatMap((s) => [
        `${ROOT}.blurb.${s}`,
        `${ROOT}.team.filter.preset.${s}`,
      ]),
      ...['active', 'inactive'].map((s) => `${ROOT}.team.status.${s}`),
      ...['allow', 'deny'].map((e) => `${ROOT}.matrix.${e}`),
      ...['all', 'team_and_below', 'team', 'own'].flatMap((s) => [
        `${ROOT}.matrix.scope.${s}`,
        `${ROOT}.matrix.scopeHelp.${s}`,
      ]),
      `${ROOT}.matrix.permissionHelp.inbox_conversation_read_unassigned`,
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

describe('workspace settings tiles', () => {
  it('are picked up by the registry generator, and are not menu entries', () => {
    for (const item of settings) {
      expect(SETTINGS.some((n) => n.id === item.id)).toBe(true);
      expect(NAV.some((n) => n.href === item.href)).toBe(false);
    }
  });

  it('gate Team and Roles on their permissions and leave no planned tile beside them', () => {
    const none = resolveSettings(SETTINGS, {
      permissions: new Set(),
      planFeatures: null,
      channels: null,
    });
    expect(none.some((i) => i.href === '/settings/team' || i.href === '/settings/roles')).toBe(
      false,
    );
    const all = resolveSettings(
      SETTINGS,
      {
        permissions: new Set(['admin.user.manage', 'admin.role.manage']),
        planFeatures: null,
        channels: null,
      },
      { planned: PLANNED_SETTINGS },
    );
    const team = all.filter((i) => i.id === 'workspace-team');
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ href: '/settings/team', section: 'people', comingSoon: false });
    expect(all.filter((i) => i.id === 'roles')).toHaveLength(1);
    expect(all.find((i) => i.id === 'roles')).toMatchObject({
      href: '/settings/roles',
      comingSoon: false,
    });
    expect(resolveSettings(SETTINGS, CAPABILITIES_UNKNOWN).length).toBeGreaterThan(0);
  });
});
