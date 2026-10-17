import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ARCHIVE_STORAGE } from '../../../src/infra/providers/data-retention/archive-storage.port';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { S3ArchiveStorage } from '../../../src/infra/providers/data-retention/s3-archive-storage.adapter';
import {
  ArchiveEraser,
  ArchiveReader,
  DataRetentionModule,
  DataRetentionWorkerModule,
  PartitionArchiver,
} from '../../../src/modules/data-retention';
import { RetentionWorker } from '../../../src/modules/data-retention/retention.worker';
import { envSchema } from '../../../src/config/env.schema';

/** DatabaseService is global in the app; stand in for it so the module graph can be resolved without a database. */
@Global()
@Module({
  providers: [{ provide: DatabaseService, useValue: { privileged: async () => undefined } }],
  exports: [DatabaseService],
})
class FakeDatabaseModule {}

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLERK_SECRET_KEY: 'sk_test_x',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

async function build(extra: Record<string, string>, module: 'worker' | 'reader' = 'worker') {
  const parsed = envSchema.parse({ ...baseEnv, ...extra });
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => parsed] }),
      FakeDatabaseModule,
      module === 'worker' ? DataRetentionWorkerModule : DataRetentionModule,
    ],
  }).compile();
}

describe('data-retention modules', () => {
  const made: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    while (made.length) await made.pop()!.close();
  });

  it('resolves the worker graph: archiver, worker, reader and eraser share one storage', async () => {
    const ref = await build({});
    made.push(ref);
    expect(ref.get(PartitionArchiver)).toBeInstanceOf(PartitionArchiver);
    expect(ref.get(RetentionWorker)).toBeInstanceOf(RetentionWorker);
    expect(ref.get(ArchiveReader)).toBeInstanceOf(ArchiveReader);
    expect(ref.get(ArchiveEraser)).toBeInstanceOf(ArchiveEraser);
    expect(ref.get(ARCHIVE_STORAGE)).toBeInstanceOf(LocalArchiveStorage);
  });

  it('gives the API side the reader and eraser without the job that drops partitions', async () => {
    const ref = await build({}, 'reader');
    made.push(ref);
    expect(ref.get(ArchiveReader)).toBeInstanceOf(ArchiveReader);
    expect(ref.get(ArchiveEraser)).toBeInstanceOf(ArchiveEraser);
    expect(() => ref.get(PartitionArchiver)).toThrow();
    expect(() => ref.get(RetentionWorker)).toThrow();
  });

  it('binds the bucket adapter when ARCHIVE_DRIVER=s3', async () => {
    const ref = await build({
      ARCHIVE_DRIVER: 's3',
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_BUCKET_ARCHIVE: 'my-archive',
    });
    made.push(ref);
    expect(ref.get(ARCHIVE_STORAGE)).toBeInstanceOf(S3ArchiveStorage);
  });

  it('stops at boot when the bucket driver is half configured', async () => {
    await expect(build({ ARCHIVE_DRIVER: 's3' })).rejects.toThrow(/S3_ENDPOINT/);
  });

  it('reads the new settings with safe defaults: job off, dry run on, local archive', () => {
    const env = envSchema.parse(baseEnv);
    expect(env.RETENTION_ENABLED).toBe(false);
    expect(env.RETENTION_DRY_RUN).toBe(true);
    expect(env.ARCHIVE_DRIVER).toBe('local');
    expect(env.S3_BUCKET_ARCHIVE).toBe('crm-archive');
  });
});
