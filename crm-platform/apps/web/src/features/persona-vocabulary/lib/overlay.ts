import { WORKSPACE_VOCAB_NOUNS } from '@crm/contracts';
import { BOUND_PREFIXES } from './bindings';
import {
  buildPlan,
  localizeText,
  placeholdersIntact,
  safeOverrides,
  type NounDefaults,
  type NounOverrides,
} from './localize';

/**
 * The message overlay of "dynamic object naming" (BL-310; docs/specs/persona-profiles.md, 7.4). `withVocabulary` takes the messages of the
 * request and the words the workspace uses for the person's language, and returns the messages with the bound strings rewritten. The
 * (app) layout hands the result to its `NextIntlClientProvider`, so every client component sees the workspace's words without a single
 * change to a component or a message.
 *
 * The golden rule: no words, no change. When the workspace named nothing (the `generic` persona, no overrides, an unknown view, a
 * language it did not name) the function returns the very SAME object it was given, so the product shows exactly today's strings.
 */

export type Tree = { [key: string]: string | Tree };

const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The product's own words for the four nouns in this language, from the message slice `persona-vocabulary.defaults`. */
export function readDefaults(messages: Tree): NounDefaults | null {
  const slice = messages['persona-vocabulary'];
  const defaults = isTree(slice) ? slice['defaults'] : undefined;
  if (!isTree(defaults)) return null;
  const out = {} as NounDefaults;
  for (const noun of WORKSPACE_VOCAB_NOUNS) {
    const f = defaults[noun];
    if (!isTree(f) || typeof f['one'] !== 'string' || typeof f['other'] !== 'string') return null;
    out[noun] = { one: f['one'], other: f['other'] };
  }
  return out;
}

function nodeAt(messages: Tree, path: readonly string[]): string | Tree | undefined {
  let cur: string | Tree | undefined = messages;
  for (const part of path) {
    if (!isTree(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setIn(root: Tree, path: readonly string[], value: string): void {
  let cur = root;
  for (const part of path.slice(0, -1)) {
    const next = cur[part];
    if (isTree(next)) cur = next;
    else {
      const created: Tree = {};
      cur[part] = created;
      cur = created;
    }
  }
  cur[path[path.length - 1]!] = value;
}

/** Every string leaf under `node`, with its key path. */
function* leaves(node: string | Tree, path: string[]): Generator<[string[], string]> {
  if (typeof node === 'string') {
    yield [path, node];
    return;
  }
  for (const [key, child] of Object.entries(node)) yield* leaves(child, [...path, key]);
}

/** The strings of the bound surfaces that change for these words, as a sparse tree. `null` = nothing changes. */
export function buildOverlay(
  messages: Tree,
  locale: string,
  overrides: NounOverrides,
): Tree | null {
  if (Object.keys(overrides).length === 0) return null;
  const plan = buildPlan(locale, readDefaults(messages), overrides);
  if (!plan) return null;
  const overlay: Tree = {};
  let changed = 0;
  for (const prefix of BOUND_PREFIXES) {
    const path = prefix.split('.');
    const node = nodeAt(messages, path);
    if (node === undefined) continue;
    for (const [leafPath, text] of leaves(node, path)) {
      const next = localizeText(text, plan);
      // A rewrite that would change the arguments or the tags of a message is dropped: the sentence keeps the product's wording.
      if (next !== text && placeholdersIntact(text, next)) {
        setIn(overlay, leafPath, next);
        changed += 1;
      }
    }
  }
  return changed > 0 ? overlay : null;
}

/** `base` with `overlay` laid over it. Only the branches the overlay touches are copied; the rest is shared. */
export function mergeOverlay(base: Tree, overlay: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, over] of Object.entries(overlay)) {
    const current = base[key];
    out[key] = typeof over === 'string' ? over : mergeOverlay(isTree(current) ? current : {}, over);
  }
  return out;
}

const memo = new Map<string, Tree | null>();
const MEMO_MAX = 64;

/**
 * The messages the signed-in person sees. `nouns` is `session.org.persona.nouns[locale]` (anything else is ignored, never trusted: each
 * word is checked against the same rule the API enforces before it goes near a message). In production the overlay of one set of words is
 * computed once and reused; messages do not change while a server runs.
 */
export function withVocabulary(messages: Tree, locale: string, nouns: unknown): Tree {
  const overrides = safeOverrides(nouns);
  if (Object.keys(overrides).length === 0) return messages;
  const key = `${locale}|${JSON.stringify(overrides)}`;
  let overlay: Tree | null | undefined =
    process.env.NODE_ENV === 'production' ? memo.get(key) : undefined;
  if (overlay === undefined) {
    overlay = buildOverlay(messages, locale, overrides);
    if (process.env.NODE_ENV === 'production') {
      if (memo.size >= MEMO_MAX) memo.clear();
      memo.set(key, overlay);
    }
  }
  return overlay ? mergeOverlay(messages, overlay) : messages;
}
