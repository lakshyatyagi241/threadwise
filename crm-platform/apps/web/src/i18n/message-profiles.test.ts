import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MESSAGE_PROFILES, pickMessages, profileFor } from './message-profiles';

const SRC = resolve(__dirname, '..');
const APP = join(SRC, 'app');
const pub = MESSAGE_PROFILES.find((p) => p.name === 'public')!;

/** The route groups and folders whose pages get the public profile; every other page keeps the whole catalogue. */
const PUBLIC_DIRS = [
  '(auth)',
  '(site)',
  '(developer-rest-api-v1-docs)',
  'b',
  'book',
  'docs',
  'f',
  'l',
  's',
  'trust',
  'u',
];
const FULL_DIRS = [
  '(app)',
  '(admin)',
  '(embedded)',
  '(gate)',
  '(operator-auth)',
  '(setup)',
  '(site-preview)',
  'i',
  'impersonate',
  'q',
];

describe('profileFor', () => {
  it('matches a public page, its sub-pages and its query, and nothing else', () => {
    for (const path of [
      '/login',
      '/login?next=%2Fcontacts',
      '/signup/verify-email',
      '/auth/social/google/callback',
      '/',
      '/?page=2',
      '/pricing',
      '/blog/some-post',
      '/developers/docs',
      '/book/acme/intro',
      '/f/some-form',
      '/s/shop/p/thing',
      '/u/token',
    ]) {
      expect(profileFor(path)?.name, path).toBe('public');
    }
    for (const path of [
      '/loginx',
      '/contacts',
      '/inbox',
      '/developers', // an app page, next to /developers/docs
      '/admin/login',
      '/legal/data-processing',
      '/legal/privacy',
      '/shopify',
      '/i/token',
      '/q/token',
      '/setup',
      '/onboarding',
      '/frontend-preview/home',
    ]) {
      expect(profileFor(path), path).toBeNull();
    }
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
        else if (a && ts.isTemplateExpression(a)) {
          let t = a.head.text;
          for (const span of a.templateSpans) {
            const known = ts.isIdentifier(span.expression)
              ? consts.get(span.expression.text)
              : undefined;
            if (known === undefined) break;
            t += known + span.literal.text;
          }
          t = t.replace(/\.$/, '');
          if (t) namespaces.add(t);
          else unreadable.push(where);
        } else if (a && ts.isIdentifier(a) && consts.has(a.text))
          namespaces.add(consts.get(a.text)!);
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

/** The URL a page or route file serves, with every [param] filled in. */
function urlOf(file: string): string {
  const rel = file.slice(APP.length + 1).replace(/(^|\/)(page|route)\.tsx?$/, '');
  const segs = rel.split('/').filter((x) => x && !/^\(.*\)$/.test(x));
  return `/${segs.map((x) => x.replace(/^\[.*\]$/, 'x')).join('/')}`;
}
const pagesUnder = (dir: string) =>
  [...sourcesUnder(join(APP, dir))].filter((f) => /(^|\/)(page|route)\.tsx?$/.test(f));

describe('the public profile covers the public pages', () => {
  const entries = [
    ...PUBLIC_DIRS.flatMap((d) => [...sourcesUnder(join(APP, d))]),
    join(APP, 'layout.tsx'),
    join(APP, 'providers.tsx'),
    join(APP, 'page.tsx'),
  ];
  const found = translationNamespaces(entries);

  it('every page of these groups, and the home page, is matched by the profile', () => {
    // /legal/<slug> shares its prefix with an app page (/legal/data-processing), so it keeps the whole catalogue
    const urls = [...PUBLIC_DIRS.flatMap((d) => pagesUnder(d).map(urlOf)), '/'].filter(
      (u) => !u.startsWith('/legal/'),
    );
    expect(urls.filter((u) => profileFor(u)?.name !== 'public')).toEqual([]);
  });

  it('no page of the other groups is matched (they keep the whole catalogue)', () => {
    const urls = FULL_DIRS.flatMap((d) => pagesUnder(d).map(urlOf));
    expect(urls.length).toBeGreaterThan(50);
    expect(urls.filter((u) => profileFor(u) !== null)).toEqual([]);
  });

  it('every page folder under app/ is in one of the two lists, so a new group has to be decided', () => {
    const folders = readdirSync(APP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'api')
      .map((e) => e.name);
    // folders that hold only route handlers (files, feeds, webhooks) or the widget have no client page of their own
    const handlers = [
      'webhooks',
      'widget',
      'widget-assets',
      'manifest.webmanifest',
      'robots.txt',
      'sitemap.xml',
      'team-inbox-manifest.webmanifest',
    ];
    expect(folders.filter((f) => ![...PUBLIC_DIRS, ...FULL_DIRS, ...handlers].includes(f))).toEqual(
      [],
    );
  });

  it('every namespace a component under these groups asks for is in the profile', () => {
    expect(found.namespaces.length).toBeGreaterThan(5); // the walk found the pages; an empty result would pass vacuously
    expect(found.namespaces.filter((ns) => !covered(ns, pub.namespaces))).toEqual([]);
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
    const missing = pub.namespaces.filter(
      (ns) =>
        ns.split('.').reduce<unknown>((o, k) => (o as Obj | undefined)?.[k], all) === undefined,
    );
    expect(missing).toEqual([]);
  });
});
