import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../common/openapi';

/**
 * Writes openapi.json without starting a listener.
 *
 * Meant for a CI check that the committed spec is not stale; no workflow runs it today, and no spec is committed. The contract tests
 * (`test/e2e/contract`) build the same document from the test app and check it instead.
 */
async function emit(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  // The same versioning and the same document as main.ts serves at /docs (it used to build a bare document under version 1).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });

  const document = buildOpenApiDocument(app);

  const target = resolve(__dirname, '../../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();

  console.log(`openapi spec written to ${target}`);
}

void emit();
