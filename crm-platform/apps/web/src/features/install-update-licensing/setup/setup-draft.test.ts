import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SETUP_RUN_STEPS, setupRunRequestSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { formatDuration, progressPercent } from './install-run';
import {
  RAIL,
  SCREENS,
  classifyFailure,
  emptyDraft,
  filterTimezones,
  firstInvalidScreen,
  generateNodeToken,
  railIndex,
  toRunRequest,
  validateAdmin,
  validateApplication,
  validateDatabase,
  validateNode,
  validateToken,
  workspaceSlug,
  type WizardDraft,
} from './setup-draft';

const good: WizardDraft = {
  ...emptyDraft({ timezone: 'Asia/Kolkata', origin: 'https://app.acme.io' }),
  setupToken: 'x'.repeat(32),
  dbName: 'crm',
  dbUser: 'crm',
  appName: 'Acme Desk',
  fullName: 'Asha Rao',
  email: 'Owner@Example.com',
  password: 'Zq7!hello-World',
  confirm: 'Zq7!hello-World',
  workspaceName: 'Acme Ltd',
  nodeToken: 'f'.repeat(64),
};
const keys = (ps: Array<{ key: string }>) => ps.map((p) => p.key);

describe('the rail (WD-INST-002)', () => {
  it('has WaDesk’s seven steps, with the licence page sharing the first', () => {
    expect(RAIL).toEqual([
      'welcome',
      'requirements',
      'database',
      'application',
      'admin',
      'node',
      'install',
    ]);
    expect(railIndex('welcome')).toBe(1);
    expect(railIndex('licence')).toBe(1);
    expect(railIndex('requirements')).toBe(2);
    expect(railIndex('install')).toBe(7);
    expect(SCREENS).toHaveLength(8);
  });
});

describe('database form (WD-INST-005)', () => {
  it('needs host, a valid port, database and username, and lets the password stay blank', () => {
    expect(validateDatabase(good)).toEqual([]);
    expect(keys(validateDatabase({ ...good, dbHost: ' ' }))).toEqual(['dbHost']);
    expect(keys(validateDatabase({ ...good, dbPort: '0' }))).toEqual(['dbPort']);
    expect(keys(validateDatabase({ ...good, dbPort: '70000' }))).toEqual(['dbPort']);
    expect(keys(validateDatabase({ ...good, dbPort: 'abc' }))).toEqual(['dbPort']);
    expect(keys(validateDatabase({ ...good, dbName: '', dbUser: '' }))).toEqual([
      'dbName',
      'dbUser',
    ]);
    expect(validateDatabase({ ...good, dbPassword: '' })).toEqual([]);
  });
});

describe('application basics (WD-INST-007)', () => {
  it('accepts a name up to 100 characters, a full URL, a real timezone and a shipped language', () => {
    expect(validateApplication(good)).toEqual([]);
    expect(validateApplication({ ...good, appName: 'x'.repeat(100) })).toEqual([]);
  });

  it('flags a 101-character name, a URL with no scheme, an unknown timezone and an unknown language', () => {
    expect(keys(validateApplication({ ...good, appName: 'x'.repeat(101) }))).toEqual([
      'appNameLong',
    ]);
    expect(keys(validateApplication({ ...good, appName: '  ' }))).toEqual(['appNameRequired']);
    expect(keys(validateApplication({ ...good, appUrl: 'app.acme.io' }))).toEqual(['appUrl']);
    expect(keys(validateApplication({ ...good, timezone: 'Mars/Base' }))).toEqual(['timezone']);
    expect(keys(validateApplication({ ...good, locale: 'xx' }))).toEqual(['locale']);
  });
});

describe('timezone typeahead (WD-INST-007)', () => {
  const zones = [
    'Asia/Kolkata',
    'Asia/Kathmandu',
    'Europe/Paris',
    'America/Argentina/Salta',
    'UTC',
  ];

  it('lists the first 25 for an empty search and filters by substring otherwise', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Zone/${i}`);
    expect(filterTimezones(many, '')).toHaveLength(25);
    expect(filterTimezones(many, '   ')).toHaveLength(25);
    expect(filterTimezones(zones, 'kol')).toEqual(['Asia/Kolkata']);
    expect(filterTimezones(zones, 'ASIA')).toEqual(['Asia/Kolkata', 'Asia/Kathmandu']);
    expect(filterTimezones(zones, 'nowhere')).toEqual([]);
  });
});

describe('admin account (WD-INST-008)', () => {
  it('accepts a complete form and reports every problem, not just the first', () => {
    expect(validateAdmin(good)).toEqual([]);
    const bad = validateAdmin({
      ...good,
      fullName: '',
      email: 'nope',
      password: 'weak',
      confirm: 'other',
      workspaceName: 'x',
    });
    expect(keys(bad)).toEqual(
      expect.arrayContaining([
        'fullNameRequired',
        'email',
        'password.length',
        'password.upper',
        'passwordMismatch',
        'workspaceRequired',
      ]),
    );
    expect(bad.length).toBeGreaterThan(5);
  });

  it('flags a mismatched confirmation, a password that holds the name, and a 121-character workspace', () => {
    expect(keys(validateAdmin({ ...good, confirm: 'different' }))).toEqual(['passwordMismatch']);
    const personal = 'Asha-Rao#2024xx';
    expect(keys(validateAdmin({ ...good, password: personal, confirm: personal }))).toContain(
      'password.personal',
    );
    expect(keys(validateAdmin({ ...good, workspaceName: 'x'.repeat(121) }))).toEqual([
      'workspaceLong',
    ]);
  });
});

describe('Node bridge (WD-INST-009)', () => {
  it('accepts the defaults with a generated token', () => {
    expect(validateNode(good)).toEqual([]);
  });

  it('flags port 70000, a token under 16 characters and a URL with no scheme', () => {
    expect(keys(validateNode({ ...good, nodePort: '70000' }))).toEqual(['nodePort']);
    expect(keys(validateNode({ ...good, nodePort: '0' }))).toEqual(['nodePort']);
    expect(keys(validateNode({ ...good, nodeToken: 'a'.repeat(15) }))).toEqual(['nodeToken']);
    expect(validateNode({ ...good, nodeToken: 'a'.repeat(16) })).toEqual([]);
    expect(keys(validateNode({ ...good, nodeUrl: 'localhost:8888' }))).toEqual(['nodeUrl']);
  });

  it('generates 64 hex characters from 32 random bytes, and a different one each time', () => {
    const token = generateNodeToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateNodeToken()).not.toBe(token);
    expect(generateNodeToken((a) => a.fill(255))).toBe('ff'.repeat(32));
    expect(generateNodeToken((a) => a.fill(1))).toBe('01'.repeat(32));
  });
});

describe('setup token and the review of the whole form', () => {
  it('flags a short token', () => {
    expect(keys(validateToken({ ...good, setupToken: 'short' }))).toEqual(['tokenLength']);
    expect(validateToken(good)).toEqual([]);
  });

  it('names the first screen with a problem so the run can send the person back to it', () => {
    expect(firstInvalidScreen(good)).toBeNull();
    expect(firstInvalidScreen({ ...good, setupToken: '' })).toBe('welcome');
    expect(firstInvalidScreen({ ...good, dbName: '' })).toBe('database');
    expect(firstInvalidScreen({ ...good, appUrl: '' })).toBe('application');
    expect(firstInvalidScreen({ ...good, fullName: '' })).toBe('admin');
    expect(firstInvalidScreen({ ...good, nodeToken: '' })).toBe('node');
  });
});

describe('workspace address (WD-INST-014: WaDesk made a random one, there is no field for it)', () => {
  it('derives it from the workspace name and falls back when the name has no usable letters', () => {
    expect(workspaceSlug('Acme Ltd')).toBe('acme-ltd');
    expect(workspaceSlug('My team')).toBe('my-team');
    expect(workspaceSlug('Café Münch')).toBe('cafe-munch');
    expect(workspaceSlug('我的团队')).toBe('workspace');
  });
});

describe('toRunRequest', () => {
  it('builds a request the server accepts: trimmed, email lower-cased, slug derived, token and password carried', () => {
    const r = toRunRequest({ ...good, setupToken: `  ${good.setupToken} ` }, 4, false);
    expect(r.setupToken).toBe(good.setupToken);
    expect(r.operator.email).toBe('owner@example.com');
    expect(r.organization).toMatchObject({
      slug: 'acme-ltd',
      timezone: 'Asia/Kolkata',
      locale: 'en',
    });
    expect(r.node).toEqual({
      serverUrl: 'http://localhost:8888',
      port: 8888,
      token: good.nodeToken,
    });
    expect(r.purchaseCode).toBeUndefined();
    expect(setupRunRequestSchema.safeParse(r).success).toBe(true);
  });

  it('carries the purchase code only when the deployment requires one', () => {
    const r = toRunRequest({ ...good, purchaseCode: ' abc ' }, 1, true);
    expect(r.purchaseCode).toBe('abc');
  });
});

describe('classifyFailure', () => {
  const api = (
    code: string,
    status = 400,
    errors: Array<{ path: string; message?: string }> = [],
  ) =>
    new ApiError(
      status,
      code,
      'server text',
      'req-1',
      errors.map((e) => ({ path: e.path, message: e.message ?? 'm' })),
    );

  it('maps the setup codes', () => {
    expect(classifyFailure(api(ERROR_CODES.SETUP_TOKEN_INVALID, 403)).kind).toBe('token');
    expect(classifyFailure(api(ERROR_CODES.SETUP_DISABLED, 403)).kind).toBe('disabled');
    expect(classifyFailure(api(ERROR_CODES.SETUP_ALREADY_COMPLETED, 409)).kind).toBe('completed');
    expect(classifyFailure(api(ERROR_CODES.SETUP_STEP_OUT_OF_ORDER, 409)).kind).toBe('outOfOrder');
    expect(classifyFailure(api(ERROR_CODES.SETUP_STEP_FAILED, 500))).toEqual({
      kind: 'step',
      requestId: 'req-1',
    });
  });

  it('lists the failing prerequisites by their path', () => {
    expect(
      classifyFailure(
        api(ERROR_CODES.SETUP_PREREQUISITES_FAILED, 409, [
          { path: 'migrations' },
          { path: 'redis' },
        ]),
      ),
    ).toEqual({ kind: 'prerequisites', failed: ['migrations', 'redis'] });
  });

  it('takes the licence reason and the database reason from the error detail, never from the text', () => {
    expect(
      classifyFailure(
        api(ERROR_CODES.SETUP_LICENCE_INVALID, 422, [
          { path: 'purchaseCode', message: 'not_found' },
        ]),
      ),
    ).toEqual({ kind: 'licence', reason: 'not_found' });
    expect(
      classifyFailure(
        api(ERROR_CODES.SETUP_DATABASE_TEST_FAILED, 422, [{ path: 'reason', message: 'server' }]),
      ),
    ).toEqual({ kind: 'database', reason: 'server', message: 'server text' });
    expect(
      classifyFailure(
        api(ERROR_CODES.SETUP_DATABASE_TEST_FAILED, 422, [
          { path: 'reason', message: 'unreachable' },
        ]),
      ),
    ).toMatchObject({ kind: 'database', reason: 'unreachable' });
  });

  it('treats anything else as unknown', () => {
    expect(classifyFailure(new Error('boom')).kind).toBe('unknown');
    expect(classifyFailure(api('SOMETHING_NEW', 500))).toEqual({
      kind: 'unknown',
      requestId: 'req-1',
    });
  });
});

describe('install run progress (WD-INST-010)', () => {
  const rows = (...s: Array<'pending' | 'running' | 'done' | 'failed'>) =>
    s.map((status) => ({ status }));

  it('counts a running row as half done, like WaDesk', () => {
    expect(
      progressPercent(rows('pending', 'pending', 'pending', 'pending', 'pending', 'pending')),
    ).toBe(0);
    expect(
      progressPercent(rows('running', 'pending', 'pending', 'pending', 'pending', 'pending')),
    ).toBeCloseTo(8.33, 1);
    expect(
      progressPercent(rows('done', 'done', 'running', 'pending', 'pending', 'pending')),
    ).toBeCloseTo(41.67, 1);
    expect(progressPercent(rows('done', 'done', 'done', 'done', 'done', 'done'))).toBe(100);
  });

  it('prints durations as milliseconds under a second and seconds with one decimal after', () => {
    expect(formatDuration(420)).toBe('420ms');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(12_345)).toBe('12.3s');
  });
});

describe('messages', () => {
  const root = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'en', 'install-update-licensing.json'), 'utf8'),
  ) as { 'install-update-licensing': { setup: Record<string, unknown> } };
  const setup = root['install-update-licensing'].setup;
  const text = (path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], setup);

  it('has a label for every rail step and a row text for every run step', () => {
    for (const s of RAIL) expect(text(`steps.${s}`), s).toBeTypeOf('string');
    for (const s of SETUP_RUN_STEPS) {
      expect(text(`install.rows.${s}.done`), s).toBeTypeOf('string');
      expect(text(`install.rows.${s}.active`), s).toBeTypeOf('string');
    }
  });

  it('has a sentence for every problem the validators can produce', () => {
    const every = [
      ...validateToken({ ...good, setupToken: '' }),
      ...validateDatabase({ ...good, dbHost: '', dbPort: '0', dbName: '', dbUser: '' }),
      ...validateApplication({ ...good, appName: '', appUrl: '', timezone: 'x', locale: 'x' }),
      ...validateApplication({ ...good, appName: 'x'.repeat(101) }),
      ...validateAdmin({
        ...good,
        fullName: 'x'.repeat(121),
        email: 'x',
        password: '',
        confirm: 'y',
        workspaceName: '',
      }),
      ...validateAdmin({ ...good, fullName: '', workspaceName: 'x'.repeat(121) }),
      ...validateAdmin({ ...good, password: 'Asha-Rao#2024xx', confirm: 'Asha-Rao#2024xx' }),
      ...validateNode({ ...good, nodeUrl: '', nodePort: '0', nodeToken: '' }),
    ];
    expect(every.length).toBeGreaterThan(15);
    for (const p of every) {
      expect(text(`errors.${p.key}`), p.key).toBeTypeOf('string');
    }
  });

  it('has a sentence for every licence reason the server can give', () => {
    for (const r of [
      'empty',
      'not_configured',
      'unreachable',
      'not_found',
      'http_error',
      'other_product',
      'unknown',
    ]) {
      expect(text(`problems.licence.${r}`), r).toBeTypeOf('string');
    }
  });
});
