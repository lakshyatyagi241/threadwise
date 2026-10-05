import { describe, expect, it } from 'vitest';
import { CONNECTOR_TYPES, validateMarketManifest, validateMarketRecipe } from '@crm/contracts';
import {
  checkDocs,
  docProblemsFromError,
  formatJsonText,
  isBlankRecipe,
  lineColumn,
  mergeProblems,
  parseJsonText,
  prettyJson,
  problemPath,
  serverDocProblems,
  withManifestVersion,
  type DocProblem,
} from './json-docs';
import {
  STARTER_TEMPLATES,
  recipeStarterFor,
  starterDocs,
  starterManifest,
  starterRecipe,
} from './starters';

const miniApp = () => starterDocs('mini_app');
const push = () => starterDocs('push');
const find = (problems: DocProblem[], doc: string, path: string) =>
  problems.find((p) => p.doc === doc && p.path === path);

describe('JSON text', () => {
  it('turns an offset into a 1-based line and column', () => {
    expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumn('ab\n', 99)).toEqual({ line: 2, column: 1 });
  });

  it('parses valid JSON', () => {
    expect(parseJsonText('{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
  });

  it('reports where a syntax error is: line and column of the offending character', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    const r = parseJsonText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(3);
      expect(r.column).toBe(3);
      expect(r.position).toBe(text.indexOf('"b"'));
    }
  });

  it('an unfinished document points at its end', () => {
    const text = '{"a": 1,\n';
    const r = parseJsonText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(2);
      expect(r.position).toBe(text.length);
    }
  });

  it('formats valid JSON and leaves anything else alone', () => {
    expect(formatJsonText('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(formatJsonText('{"a":')).toBeNull();
    expect(formatJsonText('   ')).toBeNull();
  });

  it('sets the manifest version without touching the rest', () => {
    const out = withManifestVersion('{"id":"x","version":"1.0.0"}', '1.0.1');
    expect(JSON.parse(out)).toEqual({ id: 'x', version: '1.0.1' });
    expect(withManifestVersion('nope', '1.0.1')).toBe('nope');
    expect(withManifestVersion('[1]', '1.0.1')).toBe('[1]');
  });

  it('treats a blank recipe and the literal null alike', () => {
    expect(isBlankRecipe('')).toBe(true);
    expect(isBlankRecipe('  \n')).toBe(true);
    expect(isBlankRecipe('null')).toBe(true);
    expect(isBlankRecipe('{}')).toBe(false);
  });
});

describe('manifest checks', () => {
  it('an empty manifest is an error at the document', () => {
    const c = checkDocs({ manifestText: '', recipeText: '' });
    expect(c.problems).toEqual([
      expect.objectContaining({ doc: 'manifest', path: '', severity: 'error', code: 'empty' }),
    ]);
    expect(c.canSave).toBe(false);
  });

  it('a syntax error carries its line and column and stops the schema checks', () => {
    const c = checkDocs({ manifestText: '{\n "id": "x"\n "name": 1}', recipeText: '' });
    expect(c.problems).toHaveLength(1);
    expect(c.problems[0]).toMatchObject({ doc: 'manifest', code: 'syntax', line: 3, column: 2 });
    expect(c.canSave).toBe(false);
  });

  it('lists every schema problem with its path (the contract validator, not a copy)', () => {
    const bad = { ...(starterManifest('mini_app') as object), scopes: ['nope'], name: 'x' };
    const c = checkDocs({ manifestText: prettyJson(bad), recipeText: '' });
    const expected = validateMarketManifest(bad);
    expect(expected.ok).toBe(false);
    const paths = c.problems.map((p) => p.path).sort();
    expect(paths).toEqual((expected.ok ? [] : expected.problems.map((p) => p.path)).sort());
    expect(find(c.problems, 'manifest', 'scopes.0')).toMatchObject({
      source: 'schema',
      severity: 'error',
    });
    expect(c.canSave).toBe(false);
    expect(c.manifest).toBeNull();
  });

  it('a valid mini app has no problem and can be saved; its permissions are listed in plain words', () => {
    const c = checkDocs({ manifestText: miniApp().manifestText, recipeText: '' });
    expect(c.problems).toEqual([]);
    expect(c.canSave).toBe(true);
    expect(c.manifest?.id).toBe('my-app');
    expect(c.kind).toBe('mini_app');
    expect(c.scopes.map((s) => s.id)).toEqual(['contacts.read']);
    expect(c.scopes[0]?.label).toBe('Read contacts');
  });

  it('lists known scopes once even when typed twice, and leaves unknown ones to the schema', () => {
    const m = {
      ...(starterManifest('mini_app') as object),
      scopes: ['contacts.read', 'contacts.read', 'zzz'],
    };
    const c = checkDocs({ manifestText: prettyJson(m), recipeText: '' });
    expect(c.scopes.map((s) => s.id)).toEqual(['contacts.read']);
    expect(c.problems.some((p) => p.path === 'scopes.2')).toBe(true);
  });
});

describe('recipe checks', () => {
  it('a valid integration with its recipe is clean for every starter template', () => {
    for (const t of STARTER_TEMPLATES.filter((x) => x !== 'mini_app')) {
      const d = starterDocs(t);
      const c = checkDocs({ manifestText: d.manifestText, recipeText: d.recipeText });
      expect(c.problems, t).toEqual([]);
      expect(c.canSave, t).toBe(true);
      expect(c.recipe?.connector.type, t).toBe(t);
    }
  });

  it('an integration without a recipe is a warning, not a block', () => {
    const c = checkDocs({ manifestText: push().manifestText, recipeText: '' });
    expect(c.problems).toEqual([
      expect.objectContaining({ doc: 'recipe', code: 'recipeMissing', severity: 'warning' }),
    ]);
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(1);
    expect(c.canSave).toBe(true);
  });

  it('a mini app with a recipe is an error', () => {
    const c = checkDocs({ manifestText: miniApp().manifestText, recipeText: push().recipeText });
    expect(find(c.problems, 'recipe', '')).toMatchObject({
      code: 'recipeNotAllowed',
      severity: 'error',
    });
    expect(c.canSave).toBe(false);
  });

  it('a recipe syntax error shows its position and the manifest is still checked', () => {
    const c = checkDocs({ manifestText: push().manifestText, recipeText: '{"a" 1}' });
    expect(find(c.problems, 'recipe', '')).toMatchObject({ code: 'syntax', line: 1 });
    expect(c.manifest).not.toBeNull();
    expect(c.canSave).toBe(false);
  });

  it('lists recipe schema problems with their paths (the contract validator)', () => {
    const recipe = { ...(starterRecipe('push') as object), rateLimits: { perMinute: 0 } };
    const expected = validateMarketRecipe(recipe);
    expect(expected.ok).toBe(false);
    const c = checkDocs({ manifestText: push().manifestText, recipeText: prettyJson(recipe) });
    expect(find(c.problems, 'recipe', 'rateLimits.perMinute')).toMatchObject({ source: 'schema' });
    expect(c.canSave).toBe(false);
  });

  it('the recipe key, category and connector type must equal the manifest id, category and connector type', () => {
    const recipe = {
      ...(starterRecipe('push') as Record<string, unknown>),
      key: 'other-app',
      category: 'payments',
      connector: {
        type: 'webhook_relay',
        auth: 'either',
      },
    };
    const c = checkDocs({ manifestText: push().manifestText, recipeText: prettyJson(recipe) });
    expect(find(c.problems, 'recipe', 'key')).toMatchObject({
      code: 'recipeKeyMismatch',
      values: { expected: 'my-app' },
    });
    expect(find(c.problems, 'recipe', 'category')).toMatchObject({
      code: 'recipeCategoryMismatch',
      values: { expected: 'lead-sources' },
    });
    expect(find(c.problems, 'recipe', 'connector.type')).toMatchObject({
      code: 'recipeConnectorMismatch',
      values: { expected: 'push' },
    });
    expect(c.canSave).toBe(false);
  });

  it('recipeStarterFor agrees with the manifest typed beside it', () => {
    const manifest = {
      ...(starterManifest('push', {
        slug: 'acme-leads',
        name: 'Acme Leads',
        category: 'lead-sources',
      }) as object),
    };
    const text = recipeStarterFor(prettyJson(manifest));
    const c = checkDocs({ manifestText: prettyJson(manifest), recipeText: text });
    expect(c.problems).toEqual([]);
    // No manifest yet: a webhook relay recipe with the placeholder names.
    expect(JSON.parse(recipeStarterFor('')).connector.type).toBe('webhook_relay');
  });

  it('every connector type has a starter that passes the recipe schema', () => {
    for (const type of CONNECTOR_TYPES) {
      const r = validateMarketRecipe(starterRecipe(type));
      expect(r.ok, type).toBe(true);
    }
  });
});

describe('checks against the listing', () => {
  const existing = { slug: 'my-app', kind: 'mini_app' as const };

  it('the id and the kind of an existing listing stay', () => {
    const m = { ...(starterManifest('mini_app') as object), id: 'renamed' };
    const c = checkDocs({ manifestText: prettyJson(m), recipeText: '', expect: existing });
    expect(find(c.problems, 'manifest', 'id')).toMatchObject({
      code: 'idChanged',
      values: { expected: 'my-app' },
    });
    const k = checkDocs({
      manifestText: push().manifestText,
      recipeText: push().recipeText,
      expect: existing,
    });
    expect(find(k.problems, 'manifest', 'kind')).toMatchObject({ code: 'kindChanged' });
  });

  it('a new version must be higher than the highest one', () => {
    const at = (version: string) =>
      checkDocs({
        manifestText: prettyJson({ ...(starterManifest('mini_app') as object), version }),
        recipeText: '',
        expect: { ...existing, newestVersion: '1.2.0' },
      });
    expect(find(at('1.2.0').problems, 'manifest', 'version')).toMatchObject({
      code: 'versionNotHigher',
      values: { newest: '1.2.0' },
    });
    expect(find(at('1.1.9').problems, 'manifest', 'version')?.code).toBe('versionNotHigher');
    expect(find(at('1.2.1').problems, 'manifest', 'version')).toBeUndefined();
    // A pre-release sorts before its release.
    expect(find(at('1.2.0-beta').problems, 'manifest', 'version')?.code).toBe('versionNotHigher');
  });

  it('an edited version may not take the number of another version', () => {
    const c = checkDocs({
      manifestText: miniApp().manifestText,
      recipeText: '',
      expect: { ...existing, takenVersions: ['1.0.0', '0.9.0'] },
    });
    expect(find(c.problems, 'manifest', 'version')).toMatchObject({
      code: 'versionTaken',
      values: { version: '1.0.0' },
    });
  });

  it('warns, without blocking, about a category that does not exist or is switched off', () => {
    const categories = [
      { kind: 'mini_app' as const, slug: 'utilities', isActive: true },
      { kind: 'mini_app' as const, slug: 'reporting', isActive: false },
    ];
    const ok = checkDocs({ manifestText: miniApp().manifestText, recipeText: '', categories });
    expect(ok.problems).toEqual([]);
    const off = checkDocs({
      manifestText: prettyJson({
        ...(starterManifest('mini_app') as object),
        category: 'reporting',
      }),
      recipeText: '',
      categories,
    });
    expect(find(off.problems, 'manifest', 'category')).toMatchObject({
      code: 'categoryUnknown',
      severity: 'warning',
    });
    expect(off.canSave).toBe(true);
    // The wrong kind's category is not a match: `utilities` is a mini app category.
    const wrongKind = checkDocs({
      manifestText: prettyJson({
        ...(starterManifest('push') as object),
        category: 'utilities',
      }),
      recipeText: '',
      categories,
    });
    expect(find(wrongKind.problems, 'manifest', 'category')?.code).toBe('categoryUnknown');
    // Categories that did not load: no warning either way.
    expect(
      checkDocs({ manifestText: miniApp().manifestText, recipeText: '', categories: null })
        .problems,
    ).toEqual([]);
  });
});

describe('the API answer merged in', () => {
  it('sends manifest and recipe paths to their editors and leaves form fields out', () => {
    const out = serverDocProblems([
      { target: 'manifest', path: 'scopes.0', message: 'Unknown scope "x".' },
      { target: 'recipe', path: 'connector', message: 'private address' },
      { target: 'field', path: 'tagline', message: 'Too short' },
    ]);
    expect(out.map((p) => `${p.doc}.${p.path}`)).toEqual(['manifest.scopes.0', 'recipe.connector']);
    expect(out.every((p) => p.severity === 'error' && p.source === 'server')).toBe(true);
    expect(out[1]?.message).toBe('private address');
  });

  it('turns the API machine words into translated problems', () => {
    const out = serverDocProblems([
      { target: 'manifest', path: 'category', message: 'unknown' },
      { target: 'manifest', path: 'version', message: 'higher_than:1.4.0' },
      { target: 'recipe', path: '', message: 'not_allowed' },
      { target: 'recipe', path: '', message: 'Required' },
    ]);
    expect(out.map((p) => p.code)).toEqual([
      'categoryRefused',
      'versionNotHigher',
      'recipeNotAllowed',
      'recipeRequired',
    ]);
    expect(out[1]?.values).toEqual({ newest: '1.4.0' });
  });

  it('a taken id becomes a problem on manifest.id', () => {
    const out = docProblemsFromError({ key: 'slugTaken', problems: [] });
    expect(out).toEqual([
      expect.objectContaining({ doc: 'manifest', path: 'id', code: 'slugTaken' }),
    ]);
    expect(docProblemsFromError({ key: 'manifestInvalid', problems: [] })).toEqual([]);
  });

  it('keeps the typed text problems and adds only the API problems the text did not already show', () => {
    const client = checkDocs({
      manifestText: prettyJson({ ...(starterManifest('mini_app') as object), scopes: ['nope'] }),
      recipeText: '',
    }).problems;
    const server = serverDocProblems([
      { target: 'manifest', path: 'scopes.0', message: 'Unknown scope "nope".' },
      { target: 'recipe', path: 'connector', message: 'private address' },
    ]);
    const merged = mergeProblems(client, server);
    expect(merged.filter((p) => p.doc === 'manifest' && p.path === 'scopes.0')).toHaveLength(1);
    expect(find(merged, 'recipe', 'connector')).toMatchObject({ source: 'server' });
    expect(merged).toHaveLength(client.length + 1);
  });

  it('prints a problem path with its document', () => {
    expect(problemPath({ doc: 'manifest', path: 'scopes.0' })).toBe('manifest.scopes.0');
    expect(problemPath({ doc: 'recipe', path: '' })).toBe('recipe');
  });
});
