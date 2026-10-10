import { gunzipSync } from 'node:zlib';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { flushSentry, initSentry } from '../../../src/modules/platform-infrastructure';

/**
 * Error reporting end to end (TW-INFRA-018): a real Sentry client sends to a local listener, and what arrives is checked for
 * what must never leave: credentials in headers, cookies, a body, a secret in the address.
 */
@Controller()
class BoomController {
  @Get('shopify/webhook/:secret') boom(@Param('secret') _secret: string): never {
    throw new Error('kaboom');
  }
  @Get('missing') missing(): never {
    throw new NotFoundException('not a server problem');
  }
}

const received: string[] = [];
let sink: Server;
let app: NestExpressApplication;

beforeAll(async () => {
  sink = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      received.push(
        (req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8'),
      );
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const port = (sink.address() as AddressInfo).port;

  initSentry('api', {
    SENTRY_DSN: `http://public@127.0.0.1:${port}/1`,
    NODE_ENV: 'test',
    GIT_SHA: 'abc123def',
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [BoomController],
    providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  // what RequestContextMiddleware does: an id for the request, visible to the filter
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    RequestContextStore.run(
      { requestId: 'req-test-1', orgId: 0, actorType: 'system', actorId: null, userId: null },
      next,
    ),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => sink.close(resolve));
});

describe('error reporting', () => {
  it('sends a 5xx with its release and service, and nothing that was in the request', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/shopify/webhook/TOPSECRETVALUE?token=QUERYSECRET')
      .set('authorization', 'Bearer BEARERSECRET')
      .set('cookie', 'sid=COOKIESECRET')
      .set('x-webhook-secret', 'HEADERSECRET');
    expect(res.status).toBe(500);
    await flushSentry(5000);

    const sent = received.join('\n');
    expect(sent).toContain('kaboom');
    expect(sent).toContain('abc123def');
    expect(sent).toContain('"service":"api"');
    for (const secret of [
      'TOPSECRETVALUE',
      'QUERYSECRET',
      'BEARERSECRET',
      'COOKIESECRET',
      'HEADERSECRET',
    ]) {
      expect(sent, `${secret} leaked`).not.toContain(secret);
    }
  });

  it('sends no performance transaction unless tracing was asked for (it would carry the full address)', () => {
    expect(received.join('\n')).not.toContain('"type":"transaction"');
  });

  it('tags the report with the request id and the masked path so it can be matched to the log line', async () => {
    const sent = received.join('\n');
    expect(sent).toContain('"requestId"');
    expect(sent).toContain('/shopify/webhook/[secret]');
  });

  it('does not report a client error', async () => {
    // Sentry 11 also sends envelopes that carry no error: session counts and client reports (how many spans it dropped)
    const errorEvents = () => received.filter((body) => body.includes('"type":"event"')).length;
    const before = errorEvents();
    await supertest(app.getHttpServer()).get('/missing');
    await flushSentry(1000);
    expect(errorEvents()).toBe(before);
  });
});
