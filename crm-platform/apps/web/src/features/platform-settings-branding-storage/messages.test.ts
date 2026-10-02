import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUP_SPECS, allFields } from './fields';
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
  it('has a title and description for every group and a title for every section', () => {
    for (const spec of GROUP_SPECS) {
      expect(typeof at(`groups.${spec.group}.title`), spec.group).toBe('string');
      expect(typeof at(`groups.${spec.group}.description`), spec.group).toBe('string');
      for (const s of spec.sections) {
        expect(
          typeof at(`groups.${spec.group}.sections.${s.id}.title`),
          `${spec.group}/${s.id}`,
        ).toBe('string');
      }
    }
  });

  it('has a label for every field the forms render', () => {
    for (const spec of GROUP_SPECS) {
      for (const f of allFields(spec)) {
        expect(
          typeof at(`groups.${spec.group}.fields.${f.key}.label`),
          `${spec.group}.${f.key}`,
        ).toBe('string');
      }
    }
  });

  it('has a menu label for every console menu entry', () => {
    const prefix = 'platform-settings-branding-storage.';
    for (const item of SET_OPERATOR_NAV) {
      expect(item.labelKey.startsWith(prefix)).toBe(true);
      expect(typeof at(item.labelKey.slice(prefix.length)), item.id).toBe('string');
      expect(typeof at(item.groupKey.slice(prefix.length))).toBe('string');
    }
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
