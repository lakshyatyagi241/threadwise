import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nav } from './nav';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'addons-extension-registry.json'), 'utf8'),
) as Tree;

const has = (path: string): boolean => {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined;
};

describe('add-ons messages', () => {
  it('has every menu label and group the console and the workspace menu ask for', () => {
    const keys = [
      ...nav.map((n) => n.labelKey),
      ...OPERATOR_NAV.flatMap((n) => [n.labelKey, n.groupKey]).filter((k) =>
        k.startsWith('addons-extension-registry.'),
      ),
    ];
    for (const k of keys) expect(has(k), k).toBe(true);
  });

  it('has the keys the editor builds dynamically', () => {
    const dynamic = [
      ...['days', 'weeks', 'months', 'years'].flatMap((u) => [
        `addons-extension-registry.packs.editor.units.${u}`,
        `addons-extension-registry.packs.period.${u}`,
      ]),
      ...[
        'name',
        'amount',
        'offerAmount',
        'currency',
        'billingDuration',
        'sortOrder',
        'limits',
        'form',
      ].map((f) => `addons-extension-registry.packs.editor.problems.${f}`),
      ...['days', 'weeks', 'months', 'years'].map(
        (u) => `addons-extension-registry.workspace.units.${u}`,
      ),
      ...['instagram', 'email'].flatMap((e) =>
        [
          'title',
          'body',
          'modalTitle',
          'modalBody',
          'url',
          'disconnectTitle',
          'disconnectBody',
        ].map((k) => `addons-extension-registry.extensions.engines.${e}.${k}`),
      ),
    ];
    for (const k of dynamic) expect(has(k), k).toBe(true);
  });

  it('uses only keys that exist in the components', () => {
    const dir = join(__dirname, 'components');
    const src = ['packs-page', 'pack-form-page', 'extensions-page', 'workspace-addons-page', 'ui']
      .map((f) => readFileSync(join(dir, `${f}.tsx`), 'utf8'))
      .join('\n');
    const namespaces = [...src.matchAll(/(?:const NS = |useTranslations\()['`]([\w.-]+)['`]/g)].map(
      (m) => m[1]!,
    );
    expect(namespaces.length).toBeGreaterThan(0);
    for (const ns of new Set(namespaces)) expect(has(ns), ns).toBe(true);
  });
});
