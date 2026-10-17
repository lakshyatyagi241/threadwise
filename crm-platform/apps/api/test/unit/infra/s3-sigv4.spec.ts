import { describe, expect, it } from 'vitest';
import { EMPTY_SHA256, signS3Request } from '../../../src/infra/net/s3-sigv4';
import { signRequest } from '../../../src/modules/platform-infrastructure/offsite-backup/s3-client';

/**
 * The expected values were produced by the off-host backup client's own signer before it was moved here, and the signature was accepted by a
 * real MinIO (offsite-backup and s3-archive-storage integration specs). They pin the algorithm: any change to canonicalisation or
 * encoding changes a signature and fails this.
 */
const now = new Date('2026-10-04T12:00:00Z');
const cfg = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'bk',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  pathStyle: true,
};
const auth = (sig: string) =>
  `AWS4-HMAC-SHA256 Credential=AK/20261004/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}`;

const cases = [
  {
    name: 'a PUT with a nested key',
    config: cfg,
    input: {
      method: 'PUT' as const,
      key: 'archive/an_events/2026-08/7.ndjson.gz',
      payloadSha256: 'abc123',
      now,
    },
    url: 'https://acct.r2.cloudflarestorage.com/bk/archive/an_events/2026-08/7.ndjson.gz',
    payload: 'abc123',
    signature: 'ea6b5f99808cff4fdeabcb774d82c37663e0723a7e1c5a4e6054ab1c771b6395',
  },
  {
    name: 'a bucket list with a query that needs sorting and encoding',
    config: cfg,
    input: {
      method: 'GET' as const,
      key: '',
      query: [
        ['prefix', 'archive/'],
        ['list-type', '2'],
        ['continuation-token', 'a+b/c='],
      ] as Array<[string, string]>,
      payloadSha256: 'e3b0',
      now,
    },
    url: 'https://acct.r2.cloudflarestorage.com/bk/?continuation-token=a%2Bb%2Fc%3D&list-type=2&prefix=archive%2F',
    payload: 'e3b0',
    signature: '72286044250e79d81e6de04021d41443be0efe8595b5f8659185233b262e7d82',
  },
  {
    name: 'a DELETE addressed by virtual host',
    config: { ...cfg, pathStyle: false, endpoint: 'http://minio.local:9000' },
    input: { method: 'DELETE' as const, key: 'a b/c', payloadSha256: 'x', now },
    url: 'http://bk.minio.local:9000/a%20b/c',
    payload: 'x',
    signature: '1eca441fd63272dc17a0236a1663faf8b24b022cf56d898af38bfea8f332bfa0',
  },
];

describe('shared S3 SigV4 signer', () => {
  for (const c of cases) {
    it(`signs ${c.name} exactly as before, directly and through the offsite client`, () => {
      for (const sign of [signS3Request, signRequest]) {
        const { url, headers } = sign(c.config, c.input);
        expect(url.toString()).toBe(c.url);
        expect(headers).toEqual({
          'x-amz-date': '20261004T120000Z',
          'x-amz-content-sha256': c.payload,
          authorization: auth(c.signature),
        });
      }
    });
  }

  it('exports the SHA-256 of an empty body', () => {
    expect(EMPTY_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
