import { beforeAll, describe, expect, it } from 'vitest';
import {
  S3ArchiveError,
  S3ArchiveStorage,
  type S3ArchiveConfig,
} from '../../../src/infra/providers/data-retention/s3-archive-storage.adapter';
import { archiveStorageContract } from '../../unit/data-retention/archive-storage.contract';

/**
 * The S3 adapter against a real S3-compatible server, which verifies every request signature itself: a signing bug cannot pass here the
 * way it could against a fake that shares our code. Cloudflare R2 and AWS S3 speak the same protocol (SigV4, list v2).
 * Runs only when S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY_ID and S3_TEST_SECRET_ACCESS_KEY name a test account whose token may create buckets
 * (optional S3_TEST_REGION, default `auto`; S3_TEST_PATH_STYLE=true for a store that wants path-style).
 */
const env = process.env;
const enabled = Boolean(
  env.S3_TEST_ENDPOINT && env.S3_TEST_ACCESS_KEY_ID && env.S3_TEST_SECRET_ACCESS_KEY,
);
if (!enabled) {
  console.warn('s3-archive-storage.spec: no S3_TEST_* credentials, the real-server tests are skipped');
}

let base: Omit<S3ArchiveConfig, 'bucket'>;

const maybe = enabled ? describe : describe.skip;

maybe('S3ArchiveStorage setup', () => {
  beforeAll(() => {
    base = {
      endpoint: env.S3_TEST_ENDPOINT!,
      region: env.S3_TEST_REGION ?? 'auto',
      accessKeyId: env.S3_TEST_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_TEST_SECRET_ACCESS_KEY!,
      pathStyle: env.S3_TEST_PATH_STYLE === 'true',
    };
  });

  // The contract's own `beforeAll` runs after this one (suites run in declaration order), so `base` is set by then.
  archiveStorageContract(
    'S3-compatible server',
    async () => ({ storage: new S3ArchiveStorage({ ...base, bucket: 'crm-archive-contract' }) }),
    { manyKeys: 1010 },
  );

  describe('S3ArchiveStorage specifics', () => {
    it('creates the bucket on the first write and lists an absent bucket as empty', async () => {
      const storage = new S3ArchiveStorage({ ...base, bucket: 'crm-archive-fresh' });
      expect(await storage.list('archive/')).toEqual([]);
      expect(await storage.openRead('archive/x')).toBeNull();
      await storage.putBytes('archive/x', Buffer.from('hello'));
      expect((await storage.list('archive/')).map((o) => o.key)).toEqual(['archive/x']);
    });

    it('rejects a wrong secret with the server error code, not a silent success', async () => {
      const storage = new S3ArchiveStorage({
        ...base,
        secretAccessKey: 'wrong',
        bucket: 'crm-archive-fresh',
      });
      await expect(storage.putBytes('archive/y', Buffer.from('x'))).rejects.toMatchObject({
        name: 'Error',
        status: 403,
        code: 'SignatureDoesNotMatch',
      });
      await expect(storage.putBytes('archive/y', Buffer.from('x'))).rejects.toBeInstanceOf(
        S3ArchiveError,
      );
    });
  });
});
