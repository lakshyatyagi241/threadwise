import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_SLUGS } from '@crm/contracts';
import {
  LEGAL_TEMPLATES,
  legalTemplate,
} from '../../../src/modules/marketing-site-cms/legal-templates';

const CMS_DIR = resolve(__dirname, '../../../src/modules/marketing-site-cms');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('privileged access', () => {
  it('only cms-store.ts calls `.privileged(` (the one door to the platform content tables)', () => {
    const offenders = files(CMS_DIR)
      .filter((f) =>
        /\.privileged\(/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
      )
      .map((f) => relative(CMS_DIR, f).replace(/\\/g, '/'));
    expect(offenders).toEqual(['cms-store.ts']);
  });

  it('never opens a raw tenant-less handle for writes: every INSERT/UPDATE/DELETE on a content table is in a store transaction', () => {
    // The two sanctioned exceptions are the visitor's own writes: the contact INSERT (insert-only policy) and the
    // view counter function. Everything else must run inside `store.tx`.
    const writes = files(CMS_DIR)
      .filter((f) => !f.endsWith('cms-store.ts'))
      .flatMap((f) => {
        const src = readFileSync(f, 'utf8');
        return [
          ...src.matchAll(/this\.db\.primary\.execute\(\s*sql`\s*(INSERT|UPDATE|DELETE)\s/gi),
        ].map(() => relative(CMS_DIR, f).replace(/\\/g, '/'));
      });
    expect(writes).toEqual(['contact.service.ts']);
  });

  it('sql.raw is only ever given constant column lists', () => {
    for (const f of files(CMS_DIR)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/sql\.raw\(([\s\S]*?)\);/g)) {
        expect(m[1], `${f}`).not.toContain('${');
      }
    }
  });
});

describe('legal templates (TW-CMS-036)', () => {
  it('there is exactly one template per canonical slug, with sort 1 to 5', () => {
    expect(LEGAL_TEMPLATES.map((t) => t.slug)).toEqual([...LEGAL_SLUGS]);
    expect(LEGAL_TEMPLATES.map((t) => t.sort)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sections are numbered 01, 02, ... and every template says it needs review', () => {
    for (const slug of LEGAL_SLUGS) {
      const t = legalTemplate(slug, 'Acme');
      expect(t.sections.map((s) => s.n)).toEqual(
        t.sections.map((_, i) => String(i + 1).padStart(2, '0')),
      );
      expect(t.subtitle).toMatch(/reviewed by counsel/i);
      expect(t.sections.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('fills the brand in and escapes it, leaving no placeholder behind', () => {
    const t = legalTemplate('terms', 'A<b>&Co');
    const all = JSON.stringify(t);
    expect(all).not.toContain('{{brand}}');
    expect(all).not.toContain('<b>&Co');
    expect(all).toContain('A&#60;b&#62;&#38;Co');
  });
});
