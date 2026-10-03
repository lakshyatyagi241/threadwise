import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NAV_LAYOUT_KEYS,
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_EVENT_KEYS,
  QUICK_ACCESS_CATALOG,
} from '@crm/contracts';
import { SHORTCUT_PRESETS, TOOL_CATEGORIES } from './more/more-model';
import { TOUR_STEPS } from './tour/tour-model';

/**
 * The shell's strings live in messages/en/admin-console-shell.json. next-intl prints the key path when a key is missing, so
 * these checks make sure nothing the shell code asks for (literally, or by building the key from a list) is absent.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'admin-console-shell';

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

/** `t('key')` calls, paired with the namespace of the nearest earlier `useTranslations(...)` that bound that name. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']+)'|(NS)|`\$\{NS\}\.([\w.]+)`)\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2] ?? (m[3] ? '$NS' : `$NS.${m[4]}`), index: m.index ?? 0 }));
  const nsConst = /const NS = '([^']+)'/.exec(source)?.[1];
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner && (nsConst || !owner.ns.startsWith('$NS'))) {
        out.push(`${owner.ns.replace('$NS', nsConst ?? '')}.${c[1]}`);
      }
    }
  }
  return out.filter((k) => k.startsWith(`${ROOT}.`));
}

describe('admin-console-shell messages', () => {
  it('keeps every key under the domain root and every message non-empty', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('exist for every literal key the shell code asks for', () => {
    const files = [
      ...sourceFiles(join(WEB, 'src', 'features', ROOT)),
      ...sourceFiles(join(WEB, 'src', 'components', 'shell')),
    ];
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built from lists', () => {
    const dynamic = [
      ...QUICK_ACCESS_CATALOG.flatMap((c) => [
        `${ROOT}.quickAccess.catalog.${c.key}.label`,
        `${ROOT}.quickAccess.catalog.${c.key}.desc`,
      ]),
      ...TOOL_CATEGORIES.map((c) => `${ROOT}.more.tabs.${c}`),
      ...Object.keys(SHORTCUT_PRESETS).flatMap((id) => [
        `${ROOT}.more.shortcuts.presets.${id}.title`,
        `${ROOT}.more.shortcuts.presets.${id}.subtitle`,
      ]),
      ...TOUR_STEPS.flatMap((s) => [
        `${ROOT}.tour.steps.${s.id}.title`,
        `${ROOT}.tour.steps.${s.id}.body`,
      ]),
      ...NAV_LAYOUT_KEYS.map((k) => `${ROOT}.menuOrder.items.${k}`),
      ...NOTIFICATION_EVENT_KEYS.map((k) => `${ROOT}.workspaceSettings.notifications.events.${k}`),
      ...NOTIFICATION_CATEGORY_KEYS.map(
        (k) => `${ROOT}.workspaceSettings.notifications.categories.${k}`,
      ),
      ...['midnightOil', 'morning', 'afternoon', 'evening', 'night'].map(
        (k) => `${ROOT}.strip.greeting.${k}`,
      ),
      ...['page', 'account', 'plan', 'help', 'system'].map((k) => `${ROOT}.palette.tags.${k}`),
      ...['incomplete', 'unsafe'].map((k) => `${ROOT}.quickAccess.problem.${k}`),
      ...['contacts', 'conversations', 'messages'].flatMap((k) => [
        `${ROOT}.workspaceSettings.data.types.${k}`,
        `${ROOT}.workspaceSettings.data.count.${k}`,
      ]),
    ];
    expect(dynamic.filter((k) => !(k in en))).toEqual([]);
  });
});
