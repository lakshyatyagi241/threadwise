import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { onLeaveOnSql } from '../../../src/common/workspace-calendar';
import { identifier, rawIdentifier } from '../../../src/common/sql/identifier';
import { hasGrantedConsentSql } from '../../../src/modules/contact-consent/consent-policy.service';

/**
 * A SQL helper that takes a table alias writes it into the SQL text (Drizzle cannot bind an identifier), so the alias must be a plain
 * name and anything else must be refused (QA task 30). Callers pass literals today; this is what stops one that passes request text.
 */
const render = (q: ReturnType<typeof onLeaveOnSql>) => new PgDialect().sqlToQuery(q);

const HOSTILE = [
  'u; DROP TABLE users',
  "u' OR '1'='1",
  'u--',
  'u/*x*/',
  'u.id',
  'u id',
  'u"',
  '"u"',
  '1u',
  '',
  ' ',
  'u\n',
  'u\u0000',
  'é',
  'a'.repeat(64),
];

describe('identifier', () => {
  it('accepts a plain name', () => {
    for (const ok of ['u', 'ct', 'm2', '_x', 'contacts', 'Alias_9', 'a'.repeat(63)]) {
      expect(identifier(ok)).toBe(ok);
    }
  });

  it.each(HOSTILE)('refuses %j', (bad) => {
    expect(() => identifier(bad)).toThrow(/Not a safe SQL identifier/);
  });

  it('refuses a value that is not a string at all', () => {
    for (const bad of [undefined, null, 1, {}, ['u']]) {
      expect(() => identifier(bad as unknown as string)).toThrow();
    }
  });

  it('rawIdentifier writes the validated name and nothing else', () => {
    expect(new PgDialect().sqlToQuery(rawIdentifier('ct')).sql).toBe('ct');
  });
});

describe('the helpers that take an alias', () => {
  it('onLeaveOnSql uses the alias for both columns', () => {
    const { sql, params } = render(onLeaveOnSql('u', '2026-10-17'));
    expect(sql).toContain('ml.org_id = u.org_id');
    expect(sql).toContain('ml.user_id = u.id');
    expect(params).toEqual(['2026-10-17', '2026-10-17']);
  });

  it.each(HOSTILE)('onLeaveOnSql refuses the alias %j', (bad) => {
    expect(() => onLeaveOnSql(bad, '2026-10-17')).toThrow(/Not a safe SQL identifier/);
  });

  it('hasGrantedConsentSql uses the alias', () => {
    const { sql } = new PgDialect().sqlToQuery(hasGrantedConsentSql('c'));
    expect(sql).toMatch(/\bc\./);
  });

  it.each(HOSTILE)('hasGrantedConsentSql refuses the alias %j', (bad) => {
    expect(() => hasGrantedConsentSql(bad)).toThrow(/Not a safe SQL identifier/);
  });
});
