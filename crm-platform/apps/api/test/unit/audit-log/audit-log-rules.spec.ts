import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import {
  actorKindOf,
  buildWhere,
  csvCell,
  csvLine,
  decodePosition,
  encodePosition,
  likeEscape,
  resolveWindow,
} from '../../../src/modules/audit-log/audit-log.rules';
import { AuditLogService } from '../../../src/modules/audit-log/audit-log.service';
import type { AuditRow } from '../../../src/modules/audit-log/audit-log.repository';

const dialect = new PgDialect();
const NOW = new Date('2026-10-13T10:00:00.000Z');
const window = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-10-13T00:00:00.000Z'),
};

describe('the time window', () => {
  it('defaults to the last 30 days, a minute past now', () => {
    const w = resolveWindow({}, NOW);
    expect(w.to.toISOString()).toBe('2026-10-13T10:01:00.000Z');
    expect(w.from.toISOString()).toBe('2026-09-13T10:01:00.000Z');
  });
  it('keeps what was asked', () => {
    const w = resolveWindow(
      { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      NOW,
    );
    expect(w.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
  it('refuses an end before the start and a window past 400 days (422)', () => {
    for (const f of [
      { from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
      { from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
    ]) {
      try {
        resolveWindow(f, NOW);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).getStatus()).toBe(422);
      }
    }
  });
});

describe('positions (cursor and entry id)', () => {
  const pos = { atText: '2026-10-13T09:59:58.123456Z', id: 4242 };
  it('round-trips with microseconds', () =>
    expect(decodePosition(encodePosition(pos))).toEqual(pos));
  it('refuses anything else', () => {
    for (const bad of [
      '',
      'abc',
      Buffer.from('x|1').toString('base64url'),
      Buffer.from('2026-10-13T09:59:58.123456Z|0').toString('base64url'),
      Buffer.from('2026-10-13T09:59:58.123456Z|1|2').toString('base64url'),
      Buffer.from("2026-10-13T09:59:58.123456Z'; drop table audit_log;--|1").toString('base64url'),
    ]) {
      expect(decodePosition(bad)).toBeNull();
    }
  });
});

describe('the filter builder', () => {
  const q = (
    f: Parameters<typeof buildWhere>[0],
    extra: Partial<Parameters<typeof buildWhere>[1]> = {},
  ) => dialect.sqlToQuery(buildWhere(f, { orgId: 7, window, ...extra }));

  it('always names the workspace and a time range', () => {
    const { sql, params } = q({});
    expect(sql).toContain('a.org_id = $1');
    expect(sql).toContain('a.at >= $2::timestamptz');
    expect(sql).toContain('a.at < $3::timestamptz');
    expect(params[0]).toBe(7);
  });
  it('filters by module, action, record, request and actor', () => {
    const { sql, params } = q(
      {
        module: 'contacts',
        action: 'update',
        recordId: 9,
        requestId: 'req-1',
        actorType: 'api_key',
      },
      { actorDbId: 3 },
    );
    expect(sql).toContain('a.module = ');
    expect(sql).toContain('a.action = ');
    expect(sql).toContain('a.record_id = ');
    expect(sql).toContain('a.request_id = ');
    expect(sql).toContain("a.actor_type = 'user' AND a.actor_id = ");
    expect(params).toEqual(
      expect.arrayContaining(['contacts', 'update', 9, 'req-1', 3, 'api_key']),
    );
  });
  it('"other" is everything that is not a named actor kind', () => {
    expect(q({ actorType: 'other' }).sql).toContain('NOT IN');
  });
  it('text search is module and action only, with literal wildcards, and never the delta', () => {
    const { sql, params } = q({ q: '50%_off' });
    expect(sql).toContain('a.module ILIKE');
    expect(sql).toContain('a.action ILIKE');
    expect(sql).not.toMatch(/delta::text|delta\s*(?:ILIKE|LIKE)/i);
    expect(params).toContain('%50\\%\\_off%');
  });
  it('the act-as filter looks for the stamp', () => {
    expect(q({ actAs: true }).sql).toContain("jsonb_exists(a.delta, '_impersonatedBy')");
    expect(q({ actAs: false }).sql).not.toContain('_impersonatedBy');
  });
  it('the cursor is a keyset bound on (at, id)', () => {
    const { sql } = q({}, { after: { atText: '2026-10-13T09:59:58.123456Z', id: 5 } });
    expect(sql).toContain('(a.at, a.id) < ($4::timestamptz, $5)');
  });
  it('never inlines a value into the SQL text', () => {
    const { sql } = q({ module: "x'; DROP TABLE audit_log;--", q: "'; --" });
    expect(sql).not.toContain('DROP');
  });
});

describe('likeEscape', () => {
  it('escapes the three LIKE metacharacters', () =>
    expect(likeEscape('a%b_c\\d')).toBe('a\\%b\\_c\\\\d'));
});

describe('actor kinds', () => {
  it('maps the known kinds and the rest to other', () => {
    expect(actorKindOf('user')).toBe('user');
    expect(actorKindOf('api_key')).toBe('api_key');
    expect(actorKindOf('platform_operator')).toBe('other');
  });
});

describe('csv', () => {
  it('defuses a formula and quotes what needs quoting', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('@sum')).toBe(`"'@sum"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvLine(['a', 'b"c', 3])).toBe('a,"b""c",3');
  });
});

describe('an act-as row is flagged', () => {
  const svc = Object.create(AuditLogService.prototype) as AuditLogService;
  const base: AuditRow = {
    id: 1,
    atText: '2026-10-13T09:59:58.123456Z',
    at: new Date('2026-10-13T09:59:58.123Z'),
    actorId: 3,
    actorType: 'user',
    module: 'contacts',
    recordId: '9',
    action: 'update',
    requestId: 'r1',
    changedFields: ['stage'],
    sessionUuid: null,
    userUuid: '3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11',
    userName: 'Owner Person',
    keyName: null,
  };
  it('a normal row has no act-as', () => {
    expect(svc.toEntry(base, new Map(), new Map()).actAs).toBeNull();
  });
  it('a stamped row says platform support was acting, with the reason from the session', () => {
    const sessions = new Map([
      [
        's1',
        {
          reason: 'Ticket 4411: fix import',
          readOnly: false,
          startedAt: new Date('2026-10-13T09:00:00Z'),
        },
      ],
    ]);
    const e = svc.toEntry(
      { ...base, sessionUuid: 's1' },
      new Map([['contacts:9', '/contacts/u']]),
      sessions,
    );
    expect(e.actAs).toEqual({
      reason: 'Ticket 4411: fix import',
      readOnly: false,
      startedAt: '2026-10-13T09:00:00.000Z',
    });
    expect(e.record.href).toBe('/contacts/u');
    expect(e.actor).toEqual({ kind: 'user', id: base.userUuid, name: 'Owner Person' });
  });
  it('is still flagged when the session row is gone (reason unknown)', () => {
    expect(svc.toEntry({ ...base, sessionUuid: 'gone' }, new Map(), new Map()).actAs).toEqual({
      reason: null,
      readOnly: null,
      startedAt: null,
    });
  });
  it('the list carries field names only, no values', () => {
    const e = svc.toEntry(
      { ...base, delta: { phone: { old: '1', new: '2' } } },
      new Map(),
      new Map(),
    );
    expect(JSON.stringify(e)).not.toContain('"old"');
    expect(e.changedFields).toEqual(['stage']);
  });
});
