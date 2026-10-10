import { beforeEach, describe, expect, it, vi } from 'vitest';

const lib = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => lib);

import { MAX_PASSKEYS, WebAuthnService } from '../../../src/modules/auth/security/webauthn.service';

const user = { pool: 'user' as const, orgId: 1, userId: 7 };
const credRow = (over: Record<string, unknown> = {}) => ({
  uuid: '11111111-1111-4111-8111-111111111111',
  credential_id: 'cred-1',
  public_key: Buffer.from([1, 2, 3]),
  counter: 5,
  transports: ['usb'],
  device_type: 'singleDevice',
  backed_up: false,
  name: 'YubiKey',
  created_at: new Date('2026-10-01T00:00:00Z'),
  last_used_at: null,
  ...over,
});

function build(rows: unknown[] = []) {
  const executed: string[] = [];
  const execute = vi.fn(async (q: { queryChunks?: unknown[] }) => {
    executed.push(JSON.stringify(q).slice(0, 400));
    const text = executed[executed.length - 1]!;
    if (/INSERT INTO/.test(text))
      return { rows: [credRow({ uuid: '22222222-2222-4222-8222-222222222222' })] };
    if (/DELETE FROM/.test(text)) return { rows: [{}] };
    if (/UPDATE /.test(text)) return { rows: [] };
    return { rows };
  });
  const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({ execute }) };
  const store = { tx: async (fn: (tx: unknown) => unknown) => fn({ execute }) };
  const redisData = new Map<string, string>();
  const redis = {
    setex: async (k: string, _t: number, v: string) => void redisData.set(k, v),
    getdel: async (k: string) => {
      const v = redisData.get(k) ?? null;
      redisData.delete(k);
      return v;
    },
  };
  const audit = { recordStandalone: vi.fn(async () => undefined) };
  const cfg = {
    get: (k: string) =>
      ({
        WEB_APP_URL: 'https://app.example.test',
        APP_NAME: 'CRM',
        WEBAUTHN_RP_ID: undefined,
        WEBAUTHN_ORIGINS: 'https://www.example.test',
      })[k],
  };
  const svc = new WebAuthnService(
    db as never,
    store as never,
    audit as never,
    redis as never,
    cfg as never,
  );
  return { svc, redisData, audit, execute };
}

beforeEach(() => vi.clearAllMocks());

describe('registration', () => {
  it('stores a single-use challenge, excludes existing credentials and never uses the email as the user handle', async () => {
    const { svc, redisData } = build([credRow()]);
    lib.generateRegistrationOptions.mockResolvedValue({ challenge: 'chal-1', rp: {} });
    await svc.registrationOptions(user, { userName: 'ana@acme.test', displayName: 'Ana' });
    const args = lib.generateRegistrationOptions.mock.calls[0]![0];
    expect(args.rpID).toBe('app.example.test');
    expect(args.attestationType).toBe('none');
    expect(args.excludeCredentials).toEqual([{ id: 'cred-1', transports: ['usb'] }]);
    expect(Buffer.from(args.userID).toString()).not.toContain('ana@acme.test');
    expect([...redisData.values()]).toEqual(['chal-1']);
  });

  it('refuses an eleventh passkey', async () => {
    const rows = Array.from({ length: MAX_PASSKEYS }, (_, i) =>
      credRow({ credential_id: `c${i}` }),
    );
    const { svc } = build(rows);
    await expect(
      svc.registrationOptions(user, { userName: 'a', displayName: 'a' }),
    ).rejects.toMatchObject({
      code: 'AUTH_PASSKEY_LIMIT',
    });
  });

  it('needs a pending challenge, accepts the right origins, and stores only the verified key', async () => {
    const { svc, redisData } = build([]);
    await expect(svc.register(user, { id: 'x' }, 'Key')).rejects.toMatchObject({
      code: 'AUTH_MFA_SETUP_EXPIRED',
    });

    lib.generateRegistrationOptions.mockResolvedValue({ challenge: 'chal-2' });
    await svc.registrationOptions(user, { userName: 'a', displayName: 'a' });
    lib.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-new',
          publicKey: new Uint8Array([9, 9]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });
    const item = await svc.register(user, { id: 'cred-new' }, 'Laptop');
    expect(item).toMatchObject({ id: '22222222-2222-4222-8222-222222222222', lastUsedAt: null });
    const verifyArgs = lib.verifyRegistrationResponse.mock.calls[0]![0];
    expect(verifyArgs.expectedChallenge).toBe('chal-2');
    expect(verifyArgs.expectedOrigin).toEqual([
      'https://app.example.test',
      'https://www.example.test',
    ]);
    expect(redisData.size).toBe(0); // the challenge was consumed
    // the same challenge cannot be replayed
    await expect(svc.register(user, { id: 'cred-new' }, 'Laptop')).rejects.toMatchObject({
      code: 'AUTH_MFA_SETUP_EXPIRED',
    });
  });

  it('turns a library failure into a plain refusal', async () => {
    const { svc } = build([]);
    lib.generateRegistrationOptions.mockResolvedValue({ challenge: 'c' });
    await svc.registrationOptions(user, { userName: 'a', displayName: 'a' });
    lib.verifyRegistrationResponse.mockRejectedValue(new Error('origin mismatch'));
    await expect(svc.register(user, {}, 'K')).rejects.toMatchObject({
      code: 'AUTH_PASSKEY_INVALID',
    });
  });
});

describe('sign-in assertion', () => {
  const assertion = { id: 'cred-1', response: {} };

  it('refuses without a pending challenge, for an unknown credential, and for a bad signature', async () => {
    const { svc } = build([credRow()]);
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(false); // no challenge yet
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'a1' });
    await svc.loginOptions(user, 'k');
    expect(await svc.verifyLogin(user, 'k', { id: 'someone-elses' })).toBe(false);
    await svc.loginOptions(user, 'k');
    lib.verifyAuthenticationResponse.mockRejectedValue(new Error('bad signature'));
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(false);
  });

  it('accepts a valid assertion once: the challenge is consumed first', async () => {
    const { svc } = build([credRow({ counter: 5 })]);
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'a2' });
    await svc.loginOptions(user, 'k');
    lib.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(true);
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(false);
  });

  it('refuses a counter that did not advance and records a clone warning', async () => {
    const { svc, audit } = build([credRow({ counter: 5 })]);
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'a3' });
    await svc.loginOptions(user, 'k');
    lib.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(false);
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.passkey_clone_suspected', status: 'warning' }),
    );
  });

  it('allows authenticators that never count (0 stays 0)', async () => {
    const { svc } = build([credRow({ counter: 0 })]);
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'a4' });
    await svc.loginOptions(user, 'k');
    lib.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    });
    expect(await svc.verifyLogin(user, 'k', assertion)).toBe(true);
  });

  it('offers no options to someone with no passkey', async () => {
    const { svc } = build([]);
    await expect(svc.loginOptions(user, 'k')).rejects.toMatchObject({
      code: 'AUTH_PASSKEY_INVALID',
    });
  });
});

describe('operators use the platform table and event names', () => {
  it('audits under the platform namespace', async () => {
    const { svc, audit } = build([credRow({ counter: 5 })]);
    const op = { pool: 'operator' as const, operatorId: 3 };
    lib.generateAuthenticationOptions.mockResolvedValue({ challenge: 'a5' });
    await svc.loginOptions(op, 'k');
    lib.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });
    await svc.verifyLogin(op, 'k', { id: 'cred-1' });
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'platform.auth.passkey_clone_suspected',
        actorType: 'platform_operator',
      }),
    );
  });
});
