import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };
const root = join(process.cwd(), 'messages');
const read = (locale: string, file: string): Tree =>
  existsSync(join(root, locale, `${file}.json`))
    ? (JSON.parse(readFileSync(join(root, locale, `${file}.json`), 'utf8')) as Tree)
    : {};
const at = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], tree);
const leaves = (n: Tree | string, p: string): string[] =>
  typeof n === 'string'
    ? [p]
    : Object.entries(n).flatMap(([k, c]) => leaves(c, p ? `${p}.${k}` : k));

/** Every string the unofficial-WhatsApp switch added, by message file and path: present in English AND Arabic. */
const KEYS: Array<[file: string, path: string]> = [
  ['shell', 'shell.appGate.unofficialTitle'],
  ['shell', 'shell.appGate.unofficialBody'],
  ['broadcasts', 'broadcasts.list.unofficialDisabled'],
  ['broadcasts', 'broadcasts.detail.unofficialDisabled'],
  ['broadcasts', 'broadcasts.compose.unofficialDisabled'],
  ['campaigns', 'campaigns.builder.unofficialDisabled'],
  ['scheduled-queue-warmer', 'scheduled-queue-warmer.errors.WA_UNOFFICIAL_DISABLED'],
  ['dashboards-analytics-charts', 'dashboards-analytics-charts.dashboard.sublineOfficial'],
  ['admin-console-shell', 'admin-console-shell.nav.badges.notSupported'],
  ['whatsapp-providers', 'whatsapp-providers.list.officialLabel'],
  [
    'auth-registration-security.platform',
    'auth-registration-security.platform.plans.editor.limitsUi.unofficialOff',
  ],
];

describe('unofficial WhatsApp messages', () => {
  it.each(KEYS)('%s: %s is translated', (file, path) => {
    for (const locale of ['en', 'ar']) {
      expect(at(read(locale, file), path), `${locale}/${file}`).toBeTypeOf('string');
    }
  });

  it('the Node bridge switch card has every string in Arabic that it has in English', () => {
    const en = read('en', 'node-bridge-runtime');
    const ar = read('ar', 'node-bridge-runtime');
    const keys = leaves(at(en, 'node-bridge-runtime.unofficial') as Tree, '');
    expect(keys.length).toBeGreaterThan(20);
    const missing = keys.filter(
      (k) => typeof at(ar, `node-bridge-runtime.unofficial.${k}`) !== 'string',
    );
    expect(missing).toEqual([]);
  });

  it('the plan and usage hints no longer call devices "QR devices"', () => {
    for (const locale of ['en', 'ar']) {
      const t = read(locale, 'plans-subscriptions-trials');
      expect(String(at(t, 'plans-subscriptions-trials.limitHints.devices'))).not.toMatch(/QR/);
    }
    const p = read('en', 'auth-registration-security.platform');
    expect(
      String(at(p, 'auth-registration-security.platform.plans.editor.limitHints.devices')),
    ).not.toMatch(/QR/);
  });
});
