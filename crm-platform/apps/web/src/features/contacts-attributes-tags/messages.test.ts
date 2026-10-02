import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_STATUSES, TITLES } from './lib/contact-model';
import { BUILT_IN_PROPERTIES, CREATABLE_TYPES } from './lib/property-model';
import { fieldTypeSchema } from '@crm/contracts';
import { IMPORT_FIELDS, IMPORT_REJECT_REASONS, SYSTEM_ATTRIBUTES } from '@crm/contracts';

/**
 * The domain's strings live in messages/<locale>/contacts-attributes-tags.json. These checks keep English and Arabic in
 * step and make sure no component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'contacts-attributes-tags.json';
const ROOT_KEY = 'contacts-attributes-tags';

type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, FILE), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** `{name}` and `{count, plural, ...}` placeholders, by variable name; rich-text tags too. */
const placeholders = (message: string) =>
  [
    ...new Set(
      [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`),
    ),
  ].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('contacts messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]?.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
    }
  });

  it('keeps every key under the domain root', () => {
    for (const key of Object.keys(en)) expect(key.startsWith(`${ROOT_KEY}.`), key).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')`, `t.rich('key')`, `t.has('key')`, paired with the namespace of the nearest preceding declaration. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }));
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

const DYNAMIC_PREFIXES = [
  'form.titles.',
  'import.reasons.',
  'attributes.system.',
  'properties.types.',
  'properties.typeHelp.',
  // the stage meaning radios: `modal.meaning.${m}` and `${m}Hint`
  'stages.modal.meaning.',
];

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'contacts-attributes-tags')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(contacts-attributes-tags)')),
  ];

  it('exist in the English messages', () => {
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

  it('exist for the keys built at run time', () => {
    const dynamic = [
      ...FALLBACK_STATUSES.map((s) => `form.statuses.${s}`),
      ...TITLES.map((s) => `form.titles.${s.toLowerCase()}`),
      ...(
        ['firstNameRequired', 'contactPointRequired', 'emailInvalid', 'phoneInvalid'] as const
      ).map((s) => `form.problems.${s}`),
      ...SYSTEM_ATTRIBUTES.map((s) => `attributes.system.${s.key}`),
      ...IMPORT_FIELDS.map((s) => `import.fields.${s}`),
      ...IMPORT_REJECT_REASONS.map((s) => `import.reasons.${s}`),
      ...(['required', 'format', 'tooLong', 'taken', 'reserved'] as const).map(
        (s) => `attributes.problem.key.${s}`,
      ),
      ...(['all', 'active', 'inactive', 'off'] as const).map((s) => `attributes.status.${s}`),
      ...(['name', 'key', 'default', 'description', 'status', 'actions'] as const).map(
        (s) => `attributes.col.${s}`,
      ),
      ...(['slash', 'enter', 'esc', 'token'] as const).flatMap((s) => [
        `attributes.quick.${s}.key`,
        `attributes.quick.${s}.text`,
      ]),
      ...(['templates', 'broadcasts', 'campaigns', 'flows'] as const).map(
        (s) => `attributes.where.${s}`,
      ),
      ...(['when', 'rules', 'naming'] as const).flatMap((s) => [
        `attributes.tips.${s}.title`,
        `attributes.tips.${s}.body`,
      ]),
      ...(['one', 'two', 'three'] as const).flatMap((s) => [
        `groups.help.${s}.title`,
        `groups.help.${s}.body`,
      ]),
      ...(
        [
          'network',
          'forbidden',
          'signedOut',
          'conflict',
          'keyTaken',
          'systemField',
          'validation',
          'unavailable',
          'rateLimited',
          'unexpected',
          'reservedKey',
          'attributeInUse',
          'nameTaken',
          'importFile',
          'tooLarge',
          'mergeScope',
        ] as const
      ).map((s) => `errors.${s}`),
      ...fieldTypeSchema.options.map((s) => `properties.types.${s}`),
      ...CREATABLE_TYPES.map((s) => `properties.typeHelp.${s}`),
      ...BUILT_IN_PROPERTIES.map((p) => `properties.builtin.${p.key}`),
      ...(['required', 'tooLong'] as const).map((s) => `properties.modal.problem.label.${s}`),
      ...(['required', 'format', 'tooLong', 'taken', 'reserved'] as const).map(
        (s) => `properties.modal.problem.key.${s}`,
      ),
      ...(['required', 'emptyLabel', 'duplicate'] as const).map(
        (s) => `properties.modal.problem.options.${s}`,
      ),
      ...(['name', 'key', 'type', 'required', 'visible', 'inUse', 'actions'] as const).map(
        (s) => `properties.col.${s}`,
      ),
      ...(['required', 'tooLong', 'taken'] as const).flatMap((s) => [
        `stages.modal.problem.${s}`,
        `properties.section.problem.${s}`,
      ]),
      ...(['required', 'number', 'integer', 'email', 'url'] as const).map(
        (s) => `form.fieldProblem.${s}`,
      ),
      ...(['stage', 'status'] as const).flatMap((k) =>
        (
          [
            'eyebrow',
            'addTitle',
            'namePlaceholder',
            'listLabel',
            'help',
            'add',
            'unconfiguredTitle',
            'unconfigured',
            'seed',
            'startFresh',
            'how.title',
            'how.body',
          ] as const
        ).map((s) => `stages.${k}.${s}`),
      ),
      'errors.statusInUse',
      'errors.dependencyCycle',
      'nav.stages',
      'nav.properties',
      'list.listView',
      'list.gridView',
      'nav.contacts',
      'nav.groups',
      'nav.attributes',
    ];
    const missing = dynamic.filter((k) => !(`${ROOT_KEY}.${k}` in en));
    expect(missing).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      // looked up by a value computed at run time (checked in the run-time test above)
      if (DYNAMIC_PREFIXES.some((p) => key.startsWith(`${ROOT_KEY}.${p}`))) return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
