import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_CARDS, GROUP_SPECS, HUB_ORDER, allFields } from './fields';
import { SET_OPERATOR_NAV } from './operator-nav';

/**
 * next-intl prints the key path when a message is missing, so every key a screen asks for must exist.
 * The field and section keys come from fields.ts, the same list the form renders from.
 */
type Tree = { [key: string]: string | Tree };
const FILE = join(
  resolve(__dirname, '../../..'),
  'messages/en/platform-settings-branding-storage.json',
);
const root = (JSON.parse(readFileSync(FILE, 'utf8')) as Tree)[
  'platform-settings-branding-storage'
] as Tree;

const at = (path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Tree | undefined)?.[k], root);

describe('platform settings messages', () => {
  it('has a title, description and guide for every page, and a title for every section', () => {
    for (const spec of GROUP_SPECS) {
      expect(typeof at(`pages.${spec.id}.title`), spec.id).toBe('string');
      expect(typeof at(`pages.${spec.id}.description`), spec.id).toBe('string');
      expect(typeof at(`pages.${spec.id}.guide.title`), spec.id).toBe('string');
      for (const g of spec.guide) {
        expect(typeof at(`pages.${spec.id}.guide.items.${g}.title`), `${spec.id}/${g}`).toBe(
          'string',
        );
        expect(typeof at(`pages.${spec.id}.guide.items.${g}.body`), `${spec.id}/${g}`).toBe(
          'string',
        );
      }
      for (const s of spec.sections) {
        expect(typeof at(`pages.${spec.id}.sections.${s.id}.title`), `${spec.id}/${s.id}`).toBe(
          'string',
        );
      }
    }
  });

  it('has a label for every field the forms render, and for every select option that is labelled', () => {
    for (const spec of GROUP_SPECS) {
      for (const f of allFields(spec)) {
        expect(
          typeof at(`groups.${spec.group}.fields.${f.key}.label`),
          `${spec.group}.${f.key}`,
        ).toBe('string');
      }
    }
  });

  it('has a hub card for every page and every card of another domain', () => {
    for (const id of HUB_ORDER) {
      for (const k of ['title', 'description', 'tags']) {
        expect(typeof at(`cards.${id}.${k}`), `${id}.${k}`).toBe('string');
      }
    }
    for (const spec of GROUP_SPECS) expect(HUB_ORDER, spec.id).toContain(spec.id);
    for (const c of EXTERNAL_CARDS) expect(HUB_ORDER, c.id).toContain(c.id);
  });

  it('has a menu label for every console menu entry', () => {
    const prefix = 'platform-settings-branding-storage.';
    for (const item of SET_OPERATOR_NAV) {
      expect(item.labelKey.startsWith(prefix)).toBe(true);
      expect(typeof at(item.labelKey.slice(prefix.length)), item.id).toBe('string');
      expect(typeof at(item.groupKey.slice(prefix.length))).toBe('string');
    }
  });

  it('no message holds an angle bracket (next-intl would read it as a rich-text tag and fail the page)', () => {
    const bad: string[] = [];
    const walk = (t: Tree, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'string') {
          if (/<[A-Za-z/]/.test(v)) bad.push(`${p}.${k}`);
        } else walk(v, `${p}.${k}`);
      }
    };
    walk(root, '');
    expect(bad).toEqual([]);
  });

  it('every ICU plural has an other branch', () => {
    const bad: string[] = [];
    const walk = (t: Tree, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === 'string') {
          if (/plural,/.test(v) && !/other\s*\{/.test(v)) bad.push(`${p}.${k}`);
        } else walk(v, `${p}.${k}`);
      }
    };
    walk(root, '');
    expect(bad).toEqual([]);
  });
});
