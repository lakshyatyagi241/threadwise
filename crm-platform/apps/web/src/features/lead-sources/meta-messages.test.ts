import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FB_PAGE_STATUSES, META_LEAD_ACCESS, META_LEAD_SYNC_STATES } from '@crm/contracts';
import { LEAD_ERROR_KEYS } from './lib/errors';
import { META_FORM_STATUSES } from './lib/meta-view';

/**
 * The English text of the Meta lead forms panel. Every key a component asks for, and every key built from an enum or a code, must
 * exist (next-intl prints the key path when one is missing). The other languages are translated after the English is final; the
 * all-locale checks of `messages.test.ts` cover them from then on.
 */

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const ROOT = 'lead-sources';

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
const has = (key: string) => typeof en[`${ROOT}.${key}`] === 'string';

const META_COMPONENTS = readdirSync(join(__dirname, 'components')).filter(
  (f) => /^meta-.*\.tsx$/.test(f) && !/\.test\.tsx$/.test(f),
);

describe('Meta lead forms English messages', () => {
  it('describes every sync state, Page status, lead access and Meta form status', () => {
    const wanted = [
      ...META_LEAD_SYNC_STATES.flatMap((s) => [`meta.syncState.${s}`, `meta.page.stateHelp.${s}`]),
      ...FB_PAGE_STATUSES.map((s) => `meta.pageStatus.${s}`),
      ...META_LEAD_ACCESS.map((s) => `meta.leadAccess.${s}`),
      ...[...META_FORM_STATUSES, 'unknown'].map((s) => `meta.forms.formStatus.${s}`),
    ];
    expect(wanted.filter((k) => !has(k))).toEqual([]);
  });

  it('has the hints and problems the view models answer by name', () => {
    const wanted = [
      ...[
        'needManage',
        'needFacebook',
        'enableNeedsAccess',
        'enableNeedsReconnect',
        'pickNeedsSync',
        'pickNeedsAccess',
        'pickNeedsReconnect',
      ].map((k) => `meta.page.hints.${k}`),
      ...['duplicateTarget', 'propertyKey'].map((k) => `meta.mapping.problems.${k}`),
      ...LEAD_ERROR_KEYS.map((k) => `errors.${k}`),
    ];
    expect(wanted.filter((k) => !has(k))).toEqual([]);
  });

  it('has every literal key the Meta components ask for', () => {
    const missing: string[] = [];
    for (const file of META_COMPONENTS) {
      const src = readFileSync(join(__dirname, 'components', file), 'utf8');
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)) {
        bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), m[2]!]);
      }
      for (const [name, bases] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          if (!bases.some((b) => en[`${b}.${m[1]}`] !== undefined)) {
            missing.push(`${file}: ${name}('${m[1]}') in ${bases.join(' | ')}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('scans every Meta component (a rename must not silently empty the check)', () => {
    expect(META_COMPONENTS.length).toBeGreaterThanOrEqual(9);
  });

  it('keeps ICU placeholders sane: no literal brace pairs, no empty messages', () => {
    for (const [k, v] of Object.entries(en)) {
      if (!k.startsWith(`${ROOT}.meta.`)) continue;
      expect(v.trim(), k).not.toBe('');
      expect(v, k).not.toMatch(/\{\{/);
    }
  });

  it('never names the old product in copy or in the Meta components', () => {
    const banned = /wadesk|laravel/i;
    for (const [k, v] of Object.entries(en)) {
      if (k.startsWith(`${ROOT}.meta.`)) expect(v, k).not.toMatch(banned);
    }
    for (const file of META_COMPONENTS) {
      const src = readFileSync(join(__dirname, 'components', file), 'utf8');
      expect(src, file).not.toMatch(banned);
    }
  });
});
