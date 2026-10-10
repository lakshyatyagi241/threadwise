import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluatePassword,
  isCommonPassword,
  PASSWORD_LENGTH_FLOOR,
} from '../../../src/modules/auth/support/password-policy';
import {
  checkPwnedPassword,
  resetBreachCheckBackoff,
} from '../../../src/modules/auth/support/pwned-passwords';

const policy = {
  passwordMinLength: 12,
  passwordRequireUpper: false,
  passwordRequireNumber: false,
  passwordRequireSymbol: false,
};
const rules = (pw: string, ctx = {}, p: Record<string, unknown> = {}) =>
  evaluatePassword(pw, { ...policy, ...p } as never, ctx).map((v) => v.rule);

describe('length floor', () => {
  it('never goes below 8 whatever the policy says', () => {
    expect(PASSWORD_LENGTH_FLOOR).toBe(8);
    expect(rules('Xk9$vQ2', {}, { passwordMinLength: 1 })).toContain('min_length');
    expect(rules('Xk9$vQ2m', {}, { passwordMinLength: 1 })).not.toContain('min_length');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(rules('😀😀😀😀', {}, { passwordMinLength: 8 })).toContain('min_length');
  });
});

describe('offline blocklist', () => {
  it.each([
    'password123',
    'Password1',
    'Passw0rd!',
    'P@ssw0rd#2024',
    'welcome123',
    'Welcome123!',
    'Summer2024!!',
    'Winter2026',
    '$ummer2024',
    '@dmin123',
    '123Welcome!!',
    'iloveyou',
    'qwertyuiop',
    'Qwerty12345',
    '1q2w3e4r5t',
    'abababab',
    'aaaaaaaaaaaa',
    '12341234',
    'zxcvbnmasdfgh',
    'India@123',
    'Admin@1234',
  ])('refuses %s', (pw) => {
    expect(isCommonPassword(pw)).toBe(true);
  });

  it.each([
    'Zx9Qm4Wr7Lp2',
    'correct horse battery staple',
    'purple-giraffe-juggles-42-lamps',
    'Tr1cky!Lantern#Orbit',
    'MyD0gIsCalledRexAndHeBarks',
  ])('accepts %s', (pw) => {
    expect(isCommonPassword(pw)).toBe(false);
  });

  it('refuses a password built from the email name or the person name', () => {
    expect(isCommonPassword('Zebra!priyasharma77', { email: 'priyasharma@acme.test' })).toBe(true);
    expect(isCommonPassword('Zebra!Sharma77x', { fullName: 'Priya Sharma' })).toBe(true);
    expect(isCommonPassword('Zebra!Tiger77x', { fullName: 'Priya Sharma' })).toBe(false);
  });

  it('can be switched off by the policy (and only by it)', () => {
    expect(rules('Welcome123!', {}, { passwordBlocklistEnabled: false })).not.toContain('common');
    expect(rules('Welcome123!', {}, { passwordBlocklistEnabled: true })).toContain('common');
    expect(rules('Welcome123!')).toContain('common');
  });

  it('does not throw on hostile input', () => {
    for (const s of [
      '',
      '\ud800',
      '\u0000'.repeat(20),
      'a'.repeat(5000),
      '😀'.repeat(300),
      '‮'.repeat(14),
    ]) {
      expect(() => evaluatePassword(s, policy as never, {})).not.toThrow();
    }
  });
});

describe('Pwned Passwords range lookup (k-anonymity)', () => {
  afterEach(() => resetBreachCheckBackoff());

  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const range = (rows: string[]) => async () => new Response(rows.join('\r\n'), { status: 200 });

  it('sends only the first five hex characters, with padding requested', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    await checkPwnedPassword('password', {
      endpoint: 'https://pw.test/range/',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, headers: init?.headers as Record<string, string> });
        return new Response('0018A45C4D1DEF81644B54AB7F969B88D65:1', { status: 200 });
      }) as never,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://pw.test/range/5BAA6');
    expect(seen[0]!.headers['Add-Padding']).toBe('true');
    expect(seen[0]!.url).not.toContain('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('reports a match, a miss, and ignores padding rows', async () => {
    const suffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
    const base = { endpoint: 'https://pw.test/range/' };
    expect(
      await checkPwnedPassword('password', {
        ...base,
        fetchImpl: range([`${suffix}:9545824`]) as never,
      }),
    ).toBe('breached');
    expect(
      await checkPwnedPassword('password', {
        ...base,
        fetchImpl: range(['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3']) as never,
      }),
    ).toBe('clean');
    expect(
      await checkPwnedPassword('password', { ...base, fetchImpl: range([`${suffix}:0`]) as never }),
    ).toBe('clean');
  });

  it('answers unknown on any failure and then stays quiet for a while', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    let t = 1_000_000;
    const opts = {
      endpoint: 'https://pw.test/range/',
      fetchImpl: fetchImpl as never,
      now: () => t,
    };
    expect(await checkPwnedPassword('x', opts)).toBe('unknown');
    expect(await checkPwnedPassword('y', opts)).toBe('unknown');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call skipped by the back-off
    t += 61_000;
    await checkPwnedPassword('z', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a 5xx as unknown and an empty endpoint as disabled', async () => {
    const fail = async () => new Response('nope', { status: 503 });
    expect(
      await checkPwnedPassword('x', {
        endpoint: 'https://pw.test/range/',
        fetchImpl: fail as never,
      }),
    ).toBe('unknown');
    resetBreachCheckBackoff();
    const never = vi.fn();
    expect(await checkPwnedPassword('x', { endpoint: '', fetchImpl: never as never })).toBe(
      'unknown',
    );
    expect(never).not.toHaveBeenCalled();
  });
});
