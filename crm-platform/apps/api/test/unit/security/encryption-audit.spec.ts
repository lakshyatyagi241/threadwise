import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { hash, verify } from '@node-rs/argon2';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { PasswordService } from '../../../src/modules/auth/security/password.service';

/**
 * Encryption audit (security item 35). What is pinned here: the properties of the one place secrets are sealed (CryptoService), the
 * password hash and the dummy hash that hides which accounts exist, and source guards for the mistakes that are easy to make
 * again: weak randomness for a secret, a signature compared with `===`.
 */
const key = () => randomBytes(32).toString('base64');
const svc = (k = key(), previous = '') =>
  new CryptoService({
    get: (name: string) => (name === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? previous : k),
  } as unknown as ConfigService<never, true>);

describe('CryptoService (AES-256-GCM)', () => {
  it('never repeats an IV across many encryptions (a repeated IV under one key breaks GCM)', () => {
    const c = svc();
    const ivs = new Set<string>();
    for (let i = 0; i < 5000; i++) ivs.add(c.encrypt('same plaintext').split(':')[1]!);
    expect(ivs.size).toBe(5000);
  });

  it('the stored blob does not contain the plaintext or the key', () => {
    const k = key();
    const blob = svc(k).encrypt('EAAG-super-secret-access-token');
    expect(blob).not.toContain('EAAG');
    expect(blob).not.toContain('super-secret');
    expect(blob).not.toContain(k);
    expect(blob.split(':')[0]).toBe('v1');
  });

  it('the key id names a key without revealing it (8 hex characters of its SHA-256)', () => {
    const k = key();
    const id = svc(k).currentKeyId;
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(Buffer.from(k, 'base64').toString('hex')).not.toContain(id);
  });

  it.each(['ciphertext', 'tag', 'iv'] as const)('refuses a blob whose %s was altered', (part) => {
    const c = svc();
    const [v, iv, tag, ct, id] = c.encrypt('a secret value').split(':') as [
      string,
      string,
      string,
      string,
      string,
    ];
    const altered = {
      ciphertext: [v, iv, tag, flip(ct), id],
      tag: [v, iv, flip(tag), ct, id],
      iv: [v, flip(iv), tag, ct, id],
    }[part];
    expect(() => c.decrypt(altered.join(':'))).toThrow();
  });

  it('refuses a truncated blob, a wrong version and a missing part', () => {
    const c = svc();
    const blob = c.encrypt('x');
    expect(() => c.decrypt(blob.slice(0, blob.length - 14))).toThrow();
    expect(() => c.decrypt(blob.replace(/^v1/, 'v2'))).toThrow(/malformed/);
    expect(() => c.decrypt('v1:aa:bb')).toThrow(/malformed/);
    expect(() => c.decrypt('')).toThrow(/malformed/);
    expect(() => c.decrypt(undefined as unknown as string)).toThrow(/malformed/);
  });

  it('a blob sealed under another key is refused, not decrypted to garbage', () => {
    const blob = svc().encrypt('secret');
    expect(() => svc().decrypt(blob)).toThrow();
    // Same blob with the key id stripped (the pre-rotation shape) is tried against the ring and still refused.
    expect(() => svc().decrypt(blob.split(':').slice(0, 4).join(':'))).toThrow();
  });

  it('round-trips awkward plaintexts: empty, unicode, emoji, a very long value', () => {
    const c = svc();
    for (const s of ['', 'ü日本語🔒', 'a'.repeat(100_000), '{"k":"v"}\n\u0000end']) {
      expect(c.decrypt(c.encrypt(s))).toBe(s);
    }
  });

  it('opens a blob from a retired key and re-seals it under the current one', () => {
    const oldKey = key();
    const sealedOld = svc(oldKey).encrypt('rotate me');
    const ring = svc(key(), oldKey);
    expect(ring.decrypt(sealedOld)).toBe('rotate me');
    expect(ring.isCurrent(sealedOld)).toBe(false);
    const re = ring.reencrypt(sealedOld);
    expect(ring.isCurrent(re)).toBe(true);
    expect(ring.decrypt(re)).toBe('rotate me');
  });
});

function flip(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  buf[0] = buf[0]! ^ 0x01;
  return buf.toString('base64');
}

describe('password hashing', () => {
  const policy = { policy: async () => ({}) } as never;
  const service = new PasswordService(policy);

  it('is argon2id with a fresh salt each time', async () => {
    const a = await service.hash('correct horse battery staple');
    const b = await service.hash('correct horse battery staple');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    expect(a).not.toBe(b);
    expect(await verify(a, 'correct horse battery staple')).toBe(true);
    expect(await verify(a, 'correct horse battery stapl3')).toBe(false);
  });

  it('meets the OWASP floor for argon2id (at least 19 MiB, 2 passes)', async () => {
    const p = /m=(\d+),t=(\d+),p=(\d+)/.exec(await hash('x'))!;
    expect(Number(p[1])).toBeGreaterThanOrEqual(19 * 1024);
    expect(Number(p[2])).toBeGreaterThanOrEqual(2);
  });

  it('an account that does not exist is judged against a hash with the SAME cost, so timing does not reveal it', async () => {
    const real = /m=(\d+),t=(\d+),p=(\d+)/.exec(await hash('x'))!.slice(1);
    // The constant is private; read it from the source so the test cannot drift from it.
    const src = readFileSync(
      resolve(__dirname, '../../../src/modules/auth/security/password.service.ts'),
      'utf8',
    );
    const dummy = /DUMMY_HASH =\s*'(\$argon2id[^']+)'/.exec(src)![1]!;
    expect(/m=(\d+),t=(\d+),p=(\d+)/.exec(dummy)!.slice(1)).toEqual(real);
    // It must be a hash the verifier actually evaluates (a malformed one throws at once and is fast).
    await expect(verify(dummy, 'anything')).resolves.toBe(false);
    expect(await service.verifyOrDummy(null, 'anything')).toBe(false);
    expect(await service.verifyOrDummy(undefined, 'anything')).toBe(false);
    expect(await service.verifyOrDummy('not-a-hash', 'anything')).toBe(false);
  });
});

const SRC = resolve(__dirname, '../../../src');
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const ALL = files(SRC).map((p) => ({
  p: relative(SRC, p).split(sep).join('/'),
  s: readFileSync(p, 'utf8'),
}));

describe('source guards', () => {
  it('no secret, token, key or code is made with Math.random', () => {
    const SECURITY_DIRS = [
      'modules/auth/',
      'common/crypto/',
      'modules/developer-rest-api-v1/',
      'modules/public-api/',
      'modules/outbound-webhooks/',
      'modules/webhook-fanout/',
      'modules/waboo-migration/',
      'modules/platform-infrastructure/offsite-backup/',
      'realtime/',
    ];
    const bad = ALL.filter(
      ({ p, s }) => SECURITY_DIRS.some((d) => p.startsWith(d)) && /Math\.random\(/.test(s),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('md5 and sha1 are used only where the protocol or a cache key asks for them, never to protect a secret', () => {
    const ALLOWED = new Set([
      'modules/auth/support/totp.ts', // RFC 6238 HMAC-SHA1
      'modules/auth/support/pwned-passwords.ts', // the k-anonymity range API is keyed by SHA-1
      'modules/auth/account/account.service.ts', // ETag of an avatar
      'modules/admin-console-shell/workspace-settings.service.ts', // ETag
      'modules/chatbot-widget/widgets.service.ts', // ETag
      'modules/forms-builder/form-public.service.ts', // ETag
      'modules/platform-infrastructure/offsite-backup/sync.ts', // S3 Content-MD5
      'modules/localization-translation/translation-policy.ts', // cache key of a text
      'modules/storefront-builder/cli/demo-seeder.ts', // deterministic demo id
      'infra/providers/channel-email/graph-normalise.ts', // synthetic message id
      'infra/providers/channel-email/mime-parse.ts', // synthetic message id
      'infra/providers/auth-registration-security/avatar-download.ts', // ETag of an avatar
      'modules/channel-wechat/wechat-rules.ts', // WeChat's request signature is SHA-1 over token, timestamp and nonce, fixed by its protocol
      'infra/providers/channel-sms/twilio-signature.ts', // Twilio's request signature is HMAC-SHA1 by their specification
      'infra/providers/chat-conversations/simulator.adapter.ts', // synthetic message id of the simulator
      'infra/providers/platform-payment-gateways/europe.drivers.ts', // the gateway's own request hash, fixed by its API
      'infra/providers/platform-payment-gateways/us.drivers.ts', // the gateway's own request hash, fixed by its API
      'infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store.ts', // short key for a recipient in a rate-limit counter, not a protection
      'modules/team-inbox-routing-sla/routing-engine.service.ts', // a deterministic uuid (v5 shape) from a seed, not a protection
      'modules/team-inbox-routing-sla/handoff.service.ts', // the same deterministic uuid (v5 shape) from a seed so a retry sends nothing twice, not a protection
    ]);
    const bad = ALL.filter(
      ({ p, s }) => /create(Hash|Hmac)\(\s*['"](md5|sha1)['"]/.test(s) && !ALLOWED.has(p),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('every file that computes an HMAC to CHECK a caller compares it in constant time', () => {
    // Files that only SIGN (outbound requests, cloud storage, demo data) or derive a value are listed; a new file that computes an
    // HMAC must either compare with timingSafeEqual or be added here with the reason.
    const SIGN_ONLY = new Set([
      'modules/auth/support/totp.ts', // the code is compared after a step window and an attempt limiter
      'modules/webhook-fanout/webhook-targets.service.ts', // signs outbound
      'modules/platform-infrastructure/offsite-backup/s3-client.ts', // signs requests to the bucket
      'modules/forms-builder/form-key.ts', // a keyed hash of an IP, never compared with input
      'infra/providers/marketplace/pull.connector.ts', // signs outbound
      'infra/net/s3-sigv4.ts', // AWS Signature V4 for requests we send to a bucket
      'infra/providers/platform-settings-branding-storage/object-storage.probe.ts', // signs requests to the bucket
    ]);
    const bad = ALL.filter(
      ({ p, s }) =>
        /createHmac\(/.test(s) &&
        !/timingSafeEqual|safeEqual|constantTime/.test(s) &&
        !SIGN_ONLY.has(p),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('only CryptoService and the backup seal use the raw cipher API', () => {
    const bad = ALL.filter(
      ({ p, s }) =>
        /createCipheriv\(|createDecipheriv\(/.test(s) &&
        ![
          'common/crypto/crypto.service.ts',
          'modules/platform-infrastructure/offsite-backup/seal.ts',
          'infra/providers/platform-payment-gateways/india.drivers.ts', // a gateway's own payload encryption, required by its API
          'modules/channel-wechat/wechat-rules.ts', // decrypts WeChat's AES-256-CBC inbound messages, the cipher its protocol fixes (never used for stored data)
        ].includes(p),
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });

  it('no cipher in the code uses a mode without authentication (ECB, CBC, CTR) for stored data', () => {
    const bad = ALL.filter(
      ({ p, s }) =>
        /createCipheriv\(\s*['"]aes-\d+-(ecb|cbc|ctr)/i.test(s) &&
        p !== 'infra/providers/platform-payment-gateways/india.drivers.ts',
    ).map((f) => f.p);
    expect(bad).toEqual([]);
  });
});
