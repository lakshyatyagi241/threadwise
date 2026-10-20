import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWabooMigrationBatchSchema, createWabooMigrationRunSchema } from '@crm/contracts';
import {
  CHILD_ENV_BASE,
  PipelineNotConfiguredError,
  ProcessRunner,
  buildArgs,
  childEnv,
  timeoutMs,
} from '../../../src/modules/waboo-migration/runner';
import {
  applyStep,
  canMove,
  finalState,
  loadGate,
  parseLine,
  scrub,
  type RunStatus,
} from '../../../src/modules/waboo-migration/waboo-migration.rules';

const NOW = new Date('2026-10-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe('pipeline event parser', () => {
  it('reads a step event', () => {
    expect(
      parseLine(
        '{"event":"step","name":"export","status":"running","counts":{"rows":5},"message":"go"}',
      ),
    ).toEqual({
      event: 'step',
      name: 'export',
      status: 'running',
      counts: { rows: 5 },
      message: 'go',
    });
  });

  it('reads the report event', () => {
    expect(
      parseLine(
        '{"event":"report","green":true,"unaccounted":0,"integrityErrors":0,"alarms":2,"orgId":7,"summary":"ok"}',
      ),
    ).toEqual({
      event: 'report',
      green: true,
      unaccounted: 0,
      integrityErrors: 0,
      alarms: 2,
      orgId: 7,
      summary: 'ok',
    });
  });

  it('ignores blank, non-JSON, unknown and malformed lines', () => {
    for (const line of [
      '',
      '   ',
      'Loading contacts...',
      '{broken',
      '[1,2]',
      '{"event":"debug"}',
      '{"event":"step","name":"nope","status":"running"}',
      '{"event":"step","name":"export","status":"weird"}',
      '{"event":"report","green":"yes"}',
    ])
      expect(parseLine(line), line).toBeNull();
  });

  it('keeps only numeric counts and clamps a bad orgId to null', () => {
    const s = parseLine('{"event":"step","name":"dry","status":"done","counts":{"a":1,"b":"x"}}');
    expect(s).toMatchObject({ counts: { a: 1 }, message: null });
    const r = parseLine('{"event":"report","green":false,"orgId":-3,"summary":"s"}');
    expect(r).toMatchObject({ orgId: null, unaccounted: 0 });
  });

  it('masks credentials and personal data in messages', () => {
    const e = parseLine(
      JSON.stringify({
        event: 'step',
        name: 'load',
        status: 'failed',
        message:
          'connect postgres://u:hunter2@db.internal/x failed password=abc123 mail a@b.com phone +91 98765 43210',
      }),
    );
    const m = (e as { message: string }).message;
    expect(m).not.toMatch(/hunter2|abc123|a@b\.com|98765/);
  });
});

describe('scrub', () => {
  it('masks bearer tokens and long opaque strings', () => {
    expect(scrub('Authorization: Bearer abc.def')).not.toContain('abc.def');
    expect(scrub('key ' + 'a'.repeat(40))).toBe('key [secret]');
  });
});

describe('step timeline', () => {
  it('keeps one entry per step, in first-seen order, merging counts', () => {
    let steps = applyStep(
      [],
      { event: 'step', name: 'export', status: 'running', counts: {}, message: null },
      NOW,
    );
    expect(steps[0]).toMatchObject({
      status: 'running',
      startedAt: NOW.toISOString(),
      finishedAt: null,
    });
    steps = applyStep(
      steps,
      { event: 'step', name: 'preflight', status: 'running', counts: {}, message: null },
      NOW,
    );
    steps = applyStep(
      steps,
      { event: 'step', name: 'export', status: 'done', counts: { rows: 9 }, message: 'm' },
      hoursAgo(-1),
    );
    expect(steps.map((s) => s.name)).toEqual(['export', 'preflight']);
    expect(steps[0]).toMatchObject({
      status: 'done',
      counts: { rows: 9 },
      message: 'm',
      startedAt: NOW.toISOString(),
    });
    expect(steps[0]!.finishedAt).not.toBeNull();
  });

  it('a skipped step has no start time', () => {
    const [s] = applyStep(
      [],
      { event: 'step', name: 'backup', status: 'skipped', counts: {}, message: null },
      NOW,
    );
    expect(s!.startedAt).toBeNull();
  });
});

describe('run state transitions', () => {
  const all: RunStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled', 'blocked'];
  it('allows only the documented moves', () => {
    const ok = new Set([
      'queued>running',
      'queued>cancelled',
      'queued>failed',
      'queued>blocked',
      'running>completed',
      'running>failed',
    ]);
    for (const a of all)
      for (const b of all) expect(canMove(a, b), `${a}>${b}`).toBe(ok.has(`${a}>${b}`));
  });
  it('a running run cannot be cancelled in v1', () =>
    expect(canMove('running', 'cancelled')).toBe(false));
});

describe('confirmation gate', () => {
  const base = { sourceClient: 'acme', confirmClient: 'acme' };
  it('a dry run is never gated', () => {
    expect(loadGate({ ...base, mode: 'dry', confirmClient: undefined })).toBeNull();
  });
  it('a load needs the client key typed exactly', () => {
    expect(loadGate({ ...base, mode: 'load', confirmClient: undefined })).toBe('confirm');
    expect(loadGate({ ...base, mode: 'load', confirmClient: 'Acme' })).toBe('confirm');
    expect(loadGate({ ...base, mode: 'load', confirmClient: 'wrong' })).toBe('confirm');
  });
  it('the organization id typed is accepted as well as the derived client key', () => {
    expect(
      loadGate({ ...base, mode: 'load', organizationId: 'Acme_AbC', confirmClient: 'Acme_AbC' }),
    ).toBeNull();
  });
  it('a load and a catch-up need the typed confirmation but no earlier dry run (each rehearses itself first)', () => {
    expect(loadGate({ ...base, mode: 'load' })).toBeNull();
    expect(loadGate({ ...base, mode: 'catchup' })).toBeNull();
    expect(loadGate({ ...base, mode: 'catchup', confirmClient: undefined })).toBe('confirm');
  });
});

describe('final state of a pipeline process', () => {
  const rep = {
    event: 'report' as const,
    green: true,
    unaccounted: 0,
    integrityErrors: 0,
    alarms: 0,
    orgId: null,
    summary: '',
  };
  const ok = { exitCode: 0, timedOut: false, stderrTail: '', report: rep };
  it('completes only on exit 0 with a report', () => {
    expect(finalState(ok, 90)).toEqual({ status: 'completed', error: null });
    expect(finalState({ ...ok, report: null }, 90).status).toBe('failed');
    expect(finalState({ ...ok, exitCode: 2, stderrTail: 'boom' }, 90)).toEqual({
      status: 'failed',
      error: 'boom',
    });
    expect(finalState({ ...ok, timedOut: true, exitCode: null }, 90).error).toContain('90 minutes');
  });
});

describe('request contract', () => {
  it('defaults to a dry run and refuses a client key or database name with shell characters', () => {
    expect(
      createWabooMigrationRunSchema.parse({ sourceClient: 'acme-1', sourceDb: 'waboo_acme' }).mode,
    ).toBe('dry');
    for (const bad of [
      { sourceClient: 'a b', sourceDb: 'x' },
      { sourceClient: 'ACME', sourceDb: 'x' },
      { sourceClient: 'a', sourceDb: 'x; rm -rf' },
      { sourceClient: 'a', sourceDb: 'db-name' },
      { sourceClient: 'a', sourceDb: '' },
    ])
      expect(createWabooMigrationRunSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('process runner safety', () => {
  it('passes the database name only as a validated argument, never through a shell string', () => {
    expect(
      buildArgs('/p/run.js', { sourceClient: 'acme', sourceDb: 'waboo_acme', mode: 'dry' }),
    ).toEqual(['/p/run.js', '--client', 'acme', '--db', 'waboo_acme', '--mode', 'dry']);
  });
  it('adds --no-whatsapp only when the run asks to leave the WhatsApp number out', () => {
    const a = { sourceClient: 'acme', sourceDb: 'waboo_acme', mode: 'load' as const };
    expect(buildArgs('/p/run.js', { ...a, skipWhatsapp: true })).toEqual([
      '/p/run.js',
      '--client',
      'acme',
      '--db',
      'waboo_acme',
      '--mode',
      'load',
      '--no-whatsapp',
    ]);
    expect(buildArgs('/p/run.js', { ...a, skipWhatsapp: false })).not.toContain('--no-whatsapp');
    expect(buildArgs('/p/run.js', a)).not.toContain('--no-whatsapp');
  });
  it('the create schemas default the switch to off and take a boolean', () => {
    const one = createWabooMigrationRunSchema.parse({ organizationId: 'acme_db' });
    expect(one.skipWhatsapp).toBe(false);
    expect(
      createWabooMigrationRunSchema.parse({ organizationId: 'acme_db', skipWhatsapp: true })
        .skipWhatsapp,
    ).toBe(true);
    expect(
      createWabooMigrationRunSchema.safeParse({ organizationId: 'acme_db', skipWhatsapp: 'yes' })
        .success,
    ).toBe(false);
    expect(createWabooMigrationBatchSchema.parse({ organizationIds: ['a_b'] }).skipWhatsapp).toBe(
      false,
    );
  });
  it('gives the child only allow-listed environment names', () => {
    const env = {
      PATH: '/bin',
      STRIPE_KEY: 'sk_live',
      JWT_SECRET: 's',
      MY_DB: 'x',
      WABOO_MIGRATE_CHILD_ENV: 'MY_DB, bad name;',
    };
    const out = childEnv(env);
    expect(Object.keys(out).sort()).toEqual(['MY_DB', 'PATH']);
    for (const k of Object.keys(childEnv(Object.fromEntries(CHILD_ENV_BASE.map((n) => [n, '1'])))))
      expect(CHILD_ENV_BASE).toContain(k);
  });
  it('reads the timeout in minutes, default 90', () => {
    expect(timeoutMs({})).toBe(90 * 60_000);
    expect(timeoutMs({ WABOO_MIGRATE_TIMEOUT_MIN: '5' })).toBe(5 * 60_000);
    expect(timeoutMs({ WABOO_MIGRATE_TIMEOUT_MIN: 'x' })).toBe(90 * 60_000);
  });
  it('spawns nothing and fails clearly when the pipeline path is not set', async () => {
    await expect(
      new ProcessRunner({}).run(
        { sourceClient: 'a', sourceDb: 'b', mode: 'dry' },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(PipelineNotConfiguredError);
  });
  it('runs a real child process, streams events, ignores noise and keeps the stderr tail', async () => {
    // A test double for the pipeline: prints the protocol, some noise, and a secret on stderr; refuses unexpected arguments.
    const script = join(mkdtempSync(join(tmpdir(), 'wmig-')), 'fake-pipeline.cjs');
    writeFileSync(
      script,
      [
        "if (process.argv.slice(2).join(' ') !== '--client acme --db waboo_acme --mode dry') process.exit(3);",
        "console.log('starting up...');",
        ...[
          { event: 'step', name: 'export', status: 'running', counts: {}, message: null },
          { event: 'step', name: 'export', status: 'done', counts: { contacts: 3 }, message: null },
          {
            event: 'report',
            green: true,
            unaccounted: 0,
            integrityErrors: 0,
            alarms: 0,
            orgId: null,
            summary: 'fine',
          },
        ].map((e) => `console.log(${JSON.stringify(JSON.stringify(e))});`),
        "console.error('warning: password=hunter2');",
      ].join('\n'),
    );
    const events: string[] = [];
    const out = await new ProcessRunner({
      WABOO_MIGRATE_PIPELINE: script,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    }).run(
      { sourceClient: 'acme', sourceDb: 'waboo_acme', mode: 'dry' },
      async (e) => void events.push(e.event),
    );
    expect(events).toEqual(['step', 'step', 'report']);
    expect(out.exitCode).toBe(0);
    expect(out.report?.green).toBe(true);
    expect(out.stderrTail).not.toContain('hunter2');
  });
});

describe('safety rules (module source)', () => {
  const dir = join(process.cwd(), 'src', 'modules', 'waboo-migration');
  const source = readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  it('never imports a WhatsApp or provider module and never opens a database of its own', () => {
    expect(source).not.toMatch(/from '\.\.\/(whatsapp|waba|channel|node-bridge)/);
    expect(source).not.toMatch(/\bnew (Pool|Client)\b|from 'pg'/);
  });
  it('spawns with an args array and no shell', () => {
    expect(source).toMatch(/shell: false/);
    expect(source).not.toMatch(/\bexec(Sync)?\(|shell: true/);
  });
});

describe('organization id with a plus sign', () => {
  it('is accepted, with a client key derived without the plus', () => {
    const r = createWabooMigrationRunSchema.safeParse({
      organizationId: 'support+demo_XXKhXNvA_y8tj',
      mode: 'dry',
    });
    expect(r.success).toBe(true);
  });
  it('still rejects other characters', () => {
    for (const bad of ['a b', 'a-b', 'a;b', 'a/b', '']) {
      expect(
        createWabooMigrationRunSchema.safeParse({ organizationId: bad, mode: 'dry' }).success,
      ).toBe(false);
    }
  });
});
