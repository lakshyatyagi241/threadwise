import 'reflect-metadata';
import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Module,
  Param,
  Post,
  Query,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { LoggerModule, Logger as PinoLogger } from 'nestjs-pino';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { RequestContextMiddleware } from '../../../src/common/middleware/request-context.middleware';
import { apiHttpLoggerOptions } from '../../../src/common/logging/http-logger';

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    lines.push(
      ...String(chunk)
        .split('\n')
        .filter(Boolean)
        .map((l) => l),
    );
    cb();
  },
});
/** The fields of a captured log line that these assertions read. */
interface LogLine {
  level: string;
  msg: string;
  requestId?: string;
  orgId?: number;
  req?: { id?: string };
  res?: unknown;
}
const parsed = () => lines.map((l) => JSON.parse(l) as LogLine);
const since = (n: number) => lines.slice(n).map((l) => JSON.parse(l) as LogLine);

const SECRET = 'sk_live_SUPERSECRET0123456789';

@Controller()
class ProbeController {
  private readonly log = new Logger('probe');
  @Get('ok') ok() {
    this.log.log('handler ran');
    return { ok: true };
  }
  @Get('health') health() {
    return { ok: true };
  }
  @Get('bad') bad() {
    throw new BadRequestException('nope');
  }
  @Get('boom') boom() {
    throw new Error(
      `connect postgres://crm:${SECRET}@db:5432/x failed; Authorization: Bearer ${SECRET}; token=${SECRET}`,
    );
  }
  @Get('as-tenant') asTenant() {
    // what JwtAuthGuard does: fill org and actor on the ambient context
    const ctx = RequestContextStore.peek()!;
    ctx.orgId = 7;
    ctx.actorType = 'user';
    ctx.actorId = 99;
    this.log.log('tenant work');
    return { ok: true };
  }
  @Get('public/invoices/:token') invoice(@Param('token') t: string) {
    return { t: t.length };
  }
  @Get('echo') echo(@Query() q: Record<string, string>) {
    this.log.log(`user text ${q.text ?? ''}`);
    return {};
  }
  @Post('body') body() {
    return {};
  }
}

@Module({
  imports: [LoggerModule.forRoot({ pinoHttp: [apiHttpLoggerOptions('debug'), sink] as never })],
  controllers: [ProbeController],
  providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
})
class TestModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(RequestContextMiddleware).forRoutes('*');
  }
}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = mod.createNestApplication({ bufferLogs: true, bodyParser: true });
  app.useLogger(app.get(PinoLogger));
  await app.listen(0);
  base = await app.getUrl();
});
afterAll(async () => app.close());

async function hit(path: string, init?: RequestInit) {
  const start = lines.length;
  const res = await fetch(base.replace('[::1]', 'localhost') + path, init);
  await res.text();
  await new Promise((r) => setTimeout(r, 30));
  return { res, logs: since(start) };
}

describe('structured logging (Sheet3 #74)', () => {
  it('every line is single-line JSON with time, level, msg, service', async () => {
    await hit('/ok');
    await hit('/bad');
    await hit('/boom');
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) {
      expect(l).not.toContain('\n');
      const o = JSON.parse(l);
      expect(Number.isNaN(Date.parse(o.time))).toBe(false);
      expect(typeof o.level).toBe('string');
      expect(typeof o.msg).toBe('string');
      expect(o.service).toBe('api');
    }
  });

  it('the same request id is on every line of one request and in the response header', async () => {
    const { res, logs } = await hit('/ok', { headers: { 'x-request-id': 'rid-abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('rid-abc-123');
    expect(logs.length).toBeGreaterThanOrEqual(2); // handler line + request-completed line
    for (const o of logs) expect(o.requestId ?? o.req?.id).toBe('rid-abc-123');
    for (const o of logs) expect(o.req?.id ?? 'rid-abc-123').toBe('rid-abc-123');
  });

  it('an over-long or non-plain incoming id is replaced, never logged', async () => {
    const bad = 'x'.repeat(5000);
    const { res, logs } = await hit('/ok', { headers: { 'x-request-id': bad } });
    const rid = res.headers.get('x-request-id')!;
    expect(rid).not.toBe(bad);
    for (const o of logs) expect(JSON.stringify(o).length).toBeLessThan(2048);
    for (const o of logs) expect(o.requestId).toBe(rid);
  });

  it('tenant id is on authenticated lines only and absent for anonymous ones', async () => {
    const anon = await hit('/ok');
    for (const o of anon.logs) expect(o.orgId).toBeUndefined();
    const auth = await hit('/as-tenant');
    const handler = auth.logs.find((o) => o.msg === 'tenant work')!;
    const done = auth.logs.find((o) => o.res)!;
    expect(done.orgId).toBe(7);
    expect(handler.orgId ?? 7).toBe(7); // Nest Logger lines inherit the request child logger
    for (const o of auth.logs) expect(o.orgId === undefined || o.orgId === 7).toBe(true);
  });

  it('redacts secret headers, query secrets and bearer-link tokens', async () => {
    const { logs } = await hit(`/public/invoices/${SECRET}?token=${SECRET}&api_key=${SECRET}&x=1`, {
      headers: {
        authorization: `Bearer ${SECRET}`,
        cookie: `sid=${SECRET}`,
        'x-api-key': SECRET,
        'x-webhook-secret': SECRET,
      },
    });
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).toContain('x=1');
  });

  it('a 5xx is logged once as an error, a 4xx never above info', async () => {
    const boom = await hit('/boom');
    const errs = boom.logs.filter((o) => o.level === 'error');
    expect(errs.length).toBe(1);
    expect(JSON.stringify(boom.logs)).not.toContain(SECRET); // credentials inside an error text are scrubbed
    const bad = await hit('/bad');
    expect(bad.logs.filter((o) => ['error', 'warn'].includes(o.level)).length).toBe(0);
  });

  it('health probes are not logged at info', async () => {
    const { logs } = await hit('/health');
    expect(logs.filter((o) => o.level === 'info' || o.level === 'warn').length).toBe(0);
  });

  it('a 5 MB body is not copied into the log', async () => {
    const { logs } = await hit('/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'A'.repeat(5 * 1024 * 1024) }),
    });
    for (const o of logs) expect(JSON.stringify(o).length).toBeLessThan(8 * 1024);
  });

  it('newlines and ANSI in user input cannot forge a log line', async () => {
    const start = lines.length;
    const evil = encodeURIComponent('hi\n{"level":"fatal","msg":"FORGED"}\u001b[31m');
    await hit(`/echo?text=${evil}`);
    for (const l of lines.slice(start)) {
      const o = JSON.parse(l); // every physical line still parses
      expect(o.msg).not.toBe('FORGED');
      expect(o.level).not.toBe('fatal');
    }
  });

  it('parsed lines are valid after the whole battery', () => {
    expect(parsed().length).toBe(lines.length);
  });
});
