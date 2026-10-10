import { gunzipSync } from 'node:zlib';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Param } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  SECRET_HEADERS,
  flushSentry,
  initSentry,
} from '../../../src/modules/platform-infrastructure';

/**
 * Tracing switched on (`SENTRY_TRACES_SAMPLE_RATE` set), end to end: a real Sentry client sends to a local listener and what arrives
 * is checked for the same secrets as in `sentry.http.spec.ts`. Sentry 11 sends one span per request and names its address in
 * `url.full` and `url.path`; `beforeSendTransaction` (what Sentry 8 was scrubbed through) is ignored in that mode, so a secret in a
 * webhook path went out until spans were scrubbed too. Its own file because `initSentry` runs once per process.
 */
@Controller()
class OkController {
  @Get('shopify/webhook/:secret') ok(@Param('secret') _secret: string): string {
    return 'ok';
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
    SENTRY_TRACES_SAMPLE_RATE: '1',
    NODE_ENV: 'test',
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [OkController],
    providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    RequestContextStore.run(
      { requestId: 'req-test-2', orgId: 0, actorType: 'system', actorId: null, userId: null },
      next,
    ),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => sink.close(resolve));
});

describe('error reporting with tracing on', () => {
  it('sends the request as a span, with the secret in the address masked and no query string', async () => {
    // every header the API treats as a credential or signature, each with a value that can be found in the payload
    let req = supertest(app.getHttpServer()).get(
      '/shopify/webhook/TOPSECRETVALUE?token=QUERYSECRET',
    );
    for (const header of SECRET_HEADERS) req = req.set(header, `HDR-${header}-VALUE`);
    const res = await req;
    expect(res.status).toBe(200);
    await flushSentry(5000);

    const sent = received.join('\n');
    // not vacuous: the request did produce a span, and its address arrived masked
    expect(sent).toContain('"type":"span"');
    expect(sent).toContain('/shopify/webhook/[secret]');
    for (const secret of ['TOPSECRETVALUE', 'QUERYSECRET']) {
      expect(sent, `${secret} leaked`).not.toContain(secret);
    }
    for (const header of SECRET_HEADERS) {
      expect(sent, `the value of ${header} leaked`).not.toContain(`HDR-${header}-VALUE`);
    }
  });
});
