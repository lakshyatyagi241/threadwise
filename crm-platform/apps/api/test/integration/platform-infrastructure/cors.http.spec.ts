import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { corsOriginFor } from '../../../src/modules/platform-infrastructure';

@Controller()
class PingController {
  @Get('ping') ping() {
    return { ok: true };
  }
}

const apps: NestExpressApplication[] = [];
async function boot(origins: string[], nodeEnv: string) {
  const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // the same call main.ts makes
  app.enableCors({
    origin: corsOriginFor(origins, nodeEnv),
    credentials: true,
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  await app.init();
  apps.push(app);
  return supertest(app.getHttpServer());
}
afterAll(async () => {
  for (const a of apps) await a.close();
});

const ORIGIN = 'https://evil.example';

describe('CORS over HTTP', () => {
  it('answers a listed origin, with credentials and the exposed headers', async () => {
    const http = await boot(['https://desk.example'], 'production');
    const res = await http.get('/ping').set('origin', 'https://desk.example');
    expect(res.headers['access-control-allow-origin']).toBe('https://desk.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('retry-after');
  });

  it('gives an unlisted origin nothing to read with when a list is set', async () => {
    const http = await boot(['https://desk.example'], 'production');
    const res = await http.get('/ping').set('origin', ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses every browser origin in production with no list, preflight included', async () => {
    const http = await boot([], 'production');
    const get = await http.get('/ping').set('origin', ORIGIN);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    expect(get.headers['access-control-allow-credentials']).toBeUndefined();
    const preflight = await http
      .options('/ping')
      .set('origin', ORIGIN)
      .set('access-control-request-method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still serves same-origin and server-to-server calls (no Origin header) in production with no list', async () => {
    const http = await boot([], 'production');
    expect((await http.get('/ping')).status).toBe(200);
  });

  it('reflects any origin in development with no list, so a local web app just works', async () => {
    const http = await boot([], 'development');
    const res = await http.get('/ping').set('origin', 'http://localhost:3001');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });
});
