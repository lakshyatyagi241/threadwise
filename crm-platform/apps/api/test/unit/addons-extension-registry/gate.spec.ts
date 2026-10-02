import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  ModuleGateGuard,
  RequiresModule,
} from '../../../src/modules/addons-extension-registry/module-gate';
import {
  grantBullets,
  titledKey,
} from '../../../src/modules/addons-extension-registry/addon-grants';
import { mergeModules } from '../../../src/modules/addons-extension-registry/module-registry.service';

@RequiresModule('reports')
class GatedController {}
class OpenController {}

const ctx = (cls: new () => object) =>
  ({ getHandler: () => () => undefined, getClass: () => cls }) as unknown as ExecutionContext;
const guard = (on: Record<string, boolean>) =>
  new ModuleGateGuard(new Reflector(), { isEnabled: async (s: string) => on[s] ?? false } as never);

describe('module gate (TW-ADD-011)', () => {
  it('serves a module route while the module is on and answers 404 the moment it is off', async () => {
    await expect(guard({ reports: true }).canActivate(ctx(GatedController))).resolves.toBe(true);
    await expect(guard({ reports: false }).canActivate(ctx(GatedController))).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });

  it('does not touch a route that belongs to no module', async () => {
    await expect(guard({}).canActivate(ctx(OpenController))).resolves.toBe(true);
  });
});

describe('one answer to "is this module on" (TW-ADD-007 QUIRK fixed, TW-ADD-009)', () => {
  const manifest = (slug: string) => ({ slug, name: slug }) as never;
  const disk = (slug: string, disabled: boolean) =>
    [slug, { manifest: manifest(slug), disabled }] as const;

  it('an uploaded module follows its row, an in-place one follows its marker', () => {
    const rows = [
      { slug: 'up_on', status: 'active', manifest: null },
      { slug: 'up_off', status: 'disabled', manifest: null },
    ] as never;
    const map = mergeModules(
      rows,
      new Map([
        disk('up_on', true),
        disk('up_off', false),
        disk('hand_on', false),
        disk('hand_off', true),
      ]) as never,
    );
    expect(map.get('up_on')).toMatchObject({ source: 'upload', enabled: true });
    expect(map.get('up_off')).toMatchObject({ source: 'upload', enabled: false });
    expect(map.get('hand_on')).toMatchObject({ source: 'inplace', enabled: true });
    expect(map.get('hand_off')).toMatchObject({ source: 'inplace', enabled: false });
  });
});

describe('grant bullets (TW-ADD-033)', () => {
  it('spells a core key out, prefers a module label, and keeps at most five', () => {
    expect(titledKey('remove_branding')).toBe('Remove branding');
    const b = grantBullets(
      {
        features: ['analytics', 'access_reports'],
        limits: { users: 2, tags: -1, a: 1, b: 1, c: 1 },
      },
      (k) => (k === 'access_reports' ? 'Reports' : titledKey(k)),
    );
    expect(b).toHaveLength(5);
    expect(b[1]).toEqual({
      kind: 'feature',
      key: 'access_reports',
      label: 'Reports',
      amount: null,
    });
    expect(b[2]).toEqual({ kind: 'limit_add', key: 'users', label: 'Users', amount: 2 });
  });
});
