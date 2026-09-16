import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';

/**
 * Writes openapi.json without starting a listener.
 *
 * CI runs this and fails if the committed spec is stale, so the frontend's
 * generated client can never silently drift from the routes that actually
 * exist.
 */
async function emit(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('CRM Platform API').setVersion('0.1.0').addBearerAuth().build(),
  );

  const target = resolve(__dirname, '../../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();

  console.log(`openapi spec written to ${target}`);
}

void emit();
