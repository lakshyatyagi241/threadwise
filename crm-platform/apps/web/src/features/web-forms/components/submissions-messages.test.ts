import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORM_SUBMISSION_REASONS, FORM_SUBMISSION_STATUSES } from '@crm/contracts';

type Tree = { [key: string]: string | Tree };

const root = join(__dirname, '..', '..', '..', '..', 'messages');
const load = (locale: string): Tree => {
  const file = JSON.parse(
    readFileSync(join(root, locale, 'web-forms.submissions.json'), 'utf8'),
  ) as Tree;
  return (file['web-forms'] as Tree)['submissions'] as Tree;
};

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

const en = load('en');
const ar = load('ar');

describe('web-forms.submissions messages', () => {
  it('has the same keys in English and Arabic', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('has no empty string and no copy-pasted English in Arabic', () => {
    for (const k of keys(ar)) {
      const get = (t: Tree) => k.split('.').reduce<string | Tree>((n, p) => (n as Tree)[p]!, t);
      expect(get(ar), k).not.toBe('');
      expect(get(ar), k).toMatch(/[؀-ۿ]|^\{|CSV/);
    }
  });

  it('covers every status and reason code the contract has', () => {
    const flat = new Set(keys(en));
    for (const s of FORM_SUBMISSION_STATUSES) expect(flat.has(`status.${s}`), s).toBe(true);
    for (const r of FORM_SUBMISSION_REASONS) {
      expect(flat.has(`reason.${r}.what`), r).toBe(true);
      expect(flat.has(`reason.${r}.todo`), r).toBe(true);
    }
    expect(flat.has('reason.unknown.what')).toBe(true);
  });

  it('has every key the component asks for', () => {
    const flat = new Set(keys(en));
    const src = readFileSync(join(__dirname, 'submissions-screen.tsx'), 'utf8');
    const literal = [...src.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(literal.length).toBeGreaterThan(40);
    for (const k of literal) expect(flat.has(k), k).toBe(true);
    // Keys built from a variable: the tab ids, the table columns and the retry toast keys.
    for (const k of ['tabs.all', 'tabs.needs_attention', 'tabs.spam'])
      expect(flat.has(k), k).toBe(true);
    for (const c of ['received', 'visitor', 'status', 'contact', 'company', 'version']) {
      expect(flat.has(`table.${c}`), c).toBe(true);
    }
    for (const k of ['toast.notRetryable', 'toast.purged', 'toast.retryFailed']) {
      expect(flat.has(k), k).toBe(true);
    }
  });
});
