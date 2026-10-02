import { describe, expect, it } from 'vitest';
import {
  setupAppSchema,
  setupBootstrapRequestSchema,
  setupDatabaseTestRequestSchema,
  setupNodeSchema,
  setupRunRequestSchema,
} from '@crm/contracts';
import { readInstEnv } from '../../../src/config/domains/install-update-licensing.env';
import {
  candidateHosts,
  parseDatabaseUrl,
  resolvePassword,
} from '../../../src/modules/install-update-licensing/database-test.service';
import {
  LicenceService,
  type FetchLike,
} from '../../../src/modules/install-update-licensing/licence.service';
import { nodeMajor } from '../../../src/modules/install-update-licensing/requirements.service';

const base = {
  setupToken: 'a'.repeat(32),
  operator: { fullName: 'Asha Rao', email: 'owner@example.com', password: 'Tr1cky-Passphrase!42' },
  organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'Asia/Kolkata', locale: 'en' },
};

describe('application basics (WD-INST-007: WaDesk checked only that these were strings)', () => {
  it('takes a name up to 100 characters and an http(s) URL', () => {
    expect(
      setupAppSchema.safeParse({ name: 'Acme Desk', url: 'https://app.acme.io' }).success,
    ).toBe(true);
    expect(
      setupAppSchema.safeParse({ name: 'x'.repeat(100), url: 'http://localhost:3000' }).success,
    ).toBe(true);
    expect(
      setupAppSchema.safeParse({ name: 'x'.repeat(101), url: 'https://app.acme.io' }).success,
    ).toBe(false);
    expect(setupAppSchema.safeParse({ name: '', url: 'https://app.acme.io' }).success).toBe(false);
  });

  it('refuses a URL with no scheme, a non-web scheme or a script scheme', () => {
    for (const url of ['app.acme.io', 'ftp://app.acme.io', 'javascript:alert(1)', '']) {
      expect(setupAppSchema.safeParse({ name: 'Acme', url }).success, url).toBe(false);
    }
  });

  it('is optional on the request, so the CLI path still works, and validated when present', () => {
    expect(setupBootstrapRequestSchema.safeParse(base).success).toBe(true);
    expect(
      setupBootstrapRequestSchema.safeParse({ ...base, app: { name: 'A', url: 'nope' } }).success,
    ).toBe(false);
  });
});

describe('Node bridge (WD-INST-009)', () => {
  const ok = { serverUrl: 'http://localhost:8888', port: 8888, token: 'f'.repeat(64) };

  it('accepts a 64-hex generated token and the full port range', () => {
    expect(setupNodeSchema.safeParse(ok).success).toBe(true);
    expect(setupNodeSchema.safeParse({ ...ok, port: 1 }).success).toBe(true);
    expect(setupNodeSchema.safeParse({ ...ok, port: 65535 }).success).toBe(true);
  });

  it('refuses port 0 and 70000, a fractional port, a 15-character token and a bad URL', () => {
    expect(setupNodeSchema.safeParse({ ...ok, port: 0 }).success).toBe(false);
    expect(setupNodeSchema.safeParse({ ...ok, port: 70000 }).success).toBe(false);
    expect(setupNodeSchema.safeParse({ ...ok, port: 80.5 }).success).toBe(false);
    expect(setupNodeSchema.safeParse({ ...ok, token: 'a'.repeat(15) }).success).toBe(false);
    expect(setupNodeSchema.safeParse({ ...ok, token: 'a'.repeat(16) }).success).toBe(true);
    expect(setupNodeSchema.safeParse({ ...ok, serverUrl: 'localhost:8888' }).success).toBe(false);
  });
});

describe('install run request (WD-INST-010)', () => {
  it('takes steps 1 to 6 only', () => {
    for (const step of [1, 6])
      expect(setupRunRequestSchema.safeParse({ ...base, step }).success).toBe(true);
    for (const step of [0, 7, 1.5, '2']) {
      expect(setupRunRequestSchema.safeParse({ ...base, step }).success, String(step)).toBe(false);
    }
  });

  it('re-checks the operator password on every step, not only the last', () => {
    const weak = { ...base, operator: { ...base.operator, password: 'weakpass' }, step: 1 };
    expect(setupRunRequestSchema.safeParse(weak).success).toBe(false);
  });
});

describe('database form (WD-INST-005)', () => {
  const form = {
    setupToken: 'a'.repeat(32),
    host: '127.0.0.1',
    port: '5432',
    database: 'crm',
    username: 'crm',
  };

  it('takes the port as text from the form and a blank password', () => {
    const parsed = setupDatabaseTestRequestSchema.parse(form);
    expect(parsed.port).toBe(5432);
    expect(parsed.password).toBeUndefined();
  });

  it('requires host, database and username and a real port', () => {
    for (const bad of [
      { host: '' },
      { database: '' },
      { username: '' },
      { port: '0' },
      { port: '70000' },
    ]) {
      expect(
        setupDatabaseTestRequestSchema.safeParse({ ...form, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe('database connection helpers (WD-INST-006)', () => {
  const own = parseDatabaseUrl('postgres://crm_user:p%40ss@db.internal:6543/crm')!;

  it('reads the deployment connection, decoding the credentials', () => {
    expect(own).toEqual({
      host: 'db.internal',
      port: 6543,
      database: 'crm',
      username: 'crm_user',
      password: 'p@ss',
    });
    expect(parseDatabaseUrl('postgres://h/db')!.port).toBe(5432);
    expect(parseDatabaseUrl('not a url')).toBeNull();
  });

  it('tries what was typed, then loopback by address, then by name, without repeats', () => {
    expect(candidateHosts('db.internal')).toEqual(['db.internal', '127.0.0.1', 'localhost']);
    expect(candidateHosts('127.0.0.1')).toEqual(['127.0.0.1', 'localhost']);
    expect(candidateHosts('localhost')).toEqual(['localhost', '127.0.0.1']);
  });

  it('uses the deployment password for a blank field only when everything else is the deployment connection', () => {
    const same = { host: 'db.internal', port: 6543, database: 'crm', username: 'crm_user' };
    expect(resolvePassword(same, own)).toBe('p@ss');
    expect(resolvePassword({ ...same, password: 'typed' }, own)).toBe('typed');
    expect(resolvePassword({ ...same, host: 'elsewhere' }, own)).toBe('');
    expect(resolvePassword({ ...same, database: 'other' }, own)).toBe('');
    expect(resolvePassword(same, null)).toBe('');
  });
});

describe('runtime requirement (WD-INST-004)', () => {
  it('reads the major version from process.version', () => {
    expect(nodeMajor('v22.3.0')).toBe(22);
    expect(nodeMajor('v20.11.1')).toBe(20);
  });
});

describe('licence environment (WD-INST-017)', () => {
  it('is off by default and needs nothing', () => {
    expect(readInstEnv({}).LICENCE_MODE).toBe('off');
    expect(readInstEnv({ LICENCE_MODE: '' }).LICENCE_MODE).toBe('off');
  });

  it('refuses to start in envato mode without the item id and the author token', () => {
    expect(() => readInstEnv({ LICENCE_MODE: 'envato' })).toThrow(/ENVATO_ITEM_ID is required/);
    expect(() => readInstEnv({ LICENCE_MODE: 'envato', ENVATO_ITEM_ID: '1' })).toThrow(
      /ENVATO_AUTHOR_TOKEN is required/,
    );
    expect(() => readInstEnv({ LICENCE_MODE: 'maybe' })).toThrow();
    const env = readInstEnv({
      LICENCE_MODE: 'envato',
      ENVATO_ITEM_ID: '1',
      ENVATO_AUTHOR_TOKEN: 't',
    });
    expect(env.ENVATO_AUTHOR_TOKEN).toBe('t');
  });
});

describe('licence check without a token (WD-INST-003: "not configured")', () => {
  const never = (async () => {
    throw new Error('must not call Envato without a token');
  }) as unknown as FetchLike;
  const svc = new LicenceService(readInstEnv({}), never, {} as never);

  it('answers not_configured without making a request, and empty for a blank code', async () => {
    expect(await svc.check('some-code')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await svc.check('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('is not required until the environment says so', () => {
    expect(svc.required).toBe(false);
  });
});

describe('licence check outcomes (WD-INST-003 rule 2)', () => {
  const env = readInstEnv({
    LICENCE_MODE: 'envato',
    ENVATO_ITEM_ID: '42',
    ENVATO_AUTHOR_TOKEN: 'tok',
  });
  const answer = (res: Response | Error) =>
    new LicenceService(
      env,
      (async () => {
        if (res instanceof Error) throw res;
        return res;
      }) as unknown as FetchLike,
      {} as never,
    );

  it('accepts a sale of this item, with the id as a number or a string', async () => {
    expect(await answer(Response.json({ item: { id: 42 } })).check('c')).toEqual({ ok: true });
    expect(await answer(Response.json({ item: { id: '42' } })).check('c')).toEqual({ ok: true });
  });

  it('rejects another item, a 404, any other status and a network failure', async () => {
    expect(await answer(Response.json({ item: { id: 7 } })).check('c')).toMatchObject({
      reason: 'other_product',
    });
    expect(await answer(new Response('', { status: 404 })).check('c')).toMatchObject({
      reason: 'not_found',
    });
    expect(await answer(new Response('', { status: 500 })).check('c')).toEqual({
      ok: false,
      reason: 'http_error',
      status: 500,
    });
    expect(await answer(new Error('boom')).check('c')).toMatchObject({ reason: 'unreachable' });
  });

  it('compares the item only when both sides know it (WaDesk compared when both were non-empty)', async () => {
    expect(await answer(Response.json({})).check('c')).toEqual({ ok: true });
  });
});
