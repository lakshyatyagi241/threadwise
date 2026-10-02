import { allFields, type GroupSpec } from '../fields';

/** What the form holds while it is being edited: strings and booleans, plus secrets typed in this session. */
export interface Draft {
  fields: Record<string, string | boolean>;
  /** Plaintext typed into a secret box. Blank means "keep what is stored". */
  secrets: Record<string, string>;
  /** "Remove the stored value" ticked for a secret. */
  clear: Record<string, boolean>;
}

export type Problem = 'required' | 'integer';

const get = (values: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], values);

export function toDraft(values: Record<string, unknown>, spec: GroupSpec): Draft {
  const fields: Draft['fields'] = {};
  for (const f of allFields(spec)) {
    if (f.kind === 'secret') continue;
    const v = get(values, f.key);
    fields[f.key] = f.kind === 'toggle' ? v === true : v == null ? '' : String(v);
  }
  return { fields, secrets: {}, clear: {} };
}

export interface BuiltPatch {
  values: Record<string, unknown>;
  secrets: Record<string, string | null>;
  problems: Record<string, Problem>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PATCH body for what changed. A nested object (`logos`, `colors`) is sent whole when any of its members
 * changed, because the API replaces a top-level field as a unit. Numbers that do not parse are reported
 * instead of sent, so the person is told which box to fix.
 */
export function buildPatch(
  original: Record<string, unknown>,
  draft: Draft,
  spec: GroupSpec,
): BuiltPatch {
  const values: Record<string, unknown> = {};
  const problems: Record<string, Problem> = {};
  const secrets: Record<string, string | null> = {};

  const read = (key: string, kind: string): unknown => {
    const raw = draft.fields[key];
    if (kind === 'toggle') return raw === true;
    if (kind === 'number') {
      const s = String(raw).trim();
      if (s === '') {
        problems[key] = 'required';
        return undefined;
      }
      const n = Number(s);
      if (!Number.isInteger(n)) {
        problems[key] = 'integer';
        return undefined;
      }
      return n;
    }
    return String(raw ?? '');
  };

  const nested = new Map<string, Array<{ sub: string; key: string; kind: string }>>();
  for (const f of allFields(spec)) {
    if (f.kind === 'secret') {
      const typed = draft.secrets[f.key] ?? '';
      if (draft.clear[f.key]) secrets[f.key] = null;
      else if (typed !== '') secrets[f.key] = typed;
      continue;
    }
    const dot = f.key.indexOf('.');
    if (dot > 0) {
      const top = f.key.slice(0, dot);
      const list = nested.get(top) ?? [];
      list.push({ sub: f.key.slice(dot + 1), key: f.key, kind: f.kind });
      nested.set(top, list);
      continue;
    }
    const next = read(f.key, f.kind);
    if (next !== undefined && !same(next, original[f.key])) values[f.key] = next;
  }
  for (const [top, members] of nested) {
    const obj: Record<string, unknown> = {};
    let changed = false;
    for (const m of members) {
      const next = read(m.key, m.kind);
      obj[m.sub] = next;
      if (!same(next, get(original, m.key))) changed = true;
    }
    if (changed) values[top] = obj;
  }
  return { values, secrets, problems };
}

export const patchSize = (p: BuiltPatch): number =>
  Object.keys(p.values).length + Object.keys(p.secrets).length;

/** Maps an API error path (`values.logos.paper`, `secrets.password`) to the form control it belongs to. */
export function fieldForPath(path: string, spec: GroupSpec): string | null {
  const key = path.replace(/^(values|secrets)\./, '');
  const keys = allFields(spec).map((f) => f.key);
  if (keys.includes(key)) return key;
  // An error on the object itself (`logos`) lands on its first member.
  return keys.find((k) => k.startsWith(`${key}.`)) ?? null;
}
