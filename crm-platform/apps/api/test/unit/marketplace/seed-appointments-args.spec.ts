import { describe, expect, it } from 'vitest';
import {
  checkGuards,
  hostsOfDatabaseUrl,
  isLocalHost,
  parseArgs,
} from '../../../src/modules/marketplace/cli/seed-appointments.args';
import { usage } from '../../../src/modules/marketplace/cli/seed-app.args';
import {
  APPOINTMENTS_CONFIG,
  FORMS_CONFIG,
} from '../../../src/modules/marketplace/cli/seed-app.config';
import { parseArgs as parseFormsArgs } from '../../../src/modules/marketplace/cli/seed-forms.args';

const options = (argv: string[]) => {
  const r = parseArgs(argv);
  if (r.kind !== 'options') throw new Error(`expected options, got ${JSON.stringify(r)}`);
  return r.options;
};
const error = (argv: string[]) => {
  const r = parseArgs(argv);
  if (r.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(r)}`);
  return r.message;
};

describe('seed:appointments arguments', () => {
  it('defaults to 499 INR, a real run, every workspace', () => {
    expect(options([])).toEqual({
      price: '499.00',
      currency: 'INR',
      dryRun: false,
      force: false,
      workspace: null,
      allWorkspaces: false,
      yes: false,
    });
  });

  it('reads every flag, with a space or an equals sign, and tolerates the pnpm separator', () => {
    expect(
      options([
        '--',
        '--price',
        '1250.5',
        '--currency=usd',
        '--dry-run',
        '--force',
        '--workspace',
        'acme',
      ]),
    ).toEqual({
      price: '1250.50',
      currency: 'USD',
      dryRun: true,
      force: true,
      workspace: 'acme',
      allWorkspaces: false,
      yes: false,
    });
    expect(options(['--price=9']).price).toBe('9.00');
  });

  it('shows the help text and rejects anything it does not know', () => {
    expect(parseArgs(['--help']).kind).toBe('help');
    expect(error(['--nope'])).toMatch(/unknown option --nope/);
    expect(error(['stray'])).toMatch(/unexpected argument/);
    expect(error(['--dry-run=yes'])).toMatch(/takes no value/);
    expect(error(['--price'])).toMatch(/needs a value/);
    expect(error(['--price', '--force'])).toMatch(/needs a value/);
  });

  it.each(['0', '-5', 'abc', '1.234', '1e3', '99999999999'])('rejects the price %s', (price) => {
    expect(error(['--price', price])).toMatch(/--price/);
  });

  it.each(['RS', 'RUPEE', '1NR'])('rejects the currency %s', (currency) => {
    expect(error(['--currency', currency])).toMatch(/--currency/);
  });

  it('rejects a workspace value that is not a slug', () => {
    expect(error(['--workspace', 'a b'])).toMatch(/--workspace/);
    expect(error(['--workspace', '../x'])).toMatch(/--workspace/);
  });
});

describe('seed:appointments guards', () => {
  const local = 'postgres://crm_app_user:pw@localhost:55432/crm';

  it('refuses NODE_ENV=production, even with a local database', () => {
    const r = checkGuards({ NODE_ENV: 'production', DATABASE_URL: local });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/NODE_ENV=production/) });
  });

  it('refuses when there is no DATABASE_URL', () => {
    expect(checkGuards({ NODE_ENV: 'development' })).toMatchObject({ ok: false });
  });

  it.each([
    'postgres://u:p@localhost:5432/crm',
    'postgresql://u:p@127.0.0.1/crm',
    'postgres://u:p@[::1]:5432/crm',
    'postgres://u:p@host.docker.internal:5432/crm',
    'postgres://u:p@devbox.local:5432/crm',
    'postgres://u:p@LOCALHOST/crm',
    'postgres:///crm',
  ])('allows %s', (url) => {
    expect(checkGuards({ NODE_ENV: 'development', DATABASE_URL: url })).toEqual({
      ok: true,
      databaseUrl: url,
    });
  });

  it.each([
    'postgres://u:p@db.prod.example.com:5432/crm',
    'postgres://u:p@10.0.0.5:5432/crm',
    'postgres://u:p@localhost.evil.com/crm',
    'postgres://u:p@notlocal/crm',
    'postgres://u:p@my-host.local.example.com/crm',
    'postgres://u:p@127.0.0.1.nip.io/crm',
    'postgres://localhost@evil.com/crm',
    'postgres://u:p@localhost/crm?host=db.prod.example.com',
    'postgres://u:p@localhost/crm?hostaddr=10.1.2.3',
    'mysql://u:p@localhost/crm',
    'not a url',
  ])('refuses %s', (url) => {
    const r = checkGuards({ NODE_ENV: 'development', DATABASE_URL: url });
    expect(r.ok).toBe(false);
  });

  it('also checks MIGRATION_DATABASE_URL when it is set', () => {
    const r = checkGuards({
      NODE_ENV: 'development',
      DATABASE_URL: local,
      MIGRATION_DATABASE_URL: 'postgres://crm:crm@db.prod.example.com:5432/crm',
    });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('MIGRATION_DATABASE_URL') });
    expect(
      checkGuards({
        NODE_ENV: 'test',
        DATABASE_URL: local,
        MIGRATION_DATABASE_URL: 'postgres://crm:crm@localhost:55432/crm',
      }).ok,
    ).toBe(true);
  });

  it('classifies hosts and reads the effective target of a URL', () => {
    expect(isLocalHost('Host.Docker.Internal')).toBe(true);
    expect(isLocalHost('example.com')).toBe(false);
    expect(hostsOfDatabaseUrl('postgres://u@a.local/db')).toEqual(['a.local']);
    expect(hostsOfDatabaseUrl('postgres://u@a/db?host=b,c')).toEqual(['b', 'c']);
    expect(hostsOfDatabaseUrl('garbage')).toBeNull();
  });
});

describe('seed:forms arguments and per-app config', () => {
  const forms = (argv: string[]) => {
    const r = parseFormsArgs(argv);
    if (r.kind !== 'options') throw new Error(`expected options, got ${JSON.stringify(r)}`);
    return r.options;
  };
  const formsError = (argv: string[]) => {
    const r = parseFormsArgs(argv);
    if (r.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(r)}`);
    return r.message;
  };

  it('defaults to 799 INR (decision D1), a real run, nobody comped', () => {
    expect(forms([])).toEqual({
      price: '799.00',
      currency: 'INR',
      dryRun: false,
      force: false,
      workspace: null,
      allWorkspaces: false,
      yes: false,
    });
    expect(options([]).price).toBe('499.00');
  });

  it('the configs describe the two apps', () => {
    expect(FORMS_CONFIG).toMatchObject({
      slug: 'forms',
      feature: 'form_builder',
      grandfatherExisting: false,
      version: '1.0.0',
    });
    expect(APPOINTMENTS_CONFIG).toMatchObject({
      slug: 'appointments',
      feature: 'appointment_booking',
      grandfatherExisting: true,
    });
    expect(usage(FORMS_CONFIG)).toMatch(/seed:forms/);
    expect(usage(FORMS_CONFIG)).toMatch(/default 799/);
    expect(usage(APPOINTMENTS_CONFIG)).toMatch(/default 499/);
  });

  it('takes --price, --currency and --workspace like the Appointments command', () => {
    expect(forms(['--price', '999', '--currency', 'usd', '--workspace', 'admin-ws'])).toMatchObject(
      {
        price: '999.00',
        currency: 'USD',
        workspace: 'admin-ws',
      },
    );
    expect(formsError(['--price', '0'])).toMatch(/--price/);
  });

  it('--all-workspaces needs --yes for a real run, and cannot be combined with --workspace', () => {
    expect(formsError(['--all-workspaces'])).toMatch(/--yes/);
    expect(forms(['--all-workspaces', '--yes'])).toMatchObject({ allWorkspaces: true, yes: true });
    // a dry run only lists, so it needs no confirmation
    expect(forms(['--all-workspaces', '--dry-run'])).toMatchObject({
      allWorkspaces: true,
      dryRun: true,
      yes: false,
    });
    expect(formsError(['--all-workspaces', '--yes', '--workspace', 'a'])).toMatch(
      /cannot be combined/,
    );
    expect(formsError(['--yes'])).toMatch(/only confirms --all-workspaces/);
  });
});
