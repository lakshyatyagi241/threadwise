import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { ARCHIVE_STORAGE } from '../../infra/providers/data-retention/archive-storage.port';
import { createArchiveStorage } from '../../infra/providers/data-retention/archive-storage.factory';
import { ArchiveEraser } from './archive-eraser.service';
import { ArchiveReader } from './archive-reader.service';

/**
 * Read access to the cold archive (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6): the storage binding and
 * the reader. Imported by the modules that serve history past the live window. The job that writes the archive lives in
 * DataRetentionWorkerModule, which only the worker process imports.
 */
@Module({
  providers: [
    {
      provide: ARCHIVE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createArchiveStorage({
          ARCHIVE_DRIVER: config.get('ARCHIVE_DRIVER', { infer: true }),
          ARCHIVE_LOCAL_DIR: config.get('ARCHIVE_LOCAL_DIR', { infer: true }),
          S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
          S3_REGION: config.get('S3_REGION', { infer: true }),
          S3_BUCKET_ARCHIVE: config.get('S3_BUCKET_ARCHIVE', { infer: true }),
          S3_ACCESS_KEY_ID: config.get('S3_ACCESS_KEY_ID', { infer: true }),
          S3_SECRET_ACCESS_KEY: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
          S3_FORCE_PATH_STYLE: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
        }),
    },
    ArchiveReader,
    ArchiveEraser,
  ],
  exports: [ARCHIVE_STORAGE, ArchiveReader, ArchiveEraser],
})
export class DataRetentionModule {}
