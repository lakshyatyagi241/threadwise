import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const msgRoot = join(root, '..', '..', '..', 'messages');
const load = (locale: string) =>
  (
    JSON.parse(readFileSync(join(msgRoot, locale, 'whatsapp-throughput.json'), 'utf8')) as Record<
      string,
      unknown
    >
  )['whatsapp-throughput'] as Record<string, unknown>;

const flat = (o: Record<string, unknown>, p = '', out: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flat(v as Record<string, unknown>, `${p}${k}.`, out);
    else out[`${p}${k}`] = String(v);
  }
  return out;
};
const args = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
        ? [readFileSync(join(dir, e.name), 'utf8')]
        : [],
  );

describe('whatsapp-throughput messages', () => {
  const en = flat(load('en'));

  it('has every literal key the components read', () => {
    const used = new Set<string>();
    for (const src of sources(root))
      for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) used.add(m[1] as string);
    expect(used.size).toBeGreaterThan(40);
    // A component may scope its translator to a section, so a key may sit under any prefix.
    const names = Object.keys(en);
    expect([...used].filter((k) => !names.some((n) => n === k || n.endsWith(`.${k}`)))).toEqual([]);
  });

  it('keeps the placeholders in other locales', () => {
    for (const locale of ['ar', 'de', 'ja']) {
      const other = flat(load(locale));
      for (const [k, v] of Object.entries(en))
        expect(args(other[k] ?? ''), `${locale}:${k}`).toEqual(args(v));
    }
  });
});
