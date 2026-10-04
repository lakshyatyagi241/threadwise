import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Post, Req } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import supertest from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { LEAD_HOOK_MAX_BODY_BYTES, MARKET_HOOK_MAX_BYTES } from '@crm/contracts';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import { installBodyLimits } from '../../../src/modules/platform-infrastructure';

const KIB = 1024;

/** Echoes what the parser delivered: the parsed field, and the raw bytes a signature check would hash. */
const echo = (req: Request & { rawBody?: Buffer }) => ({
  parsed: typeof req.body?.a === 'string' ? (req.body.a as string).length : null,
  raw: req.rawBody?.length ?? null,
});

@Controller()
class EchoController {
  @Post('plain') plain(@Req() r: Request) {
    return echo(r);
  }
  @Post('public/webhooks/whatsapp') whatsapp(@Req() r: Request) {
    return echo(r);
  }
  @Post('v2/public/webhooks/whatsapp/extra') whatsappVersioned(@Req() r: Request) {
    return echo(r);
  }
  @Post('shopify/webhook/:secret') shopify(@Req() r: Request) {
    return echo(r);
  }
  @Post('public/lead-hooks/:token') lead(@Req() r: Request) {
    return echo(r);
  }
  @Post('public/marketplace/:slug') market(@Req() r: Request) {
    return echo(r);
  }
  @Post('public/webhooks-lookalike') lookalike(@Req() r: Request) {
    return echo(r);
  }
}

const apps: NestExpressApplication[] = [];
async function boot(
  env: Record<string, string> = {},
  install = true,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [EchoController],
    providers: [{ provide: APP_FILTER, useClass: ProblemExceptionFilter }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  if (install) installBodyLimits(app, readInfraEnv(env));
  await app.init();
  apps.push(app);
  return app;
}
afterAll(async () => {
  for (const a of apps) await a.close();
});

/** A JSON body of exactly `bytes` bytes. */
const jsonOf = (bytes: number) => {
  const pad = bytes - '{"a":""}'.length;
  return `{"a":"${'x'.repeat(pad)}"}`;
};
const post = (app: NestExpressApplication, path: string, body: string, type = 'application/json') =>
  supertest(app.getHttpServer()).post(path).set('content-type', type).send(body);

describe('default limit', () => {
  it('is 100 KiB, exactly what Express enforced before this setting existed', async () => {
    const app = await boot();
    const ok = await post(app, '/plain', jsonOf(100 * KIB));
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ parsed: 100 * KIB - '{"a":""}'.length, raw: 100 * KIB });
    expect((await post(app, '/plain', jsonOf(100 * KIB + 1))).status).toBe(413);
  });

  it('matches what the stock Nest parser did without the installer', async () => {
    const stock = await boot({}, false);
    expect((await post(stock, '/plain', jsonOf(100 * KIB))).status).toBe(201);
    expect((await post(stock, '/plain', jsonOf(100 * KIB + 1))).status).toBe(413);
  });

  it('answers 413 as problem+json with PAYLOAD_TOO_LARGE', async () => {
    const res = await post(await boot(), '/plain', jsonOf(120 * KIB));
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('applies to form bodies too', async () => {
    const app = await boot();
    const form = (n: number) => `a=${'x'.repeat(n)}`;
    expect(
      (await post(app, '/plain', form(90 * KIB), 'application/x-www-form-urlencoded')).status,
    ).toBe(201);
    expect(
      (await post(app, '/plain', form(110 * KIB), 'application/x-www-form-urlencoded')).status,
    ).toBe(413);
  });

  it('is configurable', async () => {
    const small = await boot({ INFRA_BODY_LIMIT_KB: '2' });
    expect((await post(small, '/plain', jsonOf(2 * KIB))).status).toBe(201);
    expect((await post(small, '/plain', jsonOf(3 * KIB))).status).toBe(413);
  });

  it('keeps the raw bytes for signature checks', async () => {
    const res = await post(await boot(), '/plain', jsonOf(5000));
    expect(res.body.raw).toBe(5000);
  });
});

describe('route classes', () => {
  it('lets the WhatsApp callback carry 3 MiB and stops at 4 MiB (unversioned and /v2)', async () => {
    const app = await boot();
    const ok = await post(app, '/public/webhooks/whatsapp', jsonOf(3 * 1024 * KIB));
    expect(ok.status).toBe(201);
    expect(ok.body.raw).toBe(3 * 1024 * KIB); // raw bytes survive the class parser, for the HMAC
    expect((await post(app, '/public/webhooks/whatsapp', jsonOf(4 * 1024 * KIB + 1))).status).toBe(
      413,
    );
    expect(
      (await post(app, '/v2/public/webhooks/whatsapp/extra', jsonOf(2 * 1024 * KIB))).status,
    ).toBe(201);
  });

  it('lets other machine callbacks carry 1 MiB', async () => {
    const app = await boot();
    expect((await post(app, '/shopify/webhook/abc', jsonOf(900 * KIB))).status).toBe(201);
    expect((await post(app, '/shopify/webhook/abc', jsonOf(1024 * KIB + 1))).status).toBe(413);
  });

  it("makes each domain's own contract cap the real one (lead hook 1 MiB, marketplace 256 KiB)", async () => {
    const app = await boot();
    expect((await post(app, '/public/lead-hooks/t', jsonOf(LEAD_HOOK_MAX_BODY_BYTES))).status).toBe(
      201,
    );
    expect(
      (await post(app, '/public/lead-hooks/t', jsonOf(LEAD_HOOK_MAX_BODY_BYTES + 1))).status,
    ).toBe(413);
    expect((await post(app, '/public/marketplace/s', jsonOf(MARKET_HOOK_MAX_BYTES))).status).toBe(
      201,
    );
    expect(
      (await post(app, '/public/marketplace/s', jsonOf(MARKET_HOOK_MAX_BYTES + 1))).status,
    ).toBe(413);
  });

  it('does not stretch a class over look-alike paths', async () => {
    const app = await boot();
    expect((await post(app, '/public/webhooks-lookalike', jsonOf(200 * KIB))).status).toBe(413);
  });

  it('parses a form body on a class route once, with the class cap', async () => {
    const app = await boot();
    const res = await post(
      app,
      '/shopify/webhook/abc',
      `a=${'x'.repeat(500 * KIB)}`,
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(201);
    expect(res.body.parsed).toBe(500 * KIB);
  });

  it('class caps are configurable', async () => {
    const app = await boot({
      INFRA_BODY_LIMIT_WEBHOOK_KB: '8',
      INFRA_BODY_LIMIT_WHATSAPP_WEBHOOK_KB: '16',
    });
    expect((await post(app, '/shopify/webhook/x', jsonOf(8 * KIB))).status).toBe(201);
    expect((await post(app, '/shopify/webhook/x', jsonOf(9 * KIB))).status).toBe(413);
    expect((await post(app, '/public/webhooks/whatsapp', jsonOf(16 * KIB))).status).toBe(201);
    expect((await post(app, '/public/webhooks/whatsapp', jsonOf(17 * KIB))).status).toBe(413);
  });
});

describe('streamed bodies (no Content-Length)', () => {
  it('are cut off over the cap too', async () => {
    const app = await boot();
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/plain',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', (e) =>
        (e as NodeJS.ErrnoException).code === 'ECONNRESET' ||
        (e as NodeJS.ErrnoException).code === 'EPIPE'
          ? resolve(413)
          : reject(e),
      );
      const chunk = `{"a":"${'x'.repeat(50 * KIB)}`;
      req.write(chunk);
      req.write('x'.repeat(60 * KIB));
      req.end('"}');
    });
    expect(status).toBe(413);
  });
});
