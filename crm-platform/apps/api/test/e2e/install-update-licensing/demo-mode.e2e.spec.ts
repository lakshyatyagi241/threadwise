import {
  Controller,
  Delete,
  Get,
  Post,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { INST_ENV, readInstEnv } from '../../../src/config/domains/install-update-licensing.env';
import {
  DemoModeGuard,
  DemoSafe,
} from '../../../src/modules/install-update-licensing/demo-mode.guard';

/**
 * The demo guard on real Nest routing (WD-INST-029). The unit tests feed the policy fake contexts; this one proves
 * that the route pattern the guard reads (`req.route.path`) is what Nest actually registers for a versioned
 * controller, which is the assumption the exact-match allow-list rests on.
 */
@Controller({ path: 'auth', version: '2' })
class FakeAuthController {
  @Post('login')
  login() {
    return { ok: true };
  }
  @Post('signup')
  signup() {
    return { ok: true };
  }
}

@Controller({ path: 'contacts', version: '2' })
class FakeContactsController {
  @Get()
  list() {
    return [];
  }
  @Delete(':id')
  remove() {
    return { deleted: true };
  }
  @Post()
  @DemoSafe()
  scratch() {
    return { created: true };
  }
  @Post('import')
  importAll() {
    return { imported: true };
  }
}

async function appWith(demo: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [FakeAuthController, FakeContactsController],
    providers: [
      { provide: INST_ENV, useValue: readInstEnv({ DEMO_MODE: demo ? 'true' : 'false' }) },
      { provide: APP_GUARD, useClass: DemoModeGuard },
      { provide: APP_FILTER, useClass: ProblemExceptionFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  await app.init();
  return app;
}

describe('demo guard on real routes', () => {
  let demo: INestApplication;
  let live: INestApplication;
  beforeAll(async () => {
    demo = await appWith(true);
    live = await appWith(false);
  });
  afterAll(async () => {
    await demo.close();
    await live.close();
  });

  it('refuses writes with a problem+json DEMO_MODE_BLOCKED', async () => {
    const res = await request(demo.getHttpServer()).delete('/v2/contacts/123');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe(ERROR_CODES.DEMO_MODE_BLOCKED);

    expect((await request(demo.getHttpServer()).post('/v2/contacts/import')).status).toBe(403);
    expect((await request(demo.getHttpServer()).post('/v2/auth/signup')).status).toBe(403);
  });

  it('keeps reads, sign-in and @DemoSafe routes working', async () => {
    expect((await request(demo.getHttpServer()).get('/v2/contacts')).status).toBe(200);
    expect((await request(demo.getHttpServer()).post('/v2/auth/login')).status).toBe(201);
    expect((await request(demo.getHttpServer()).post('/v2/contacts')).status).toBe(201);
  });

  it('does nothing when DEMO_MODE is off', async () => {
    expect((await request(live.getHttpServer()).delete('/v2/contacts/123')).status).toBe(200);
    expect((await request(live.getHttpServer()).post('/v2/auth/signup')).status).toBe(201);
  });
});
