import { resolve } from 'node:path';
import type { ArchiveStorage } from './archive-storage.port';
import { LocalArchiveStorage } from './local-archive-storage.adapter';
import { S3ArchiveStorage } from './s3-archive-storage.adapter';

/** The settings the archive store reads; a subset of the validated environment. */
export interface ArchiveEnv {
  ARCHIVE_DRIVER: 'local' | 's3';
  ARCHIVE_LOCAL_DIR?: string;
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET_ARCHIVE: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
}

/** Picks the adapter named by `ARCHIVE_DRIVER`. A half-configured bucket is an error at boot, not at the first night the job runs. */
export function createArchiveStorage(env: ArchiveEnv): ArchiveStorage {
  if (env.ARCHIVE_DRIVER === 'local') {
    return new LocalArchiveStorage(resolve(env.ARCHIVE_LOCAL_DIR?.trim() || '.archive'));
  }
  const {
    S3_ENDPOINT: endpoint,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'ARCHIVE_DRIVER=s3 needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    );
  }
  return new S3ArchiveStorage({
    endpoint,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET_ARCHIVE,
    accessKeyId,
    secretAccessKey,
    pathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
