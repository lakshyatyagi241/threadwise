import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Needed for webhook and public-API signature verification: the HMAC is
    // computed over the bytes as sent, and re-serialising parsed JSON changes
    // them (key order, whitespace, number formatting).
    rawBody: true,
  });

  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('bootstrap');

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
  app.enableShutdownHooks();

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

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
