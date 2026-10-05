import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS, PLAN_STATES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const root = JSON.parse(
  readFileSync(join(WEB, 'messages/en/plans-subscriptions-trials.json'), 'utf8'),
) as Tree;
const tree = root['plans-subscriptions-trials'] as Tree;

const at = (path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], tree);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx$/.test(name) ? [p] : [];
  });
}

describe('plans messages', () => {
  it('names every limit, feature and state the screens look up by key', () => {
    for (const k of PLAN_LIMIT_KEYS) expect(at(`limits.${k}`), `limits.${k}`).toBeTypeOf('string');
    for (const k of PLAN_FEATURE_KEYS)
      expect(at(`features.${k}`), `features.${k}`).toBeTypeOf('string');
    for (const s of PLAN_STATES)
      expect(at(`operator.state.${s}`), `state.${s}`).toBeTypeOf('string');
  });

  it('has every literal key the components ask for', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components')).concat(
      sources(join(__dirname, 'operator')),
    )) {
      const src = readFileSync(file, 'utf8');
      const fileNs = /const NS = '([\w.-]+)'/.exec(src)?.[1] ?? '';
      const nsVars = new Map<string, string>();
      for (const m of src.matchAll(
        /const (\w+) = useTranslations\(\s*(?:`([^`]*)`|'([^']*)')\s*\)/g,
      )) {
        const raw = (m[2] ?? m[3] ?? '').replace('${NS}', fileNs);
        nsVars.set(m[1]!, raw.replace(/^plans-subscriptions-trials\.?/, ''));
      }
      for (const m of src.matchAll(/\b(t[a-z]?)\('([\w.]+)'/g)) {
        const base = nsVars.get(m[1]!);
        if (base === undefined) continue;
        const key = [base, m[2]].filter(Boolean).join('.');
        if (at(key) === undefined) missing.push(`${file.split('/').pop()}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every message is non-empty', () => {
    const walk = (n: Tree | string, p: string): string[] =>
      typeof n === 'string'
        ? n.trim()
          ? []
          : [p]
        : Object.entries(n).flatMap(([k, c]) => walk(c, `${p}.${k}`));
    expect(walk(tree, '')).toEqual([]);
  });
});
