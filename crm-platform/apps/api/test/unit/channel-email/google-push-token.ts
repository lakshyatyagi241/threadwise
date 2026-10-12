import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/** Test helpers for Gmail push: a locally generated RSA key, a fake Google JWKS endpoint and a signer for push tokens. */
export const AUDIENCE = 'https://api.example.test/v2/public/email/google/push';
export const SERVICE_ACCOUNT = 'gmail-push@project.iam.gserviceaccount.com';

const b64u = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export function newKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' },
  };
}

export function signToken(
  key: TestKey,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  nowS = Math.floor(Date.now() / 1000),
): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }));
  const body = b64u(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: nowS,
      exp: nowS + 3600,
      ...claims,
    }),
  );
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

export class FakeJwks {
  keys: TestKey[] = [];
  hits = 0;
  maxAge = 3600;
  private server!: Server;
  url = '';

  static async start(keys: TestKey[]): Promise<FakeJwks> {
    const j = new FakeJwks();
    j.keys = keys;
    j.server = createServer((_req, res) => {
      j.hits += 1;
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${j.maxAge}`,
      });
      res.end(JSON.stringify({ keys: j.keys.map((k) => k.jwk) }));
    });
    await new Promise<void>((r) => j.server.listen(0, '127.0.0.1', r));
    j.url = `http://127.0.0.1:${(j.server.address() as AddressInfo).port}/certs`;
    return j;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
