import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { AppModule } from './app.module';
import { FormsPreflightMiddleware } from './modules/forms-builder';
import {
  ApiV1DocsService,
  CUSTOMER_API_CORS,
  isCustomerApiPath,
} from './modules/developer-rest-api-v1';
import {
  corsIsClosedInProduction,
  corsOriginFor,
  initSentry,
  installBodyLimits,
  installProcessHandlers,
} from './modules/platform-infrastructure';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // First, so a failure while the application is still being built is reported too (WD-INFRA-018).
  installProcessHandlers('api');
  initSentry('api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Needed for webhook and public-API signature verification: the HMAC is
    // computed over the bytes as sent, and re-serialising parsed JSON changes
    // them (key order, whitespace, number formatting).
    rawBody: true,
  });

  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('bootstrap');

  // Client IP for lockout, allowlist and audit: believe only the configured proxies.
  const trust = config.get('TRUST_PROXY', { infer: true });
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    /^\d+$/.test(trust)
      ? Number(trust)
      : trust.includes(',')
        ? trust.split(',').map((s) => s.trim())
        : trust,
  );

  // Body-size limits per route class (WD-INFRA-020): before anything reads a body.
  installBodyLimits(app);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  // The customer API's OpenAPI document (`GET /docs/api.json`) is generated from the live application, in every environment.
  app.get(ApiV1DocsService).attach(app);
  app.enableShutdownHooks();

  const origins = config.get('CORS_ORIGINS', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  if (corsIsClosedInProduction(origins, nodeEnv)) {
    logger.warn('CORS_ORIGINS is empty in production: browsers on other origins are refused');
  }
  if (origins.length === 0 && nodeEnv !== 'production') {
    // Development convenience (cors-policy.ts): every origin is allowed WITH credentials. Fine on a laptop, a hole on any
    // server other people can reach. Name the origins, and set NODE_ENV=production on every deployed environment.
    logger.warn(
      'CORS_ORIGINS is empty and NODE_ENV is not production: ANY origin may call this API with credentials. Never run a shared or staging server like this.',
    );
  }
  // The Forms add-on answers the CORS preflight of its public routes from each form's own allow-list: before the API-wide policy below,
  // which only knows the web app's origins and would refuse a customer's page.
  app.use((req: Request, res: Response, next: NextFunction) => {
    void app.get(FormsPreflightMiddleware).use(req, res, next);
  });
  const staffCors = {
    origin: corsOriginFor(origins, nodeEnv),
    credentials: true,
    // The throttle's headers (WD-INFRA-010): a browser client reads them only if they are exposed.
    exposedHeaders: [
      'x-request-id',
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  };
  // The customer API (`/api/v1`, `/docs/api.json`) answers every origin without credentials; everything else keeps the staff policy.
  app.enableCors((req: { url?: string }, callback) =>
    callback(null, isCustomerApiPath(req.url) ? CUSTOMER_API_CORS : staffCors),
  );

  // Redis adapter for socket.io: without it, a message emitted on one pod
  // never reaches a socket held by another.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis(config.get('REDIS_URL', { infer: true }));
  app.useWebSocketAdapter(redisAdapter);

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CRM Platform API')
        .setDescription(
          'Multi-tenant CRM platform. Internal routes are /v1; the external contract is /public/v1 and is versioned separately.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .addTag('auth')
        // 'users' / 'roles' / 'permissions' stay off this list — per
        // docs/phase-plan.md, a page's tag is added only once every route in
        // its docs/api-inventory.md row is built and has a
        // docs/api-testing.md entry. Their controllers carry
        // @ApiExcludeController() until then.
        .addTag('contacts')
        .addTag('field-sections')
        .addTag('fields')
        .addTag('status-options')
        .addTag('tags')
        .addTag('contact-views')
        .addTag('contact-notes')
        .addTag('contact-files')
        .addTag('contact-activities')
        .addTag('contact-meetings')
        .addTag('partner-portal')
        .addTag('public-api')
        .addTag('health')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on :${port}`);
  logger.log(`Docs at ${config.get('APP_URL', { infer: true })}/docs`);
}

void bootstrap();
