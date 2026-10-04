import {
  MARKET_SCOPES,
  compareMarketVersions,
  marketScopeSummaries,
  validateMarketManifest,
  validateMarketRecipe,
  type MarketAppKind,
  type MarketManifest,
  type MarketOperatorCategory,
  type MarketRecipe,
  type MarketScopeSummary,
} from '@crm/contracts';
import type { ServerProblem } from './errors';

/**
 * The view-model of the two JSON editors (manifest v1 and the connector recipe): syntax first (with the line and column), then the
 * contract's own schemas, then the cross-checks the runbook lists (the recipe's key, category and connector type equal the manifest's
 * id, category and connector type) and the listing-level checks (the id stays, the version goes up). It is the same validation the
 * API runs, run on every keystroke so the operator is told before the call; the API's own answer is merged on top afterwards.
 */

export type DocName = 'manifest' | 'recipe';

/** Problems this module writes itself (translated by the screen); a contract or server problem carries its own `message` instead. */
export type DocProblemCode =
  | 'empty'
  | 'syntax'
  | 'recipeNotAllowed'
  | 'recipeMissing'
  | 'recipeKeyMismatch'
  | 'recipeCategoryMismatch'
  | 'recipeConnectorMismatch'
  | 'idChanged'
  | 'kindChanged'
  | 'versionNotHigher'
  | 'versionTaken'
  | 'categoryUnknown'
  | 'categoryRefused'
  | 'recipeRequired'
  | 'slugTaken';

export interface DocProblem {
  doc: DocName;
  /** The path inside the document (`scopes.0`); empty for the document as a whole. */
  path: string;
  severity: 'error' | 'warning';
  source: 'syntax' | 'schema' | 'cross' | 'listing' | 'catalogue' | 'server';
  /** Set on a problem this module writes; the screen translates it with `values`. */
  code?: DocProblemCode;
  values?: Record<string, string>;
  /** The contract's or the server's text, shown as it came. */
  message?: string;
  line?: number;
  column?: number;
}

// --- JSON text --------------------------------------------------------------------------------------------------------------------------

export type JsonParse =
  | { ok: true; value: unknown }
  | { ok: false; position: number | null; line: number | null; column: number | null };

/** 1-based line and column of a 0-based offset. */
export function lineColumn(text: string, position: number): { line: number; column: number } {
  const upTo = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = upTo.split('\n');
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}

/**
 * Parses JSON text. On a syntax error it reads the position out of the engine's message (V8 says `at position 13`, Firefox
 * `line 3 column 3`); an engine that gives none leaves line and column null, and the screen says only that the text is not valid JSON.
 */
export function parseJsonText(text: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const position = Number(pos[1]);
      return { ok: false, position, ...lineColumn(text, position) };
    }
    const lc = /line (\d+) column (\d+)/.exec(message);
    if (lc) return { ok: false, position: null, line: Number(lc[1]), column: Number(lc[2]) };
    if (/end of (?:JSON )?(?:input|data)/i.test(message)) {
      return { ok: false, position: text.length, ...lineColumn(text, text.length) };
    }
    return { ok: false, position: null, line: null, column: null };
  }
}

/** Pretty-prints a value the way the editors show it: two spaces, a final newline-free text. */
export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

/** The text re-indented, or null when it is not valid JSON (the Format button then leaves the text alone). */
export function formatJsonText(text: string): string | null {
  if (text.trim() === '') return null;
  const parsed = parseJsonText(text);
  return parsed.ok ? prettyJson(parsed.value) : null;
}

/** The text with the manifest's `version` replaced, or the text unchanged when it is not a JSON object. */
export function withManifestVersion(text: string, version: string): string {
  const parsed = parseJsonText(text);
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return text;
  if (Array.isArray(parsed.value)) return text;
  return prettyJson({ ...(parsed.value as Record<string, unknown>), version });
}

// --- the check --------------------------------------------------------------------------------------------------------------------------

export interface CheckInput {
  manifestText: string;
  recipeText: string;
  /** Editing an existing listing: the id and kind stay, the version goes up. */
  expect?: {
    slug?: string;
    kind?: MarketAppKind;
    /** A new version must be higher than this (the highest existing one). */
    newestVersion?: string | null;
    /** Editing a version: the other versions' numbers, which it may not repeat. */
    takenVersions?: readonly string[];
  };
  /** The operator's category list, to warn about a category that does not exist or is switched off. Omit when it did not load. */
  categories?: ReadonlyArray<Pick<MarketOperatorCategory, 'kind' | 'slug' | 'isActive'>> | null;
}

export interface DocsCheck {
  problems: DocProblem[];
  errors: number;
  warnings: number;
  /** The documents when they follow their schemas; null otherwise. */
  manifest: MarketManifest | null;
  recipe: MarketRecipe | null;
  /** `kind` of the manifest as typed (even when the rest is wrong), to decide whether a recipe belongs. */
  kind: MarketAppKind | null;
  /** The permissions the manifest asks for, in plain words (known scopes only). */
  scopes: MarketScopeSummary[];
  /** True when nothing blocks saving: no error (a warning does not block). */
  canSave: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function syntaxProblem(doc: DocName, parsed: Extract<JsonParse, { ok: false }>): DocProblem {
  return {
    doc,
    path: '',
    severity: 'error',
    source: 'syntax',
    code: 'syntax',
    ...(parsed.line !== null ? { line: parsed.line, column: parsed.column ?? undefined } : {}),
  };
}

/** The recipe text counts as absent when it is blank or the literal `null` (the API treats both the same). */
export const isBlankRecipe = (text: string): boolean => {
  const t = text.trim();
  return t === '' || t === 'null';
};

export function checkDocs(input: CheckInput): DocsCheck {
  const problems: DocProblem[] = [];
  let manifest: MarketManifest | null = null;
  let recipe: MarketRecipe | null = null;
  let rawManifest: unknown;
  let manifestParsed = false;

  // --- manifest ---
  if (input.manifestText.trim() === '') {
    problems.push({
      doc: 'manifest',
      path: '',
      severity: 'error',
      source: 'syntax',
      code: 'empty',
    });
  } else {
    const parsed = parseJsonText(input.manifestText);
    if (!parsed.ok) {
      problems.push(syntaxProblem('manifest', parsed));
    } else {
      manifestParsed = true;
      rawManifest = parsed.value;
      const checked = validateMarketManifest(parsed.value);
      if (checked.ok) manifest = checked.manifest;
      else
        for (const p of checked.problems)
          problems.push({
            doc: 'manifest',
            path: p.path,
            severity: 'error',
            source: 'schema',
            message: p.message,
          });
    }
  }

  const raw = isObject(rawManifest) ? rawManifest : null;
  const kindText = str(raw?.kind);
  const kind: MarketAppKind | null =
    kindText === 'mini_app' || kindText === 'integration' ? kindText : null;

  // --- listing-level checks on the manifest (only when its fields are strings) ---
  if (raw) {
    const id = str(raw.id);
    if (input.expect?.slug && id !== null && id !== input.expect.slug) {
      problems.push({
        doc: 'manifest',
        path: 'id',
        severity: 'error',
        source: 'listing',
        code: 'idChanged',
        values: { expected: input.expect.slug },
      });
    }
    if (input.expect?.kind && kind !== null && kind !== input.expect.kind) {
      problems.push({
        doc: 'manifest',
        path: 'kind',
        severity: 'error',
        source: 'listing',
        code: 'kindChanged',
        values: { expected: input.expect.kind },
      });
    }
    const version = str(raw.version);
    if (version !== null && /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9a-z.]{1,20})?$/.test(version)) {
      const newest = input.expect?.newestVersion;
      if (newest && compareMarketVersions(version, newest) <= 0) {
        problems.push({
          doc: 'manifest',
          path: 'version',
          severity: 'error',
          source: 'listing',
          code: 'versionNotHigher',
          values: { newest },
        });
      } else if (input.expect?.takenVersions?.includes(version)) {
        problems.push({
          doc: 'manifest',
          path: 'version',
          severity: 'error',
          source: 'listing',
          code: 'versionTaken',
          values: { version },
        });
      }
    }
    const category = str(raw.category);
    if (input.categories && category !== null && kind !== null) {
      const known = input.categories.some(
        (c) => c.kind === kind && c.slug === category && c.isActive,
      );
      if (!known) {
        problems.push({
          doc: 'manifest',
          path: 'category',
          severity: 'warning',
          source: 'catalogue',
          code: 'categoryUnknown',
          values: { category, kind },
        });
      }
    }
  }

  // --- recipe ---
  let rawRecipe: unknown;
  if (isBlankRecipe(input.recipeText)) {
    if (kind === 'integration') {
      problems.push({
        doc: 'recipe',
        path: '',
        severity: 'warning',
        source: 'cross',
        code: 'recipeMissing',
      });
    }
  } else {
    const parsed = parseJsonText(input.recipeText);
    if (!parsed.ok) {
      problems.push(syntaxProblem('recipe', parsed));
    } else {
      rawRecipe = parsed.value;
      if (kind === 'mini_app') {
        problems.push({
          doc: 'recipe',
          path: '',
          severity: 'error',
          source: 'cross',
          code: 'recipeNotAllowed',
        });
      } else {
        const checked = validateMarketRecipe(parsed.value);
        if (checked.ok) recipe = checked.recipe;
        else
          for (const p of checked.problems)
            problems.push({
              doc: 'recipe',
              path: p.path,
              severity: 'error',
              source: 'schema',
              message: p.message,
            });
      }
    }
  }

  // --- the documents must agree (read from what was typed, so a mismatch shows even while another field is wrong) ---
  const rr = isObject(rawRecipe) ? rawRecipe : null;
  if (raw && rr && kind === 'integration') {
    const id = str(raw.id);
    const key = str(rr.key);
    if (id !== null && key !== null && key !== id) {
      problems.push({
        doc: 'recipe',
        path: 'key',
        severity: 'error',
        source: 'cross',
        code: 'recipeKeyMismatch',
        values: { expected: id },
      });
    }
    const category = str(raw.category);
    const recipeCategory = str(rr.category);
    if (category !== null && recipeCategory !== null && recipeCategory !== category) {
      problems.push({
        doc: 'recipe',
        path: 'category',
        severity: 'error',
        source: 'cross',
        code: 'recipeCategoryMismatch',
        values: { expected: category },
      });
    }
    const manifestConnector = isObject(raw.connector) ? str(raw.connector.type) : null;
    const recipeConnector = isObject(rr.connector) ? str(rr.connector.type) : null;
    if (recipeConnector !== null && manifestConnector !== recipeConnector) {
      problems.push({
        doc: 'recipe',
        path: 'connector.type',
        severity: 'error',
        source: 'cross',
        code: 'recipeConnectorMismatch',
        values: { expected: manifestConnector ?? '' },
      });
    }
  }

  const known = new Set<string>(MARKET_SCOPES.map((s) => s.id));
  const askedScopes =
    raw && Array.isArray(raw.scopes)
      ? raw.scopes.filter((s): s is string => typeof s === 'string' && known.has(s))
      : [];
  const errors = problems.filter((p) => p.severity === 'error').length;
  return {
    problems,
    errors,
    warnings: problems.length - errors,
    manifest,
    recipe,
    kind,
    scopes: marketScopeSummaries([...new Set(askedScopes)]),
    canSave: manifestParsed && errors === 0,
  };
}

// --- the API's answer merged in ------------------------------------------------------------------------------------------------------

/**
 * The API's problems for the two documents, as editor problems. A machine word the API writes (`unknown`, `not_allowed`,
 * `higher_than:1.0.0`) becomes a sentence in the operator's language; any other text is the contract's, shown as it came.
 */
export function serverDocProblems(problems: readonly ServerProblem[]): DocProblem[] {
  return problems.flatMap((p): DocProblem[] => {
    if (p.target === 'field') return [];
    const base = {
      doc: p.target,
      path: p.path,
      severity: 'error' as const,
      source: 'server' as const,
    };
    if (p.target === 'manifest' && p.path === 'category' && p.message === 'unknown')
      return [{ ...base, code: 'categoryRefused' }];
    if (p.target === 'manifest' && p.path === 'version' && p.message.startsWith('higher_than:'))
      return [
        {
          ...base,
          code: 'versionNotHigher',
          values: { newest: p.message.slice('higher_than:'.length) },
        },
      ];
    if (p.target === 'recipe' && p.path === '' && p.message === 'not_allowed')
      return [{ ...base, code: 'recipeNotAllowed' }];
    if (p.target === 'recipe' && p.path === '' && p.message === 'Required')
      return [{ ...base, code: 'recipeRequired' }];
    return [{ ...base, message: p.message }];
  });
}

/** The editor problems an API failure stands for (its per-path list, plus the id taken by another listing). */
export function docProblemsFromError(error: {
  key: string;
  problems: readonly ServerProblem[];
}): DocProblem[] {
  const out = serverDocProblems(error.problems);
  if (error.key === 'slugTaken')
    out.push({
      doc: 'manifest',
      path: 'id',
      severity: 'error',
      source: 'server',
      code: 'slugTaken',
    });
  return out;
}

/** What the page lists: the typed text's problems plus the API's, a server problem the client already found left out. */
export function mergeProblems(
  client: readonly DocProblem[],
  server: readonly DocProblem[],
): DocProblem[] {
  // A server problem at a path the client already flagged is the same finding in other words: keep the client's.
  const clientPaths = new Set(client.map((p) => `${p.doc}|${p.path}`));
  return [...client, ...server.filter((p) => !clientPaths.has(`${p.doc}|${p.path}`))];
}

/** `manifest.scopes.0` as the list prints it; `manifest` for the whole document. */
export const problemPath = (p: Pick<DocProblem, 'doc' | 'path'>): string =>
  p.path ? `${p.doc}.${p.path}` : p.doc;
