import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_KINDS } from './lib/errors';
import { COLUMN_IDS } from './lib/sticky';
import { STATUSES, TABS } from './lib/status';
import { KINDS } from './lib/kinds';
import { NOTE_TEMPLATES, TERMS_TEMPLATES } from './lib/templates';
import { SALES_DOC_EVENT_TYPES } from '@crm/contracts';

/**
 * The domain's strings live in messages/<locale>/sales-docs.json. These checks keep English and Arabic in step and make sure no
 * component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'sales-docs.json';
const ROOT_KEY = 'sales-docs';

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

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('sales-docs messages', () => {
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

  it('Arabic plurals spell out the categories the language needs', () => {
    for (const [key, text] of Object.entries(ar)) {
      if (!text.includes('plural,')) continue;
      for (const cat of ['one', 'two', 'few', 'many', 'other']) {
        expect(text, `${key} lacks ${cat}`).toContain(`${cat} {`);
      }
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

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'sales-docs')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(sales-docs)')),
    ...sourceFiles(join(WEB, 'src', 'app', 'q')),
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
      ...TABS.map((s) => `tabs.${s}`),
      ...TABS.map((s) => `list.statusWord.${s}`),
      ...STATUSES.map((s) => `status.${s}`),
      ...KINDS.flatMap((k) => [
        `kind.${k}.singular`,
        `kind.${k}.plural`,
        `list.${k}.title`,
        `list.${k}.subtitle`,
        `list.${k}.new`,
        `list.${k}.emptyTitle`,
        `list.${k}.emptyMessage`,
        `builder.back.${k}`,
        `builder.newTitle.${k}`,
        `builder.details.titlePlaceholder.${k}`,
        `linked.kind.${k}`,
      ]),
      ...ERROR_KINDS.map((s) => `errors.${s}`),
      ...COLUMN_IDS.map((s) => `table.columns.${s}`),
      ...SALES_DOC_EVENT_TYPES.map((s) => `activity.events.${s}`),
      ...(['link', 'email', 'whatsapp'] as const).map((s) => `activity.channels.${s}`),
      ...(['link', 'email', 'whatsapp'] as const).map((s) => `send.tabs.${s}`),
      ...(['sent', 'queued', 'shared'] as const).map((s) => `toast.delivery.${s}`),
      ...(
        [
          'markSent',
          'accept',
          'decline',
          'extend',
          'revise',
          'convertInvoice',
          'convertDeal',
          'delete',
        ] as const
      ).flatMap((s) => [`confirm.${s}.title`, `confirm.${s}.message`, `confirm.${s}.confirm`]),
      ...(
        [
          'open',
          'edit',
          'send',
          'copyLink',
          'markSent',
          'accept',
          'decline',
          'revise',
          'extend',
          'convertInvoice',
          'convertDeal',
          'duplicate',
          'print',
          'activity',
          'delete',
        ] as const
      ).map((s) => `actions.${s}`),
      ...(
        [
          'noItems',
          'tooLarge',
          'descriptionRequired',
          'descriptionTooLong',
          'qtyInvalid',
          'priceInvalid',
          'discountInvalid',
          'taxInvalid',
          'docDiscountInvalid',
          'docTaxInvalid',
          'emailInvalid',
          'phoneInvalid',
          'titleTooLong',
          'notesTooLong',
          'termsTooLong',
          'dateInvalid',
        ] as const
      ).map((s) => `builder.problems.${s}`),
      ...NOTE_TEMPLATES.flatMap((s) => [`templates.notes.${s}.label`, `templates.notes.${s}.text`]),
      ...TERMS_TEMPLATES.flatMap((s) => [
        `templates.terms.${s}.label`,
        `templates.terms.${s}.text`,
      ]),
      ...(['edit', 'preview'] as const).map((s) => `builder.pane.${s}`),
      ...(
        [
          'next',
          'prev',
          'open',
          'toggleSelect',
          'newDoc',
          'focusSearch',
          'clearSelection',
          'help',
          'save',
          'send',
          'addRow',
        ] as const
      ).map((s) => `shortcuts.actions.${s}`),
      ...(['expired', 'closed', 'gone', 'rateLimited', 'validation', 'generic'] as const).map(
        (s) => `public.decision.problem.${s}`,
      ),
      'nav.proposals',
      'nav.estimates',
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
      // the activity events follow the contract's list of event types (checked by the run-time test above)
      if (key.startsWith(`${ROOT_KEY}.activity.events.`)) return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
