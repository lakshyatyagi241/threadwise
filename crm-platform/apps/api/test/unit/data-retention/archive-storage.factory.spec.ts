import { describe, expect, it } from 'vitest';
import {
  createArchiveStorage,
  type ArchiveEnv,
} from '../../../src/infra/providers/data-retention/archive-storage.factory';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { S3ArchiveStorage } from '../../../src/infra/providers/data-retention/s3-archive-storage.adapter';

const env = (over: Partial<ArchiveEnv> = {}): ArchiveEnv => ({
  ARCHIVE_DRIVER: 'local',
  S3_REGION: 'us-east-1',
  S3_BUCKET_ARCHIVE: 'crm-archive',
  S3_FORCE_PATH_STYLE: true,
  ...over,
});

describe('createArchiveStorage', () => {
  it('uses the local directory driver by default', () => {
    expect(createArchiveStorage(env())).toBeInstanceOf(LocalArchiveStorage);
  });

  it('builds the S3 adapter when the bucket is fully configured', () => {
    const storage = createArchiveStorage(
      env({
        ARCHIVE_DRIVER: 's3',
        S3_ENDPOINT: 'http://objects:9000',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    );
    expect(storage).toBeInstanceOf(S3ArchiveStorage);
  });

  it('fails at boot, naming the missing settings, when the S3 driver is half configured', () => {
    expect(() => createArchiveStorage(env({ ARCHIVE_DRIVER: 's3' }))).toThrow(/S3_ENDPOINT/);
    expect(() =>
      createArchiveStorage(
        env({ ARCHIVE_DRIVER: 's3', S3_ENDPOINT: 'http://objects:9000', S3_ACCESS_KEY_ID: 'k' }),
      ),
    ).toThrow(/S3_SECRET_ACCESS_KEY/);
  });
});
