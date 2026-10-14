import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const STAGING = resolve(__dirname, '../pilot/staging');
const AGENT = join(STAGING, 'runner-agent.cjs');
const require = createRequire(__filename);
const agent = require(AGENT) as {
  validJob: (
    j: unknown,
  ) => { runId: string; sourceClient: string; sourceDb: string; mode: string } | null;
  pipelineArgs: (j: { sourceClient: string; sourceDb: string; mode: string }) => string[];
  runnerName: (env: Record<string, string | undefined>) => string;
  batches: (lines: string[]) => string[][];
  MAX_LINES: number;
  MAX_REPORT_BYTES: number;
};

const RUN = '2b0e4f0a-6a43-4e0f-9a63-8d1f5c9f1b11';
const good = { runId: RUN, sourceClient: 'acme', sourceDb: 'Acme_Db', mode: 'dry' };

describe('runner agent: what it will start a process for', () => {
  it('accepts exactly the three values of a run, and nothing else rides along', () => {
    expect(agent.validJob({ ...good, extra: '; rm -rf /' })).toEqual(good);
    for (const mode of ['dry', 'load', 'catchup'])
      expect(agent.validJob({ ...good, mode })).not.toBeNull();
  });
  it('refuses anything that could be a shell fragment, a path or a wrong mode', () => {
    const bad = [
      null,
      'x',
      { ...good, runId: 'not-a-uuid' },
      { ...good, sourceClient: 'Acme' },
      { ...good, sourceClient: 'a b' },
      { ...good, sourceClient: 'a;b' },
      { ...good, sourceClient: '' },
      { ...good, sourceDb: 'a b' },
      { ...good, sourceDb: 'x;y' },
      { ...good, sourceDb: '$(id)' },
      { ...good, sourceDb: '../x' },
      { ...good, sourceDb: 'a'.repeat(129) },
      { ...good, mode: 'drop' },
      { ...good, mode: 'LOAD' },
      { ...good, mode: undefined },
    ];
    for (const j of bad) expect(agent.validJob(j), JSON.stringify(j)).toBeNull();
  });
  it('builds an argument list for pipeline.cjs (never a shell string)', () => {
    const a = agent.pipelineArgs(good);
    expect(a).toEqual([
      join(STAGING, 'pipeline.cjs'),
      '--client',
      'acme',
      '--db',
      'Acme_Db',
      '--mode',
      'dry',
    ]);
  });
});

describe('runner agent: naming and reporting', () => {
  it('names itself from WABOO_RUNNER_NAME or the machine, in the shape the API accepts', () => {
    expect(agent.runnerName({ WABOO_RUNNER_NAME: 'vedant-laptop' })).toBe('vedant-laptop');
    expect(agent.runnerName({ WABOO_RUNNER_NAME: 'my laptop (2)' })).toMatch(
      /^[A-Za-z0-9._-]{1,64}$/,
    );
    expect(agent.runnerName({ WABOO_RUNNER_NAME: 'x'.repeat(200) })).toHaveLength(64);
    expect(agent.runnerName({})).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });
  it('cuts pending lines into reports the API accepts, drops lines it would refuse, keeps the order', () => {
    const many = Array.from({ length: 120 }, (_, i) => `{"n":${i}}`);
    const parts = agent.batches(many);
    expect(parts.every((p) => p.length <= agent.MAX_LINES)).toBe(true);
    expect(parts.flat()).toEqual(many);
    expect(agent.batches(['', 'x'.repeat(9000), '{"a":1}'])).toEqual([['{"a":1}']]);
    expect(agent.batches([])).toEqual([]);
    const big = Array.from({ length: 20 }, () => 'y'.repeat(6000));
    const parts2 = agent.batches(big);
    for (const p of parts2)
      expect(p.reduce((n, l) => n + Buffer.byteLength(l), 0)).toBeLessThanOrEqual(
        agent.MAX_REPORT_BYTES,
      );
    expect(parts2.flat()).toHaveLength(20);
  });
});

describe('owner mailbox of a new client (pipeline.cjs)', () => {
  const src = readFileSync(join(STAGING, 'pipeline.cjs'), 'utf8');
  const guard = /[A-Za-z0-9+/_=-]{32,}/; // cycle.cjs LONGBLOB: what new-client refuses as a possible secret
  const ownerLocal = new Function(
    `${/const ownerLocal = .*;/.exec(src)![0]}; return ownerLocal;`,
  )() as (s: string) => string;
  it('is used for the placeholder owner address', () => {
    expect(src).toContain('`owner-${ownerLocal(slug)}@desk.wabo.ai`');
  });
  it('never trips the secret guard for any real client key, and stays distinct per client', () => {
    const keys = [
      'dhanashreehospital_com_8pMgiumk',
      'www_fitboxx_in_LVF8jTrp',
      'www_skyblue_in_Y2e7ECDx',
      'www_ontimeholidays_com_cXBtnqf9',
      'www_tirupatibank_com_MdHYpHig',
      'tattvavit_das_GJdvpcDL_CWDi',
      'www_smhospitalnagpur_com_DmQpi87r',
      'mlckiranrsarnaik_nUS6qEGL_71GE',
      'a'.repeat(60),
    ];
    const seen = new Set<string>();
    for (const k of keys) {
      const slug = k.toLowerCase().replace(/_/g, '-').slice(0, 60);
      const email = `owner-${ownerLocal(slug)}@desk.wabo.ai`;
      expect(guard.test(email), email).toBe(false);
      expect(email).toMatch(/^[a-z0-9-]+@desk\.wabo\.ai$/);
      seen.add(email);
    }
    expect(seen.size).toBe(keys.length);
  });
  it('leaves a short key whole', () => {
    expect(ownerLocal('iskm')).toBe('iskm');
    expect(ownerLocal('rhythm-watches')).toBe('rhythm-watches');
  });
});

/** A tiny fake of the WaDesk runner API, to drive the real agent process end to end. */
function fakeApi(job: unknown, token: string) {
  const calls: Array<{ path: string; body: Record<string, unknown>; auth: string | undefined }> =
    [];
  let claimed = false;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const path = (req.url ?? '').replace('/v2/platform/waboo-migration/runner', '');
      calls.push({ path, body, auth: req.headers.authorization });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        return res.end('{}');
      }
      if (path === '/claim') {
        const j = claimed ? null : job;
        claimed = true;
        return res.end(JSON.stringify({ job: j }));
      }
      if (path.endsWith('/report')) return res.end(JSON.stringify({ cancel: false }));
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  return { server, calls };
}

describe('runner agent process', () => {
  const TOKEN = 't'.repeat(40);
  const run = (env: Record<string, string>, args: string[] = []) =>
    new Promise<{ code: number | null; err: string }>((done) => {
      const p = spawn(process.execPath, [AGENT, ...args], {
        env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      const t = setTimeout(() => p.kill('SIGKILL'), 60_000);
      p.on('close', (code) => {
        clearTimeout(t);
        done({ code, err });
      });
    });

  it('refuses to start without a usable address and token, and never prints the token', async () => {
    const a = await run({ WABOO_RUNNER_TOKEN: TOKEN });
    expect(a.code).toBe(1);
    expect(a.err).toMatch(/WABOO_RUNNER_URL/);
    const b = await run({ WABOO_RUNNER_URL: 'http://127.0.0.1:1', WABOO_RUNNER_TOKEN: 'short' });
    expect(b.code).toBe(1);
    expect(b.err).toMatch(/WABOO_RUNNER_TOKEN/);
    expect(b.err).not.toContain('short');
  });

  it('stops with a clear message when the API refuses its token, and the token is never echoed', async () => {
    const { server, calls } = fakeApi(null, 'a-different-token-of-sufficient-length-1234');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await run({
      WABOO_RUNNER_URL: `http://127.0.0.1:${port}`,
      WABOO_RUNNER_TOKEN: TOKEN,
    });
    server.close();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/refused the runner token/);
    expect(r.err).not.toContain(TOKEN);
    expect(calls[0]?.path).toBe('/claim');
  });

  it('refuses a job with unsafe values: no process is started and nothing is reported for it', async () => {
    const { server, calls } = fakeApi({ ...good, sourceDb: 'x; touch /tmp/pwned' }, TOKEN);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const p = spawn(process.execPath, [AGENT], {
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        WABOO_RUNNER_URL: `http://127.0.0.1:${port}`,
        WABOO_RUNNER_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    await new Promise((r) => setTimeout(r, 1500));
    p.kill('SIGTERM');
    await new Promise((r) => p.on('close', r));
    server.close();
    expect(err).toMatch(/refuses/);
    expect(calls.some((c) => c.path.includes('/jobs/'))).toBe(false);
  });
});
