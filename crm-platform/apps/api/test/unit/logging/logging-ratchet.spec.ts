import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskSecretUrl } from '../../../src/common/logging/mask-secret-url';
import { baseLoggerOptions } from '../../../src/common/logging/http-logger';
import pino from 'pino';

const SRC = join(__dirname, '../../../src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

/** Command-line tools talk to a terminal on purpose; everything the running API or worker does must use the Nest logger (pino). */
// process-handlers.ts writes the dying process's last line straight to stderr (the logger may be gone), in the same JSON shape.
const ALLOWED = [
  /observability\/process-handlers\.ts$/,
  /(^|\/)cli\//,
  /\.cli\.ts$/,
  /\.main\.ts$/,
  /^tools\//,
  /^modules\/auth\/maintenance\//,
];

describe('no new console output in apps/api/src (ratchet)', () => {
  it('console.* appears only in CLI entry points', () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !ALLOWED.some((re) => re.test(f)))
      .filter((f) =>
        /\bconsole\.(log|error|warn|info|debug)\(|process\.std(out|err)\.write\(/.test(
          readFileSync(join(SRC, f), 'utf8'),
        ),
      );
    expect(offenders, 'use `new Logger(Name)` from @nestjs/common instead').toEqual([]);
  });
});

describe('both processes route Nest Logger calls through pino', () => {
  for (const f of ['main.ts', 'worker.ts']) {
    it(`${f} calls app.useLogger(pino)`, () => {
      expect(readFileSync(join(SRC, f), 'utf8')).toMatch(
        /app\.useLogger\(app\.get\(PinoLogger\)\)/,
      );
    });
  }
  it('the worker module uses the same base fields as the API', () => {
    expect(readFileSync(join(SRC, 'worker.module.ts'), 'utf8')).toContain(
      "baseLoggerOptions('worker'",
    );
  });
  it('the worker stamps the originating request id on outbox lines', () => {
    expect(readFileSync(join(SRC, 'workers/outbox-drain.service.ts'), 'utf8')).toContain(
      'requestId: originRequestId(row)',
    );
  });
});

describe('secret-looking input never survives the masking helpers', () => {
  const S = 'Zk9xQ7pLmN2vB8sT4wYc';
  const urls = [
    `/v2/public/invoices/${S}`,
    `/v2/public/sales-docs/${S}?x=1`,
    `/v2/public/booking-manage/${S}`,
    `/v2/public/lead-hooks/${S}`,
    `/v2/telegram/inbound/${S}`,
    `/v2/shopify/webhook/${S}`,
    `/v2/auth/verify?token=${S}`,
    `/v2/x?a=1&access_token=${S}&b=2`,
    `/v2/x?api_key=${S}`,
    `/v2/x?apiKey=${S}`,
    `/v2/oauth/callback?code=${S}&state=ok`,
    `/v2/x?webhook_secret=${S}`,
    `/v2/x?signature=${S}`,
  ];
  for (const u of urls)
    it(`masks ${u.replace(S, '<S>')}`, () => expect(maskSecretUrl(u)).not.toContain(S));
  it('keeps harmless query values', () =>
    expect(maskSecretUrl('/v2/contacts?limit=20&q=anna')).toBe('/v2/contacts?limit=20&q=anna'));
});

describe('worker logger options', () => {
  it('writes time, level, msg and service=worker as one JSON line', () => {
    const chunks: string[] = [];
    const log = pino(baseLoggerOptions('worker', 'info'), {
      write: (s: string) => void chunks.push(s),
    });
    log.info({ err: new Error('x postgres://u:pw123456@h/db') }, 'hello');
    expect(chunks).toHaveLength(1);
    const o = JSON.parse(chunks[0]!);
    expect(o).toMatchObject({ level: 'info', service: 'worker', msg: 'hello' });
    expect(Date.parse(o.time)).not.toBeNaN();
    expect(chunks[0]).not.toContain('pw123456');
  });
});
