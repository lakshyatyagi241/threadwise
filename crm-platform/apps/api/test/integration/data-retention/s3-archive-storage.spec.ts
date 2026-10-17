import { execSync } from 'node:child_process';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  S3ArchiveError,
  S3ArchiveStorage,
  type S3ArchiveConfig,
} from '../../../src/infra/providers/data-retention/s3-archive-storage.adapter';
import { archiveStorageContract } from '../../unit/data-retention/archive-storage.contract';

/**
 * The S3 adapter against a real S3 server (MinIO), which verifies every request signature itself: a signing bug cannot pass here the
 * way it could against a fake that shares our code. Cloudflare R2 and AWS S3 speak the same protocol (SigV4, path-style, list v2).
 */
// Docker Desktop can be slow to answer right after another container-heavy run, so ask twice before giving up.
const dockerUp = (() => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 60_000 });
      return true;
    } catch {
      // try again
    }
  }
  return false;
})();
if (!dockerUp) {
  console.warn('s3-archive-storage.spec: Docker is not available, the MinIO tests are skipped');
}

const IMAGE = 'minio/minio:RELEASE.2024-10-13T13-34-11Z';
let minio: StartedTestContainer | undefined;
let base: Omit<S3ArchiveConfig, 'bucket'>;

const maybe = dockerUp ? describe : describe.skip;

maybe('S3ArchiveStorage setup', () => {
  beforeAll(async () => {
    minio = await new GenericContainer(IMAGE)
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'testkey', MINIO_ROOT_PASSWORD: 'testsecret-1234' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
      .start();
    base = {
      endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      region: 'us-east-1',
      accessKeyId: 'testkey',
      secretAccessKey: 'testsecret-1234',
      pathStyle: true,
    };
  }, 180_000);

  afterAll(async () => {
    await minio?.stop();
  });

  // The contract's own `beforeAll` runs after this one (suites run in declaration order), so `base` is set by then.
  archiveStorageContract(
    'S3 (MinIO)',
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
