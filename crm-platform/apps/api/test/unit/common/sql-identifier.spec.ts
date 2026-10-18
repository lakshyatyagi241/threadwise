import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { onLeaveOnSql } from '../../../src/common/workspace-calendar';
import { identifier, rawIdentifier, rawMappedColumn } from '../../../src/common/sql/identifier';
import { hasGrantedConsentSql } from '../../../src/modules/contact-consent/consent-policy.service';
import { channelOwnerSql, channelRowOwnerSql } from '../../../src/realtime/audience/channel-owner';
import { visibleToSql } from '../../../src/modules/team-inbox-conversations/visibility-sql';

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

describe('the inbox and realtime helpers that take an alias', () => {
  const viewer = { userId: 1, scope: 'all', teamIds: [] } as never;

  it('channelOwnerSql and channelRowOwnerSql use the alias', () => {
    expect(new PgDialect().sqlToQuery(channelOwnerSql('conv')).sql).toContain('conv.');
    expect(new PgDialect().sqlToQuery(channelRowOwnerSql('chan')).sql).toContain('chan.');
    // the defaults still work
    expect(new PgDialect().sqlToQuery(channelOwnerSql()).sql).toContain('c.');
    expect(new PgDialect().sqlToQuery(channelRowOwnerSql()).sql).toContain('ch.');
  });

  it.each(HOSTILE)('channelOwnerSql refuses the alias %j', (bad) => {
    expect(() => channelOwnerSql(bad)).toThrow(/Not a safe SQL identifier/);
  });

  it.each(HOSTILE)('channelRowOwnerSql refuses the alias %j', (bad) => {
    expect(() => channelRowOwnerSql(bad)).toThrow(/Not a safe SQL identifier/);
  });

  it.each(HOSTILE)('visibleToSql refuses the alias %j before it looks at the viewer', (bad) => {
    expect(() => visibleToSql(viewer, bad)).toThrow(/Not a safe SQL identifier/);
  });

  it('visibleToSql still accepts the aliases its callers use', () => {
    expect(() => visibleToSql(viewer)).not.toThrow();
    expect(() => visibleToSql(viewer, 'c')).not.toThrow();
  });
});

describe('rawMappedColumn: a patch key may only name a column the map holds', () => {
  const COLUMNS = { taxLabel: 'tax_label', autoSend: 'auto_send' } as const;
  const render = (key: string) => new PgDialect().sqlToQuery(rawMappedColumn(COLUMNS, key)).sql;

  it('writes the column the map gives for a key it holds', () => {
    expect(render('taxLabel')).toBe('tax_label');
    expect(render('autoSend')).toBe('auto_send');
  });

  it.each(['nope', '', 'tax_label', 'TAXLABEL', 'taxLabel; DROP TABLE x', 'a.b'])(
    'refuses the unknown key %j',
    (key) => {
      expect(() => rawMappedColumn(COLUMNS, key)).toThrow(/Not an updatable column/);
    },
  );

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'refuses the prototype property %j that a plain lookup would find',
    (key) => {
      expect(() => rawMappedColumn(COLUMNS, key)).toThrow(/Not an updatable column/);
    },
  );

  it('validates the column name the map itself gives', () => {
    expect(() => rawMappedColumn({ bad: 'x; DROP TABLE y' }, 'bad')).toThrow(
      /Not a safe SQL identifier/,
    );
    expect(() => rawMappedColumn({ bad: 'a.b' }, 'bad')).toThrow(/Not a safe SQL identifier/);
  });
});
