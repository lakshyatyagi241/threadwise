import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MESSAGE_PROFILES, pickMessages, profileFor } from './message-profiles';

const SRC = resolve(__dirname, '..');
const APP = join(SRC, 'app');
const guest = MESSAGE_PROFILES.find((p) => p.name === 'guest')!;

describe('profileFor', () => {
  it('matches a guest page, its sub-pages and its query, and nothing else', () => {
    expect(profileFor('/login')?.name).toBe('guest');
    expect(profileFor('/login?next=%2Fcontacts')?.name).toBe('guest');
    expect(profileFor('/signup/verify-email')?.name).toBe('guest');
    expect(profileFor('/auth/social/google/callback')?.name).toBe('guest');
    expect(profileFor('/loginx')).toBeNull();
    expect(profileFor('/contacts')).toBeNull();
    expect(profileFor('/f/some-form')).toBeNull();
    expect(profileFor('/')).toBeNull();
    expect(profileFor(null)).toBeNull();
  });
});

describe('pickMessages', () => {
  const all = {
    common: { ok: 'OK' },
    a: { b: { c: 'C', d: 'D' }, e: 'E' },
    big: { x: 'X' },
  };

  it('keeps the named subtrees and drops the rest', () => {
    expect(pickMessages(all, ['common', 'a.b'])).toEqual({
      common: { ok: 'OK' },
      a: { b: { c: 'C', d: 'D' } },
    });
  });

  it('merges two namespaces under one parent and skips one that does not exist', () => {
    expect(pickMessages(all, ['a.b.c', 'a.e', 'nope.here'])).toEqual({
      a: { b: { c: 'C' }, e: 'E' },
    });
  });

  it('does not change its input', () => {
    const copy = JSON.parse(JSON.stringify(all)) as typeof all;
    pickMessages(all, ['a.b']);
    expect(all).toEqual(copy);
  });
});

// --- the profile must cover what the pages' client components ask for --------------------------------------------------------

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  return (
    [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
      isFile,
    ) ?? null
  );
}

function* sourcesUnder(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sourcesUnder(p);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) yield p;
  }
}

/** The namespaces `useTranslations` is given in the entry files and everything they import; a namespace it cannot read is returned apart. */
function translationNamespaces(entries: string[]) {
  const seen = new Set<string>();
  const namespaces = new Set<string>();
  const unreadable: string[] = [];
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const consts = new Map<string, string>();
    const collect = (n: ts.Node): void => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        ts.isStringLiteralLike(n.initializer)
      ) {
        consts.set(n.name.text, n.initializer.text);
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
    const visit = (n: ts.Node): void => {
      if (
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        !(ts.isImportDeclaration(n) && n.importClause?.isTypeOnly)
      ) {
        const r = resolveImport(file, n.moduleSpecifier.text);
        if (r) stack.push(r);
      }
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'useTranslations'
      ) {
        const a = n.arguments[0];
        const where = `${file.slice(SRC.length + 1)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
        if (a && ts.isStringLiteralLike(a)) namespaces.add(a.text);
        else if (a && ts.isTemplateExpression(a)) namespaces.add(a.head.text.replace(/\.$/, ''));
        else if (a && ts.isIdentifier(a) && consts.has(a.text)) namespaces.add(consts.get(a.text)!);
        else unreadable.push(where);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { namespaces: [...namespaces].sort(), unreadable };
}

const covered = (ns: string, list: readonly string[]) =>
  list.some((p) => ns === p || ns.startsWith(`${p}.`));

describe('the guest profile covers the guest pages', () => {
  const entries = [
    ...sourcesUnder(join(APP, '(auth)')),
    join(APP, 'layout.tsx'),
    join(APP, 'providers.tsx'),
  ];
  const found = translationNamespaces(entries);

  it('every page folder of the group is listed as a path', () => {
    const folders = readdirSync(join(APP, '(auth)'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `/${e.name}`);
    expect(folders.filter((f) => !guest.paths.includes(f))).toEqual([]);
  });

  it('every namespace a component under the group asks for is in the profile', () => {
    expect(found.namespaces.length).toBeGreaterThan(5); // the walk found the pages; an empty result would pass vacuously
    expect(found.namespaces.filter((ns) => !covered(ns, guest.namespaces))).toEqual([]);
  });

  it('every namespace is one the code can name (a computed one would escape this check)', () => {
    expect(found.unreadable).toEqual([]);
  });

  it('every namespace in the profile exists in the English catalogue', () => {
    const dir = join(SRC, '..', 'messages', 'en');
    type Obj = Record<string, unknown>;
    const merge = (a: Obj, b: Obj): Obj => {
      for (const [k, v] of Object.entries(b)) {
        const cur = a[k];
        a[k] =
          typeof v === 'object' && v && typeof cur === 'object' && cur
            ? merge(cur as Obj, v as Obj)
            : v;
      }
      return a;
    };
    let all: Obj = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      all = merge(all, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Obj);
    }
    const missing = guest.namespaces.filter(
      (ns) =>
        ns.split('.').reduce<unknown>((o, k) => (o as Obj | undefined)?.[k], all) === undefined,
    );
    expect(missing).toEqual([]);
  });
});
