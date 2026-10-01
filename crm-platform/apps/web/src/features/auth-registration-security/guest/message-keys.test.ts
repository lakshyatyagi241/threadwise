import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const ROOT = join(process.cwd(), 'src');
const GUEST_DIR = join(ROOT, 'features', 'auth-registration-security', 'guest');
const PAGES_DIR = join(ROOT, 'app', '(auth)');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'auth-registration-security.json'), 'utf8'),
) as Tree;

function lookup(path: string): string | Tree | undefined {
  let node: string | Tree | undefined = messages;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Every call `t('key')` / `t.rich('key')` / `t.has('key')`, paired with the namespace of the nearest preceding
 * `const t = useTranslations('ns')` / `await getTranslations('ns')` of the same name (components in one file reuse `t`).
 */
function usedKeys(source: string): Array<{ key: string; where: string }> {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }));
  const out: Array<{ key: string; where: string }> = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner) out.push({ key: `${owner.ns}.${c[1]}`, where: `${name}('${c[1]}')` });
    }
  }
  return out;
}

describe('message keys used in code', () => {
  const files = [...sourceFiles(GUEST_DIR), ...sourceFiles(PAGES_DIR)];

  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const { key, where } of usedKeys(readFileSync(file, 'utf8'))) {
        if (!key.startsWith('auth-registration-security.')) continue;
        checked += 1;
        if (lookup(key) === undefined)
          missing.push(`${file.replace(ROOT, '')}: ${where} -> ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('covers every error key the mapper can produce', () => {
    const source = readFileSync(join(GUEST_DIR, 'errors.ts'), 'utf8');
    const keys = new Set([...source.matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(10);
    const errors = lookup('auth-registration-security.guest.errors') as Tree;
    for (const key of keys) expect(errors[key], key).toBeTypeOf('string');
  });

  it('has a message for each validation field the forms look up', () => {
    const validation = lookup('auth-registration-security.guest.validation') as Tree;
    for (const key of [
      'orgSlug',
      'email',
      'password',
      'passwordRequired',
      'fullName',
      'orgName',
      'phone',
      'phoneRequired',
      'newPassword',
      'confirmPassword',
      'acceptTerms',
      'referralCode',
      'code',
    ]) {
      expect(validation[key], key).toBeTypeOf('string');
    }
  });
});
