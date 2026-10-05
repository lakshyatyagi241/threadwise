import { describe, expect, it } from 'vitest';
import { redact } from '../../../src/modules/auth/security/auth-audit.service';
import { riskDetail } from '../../../src/modules/auth/platform/security-center.service';

describe('audit redaction (WD-AUTH-046)', () => {
  it('keeps plain counts under secret-sounding names but still hides numeric secrets', () => {
    expect(redact({ byRotator: { webhooks: 4 }, rotated: 4 })).toEqual({
      byRotator: { webhooks: 4 },
      rotated: 4,
    });
    expect(redact({ code: 123456, token: 99, password: 1234 })).toEqual({
      code: '[REDACTED]',
      token: '[REDACTED]',
      password: '[REDACTED]',
    });
  });

  it.each([
    'password',
    'currentPassword',
    'client_secret',
    'apiKey',
    'api-key',
    'access_key',
    'accessKey',
    'private_key',
    'ti_vapid_private',
    'signing_secret',
    'signingKey',
    'bearer',
    'webhook_url',
    'webhookSecret',
    'credential_json',
    'authorization',
    'refresh_token',
    'cookie',
    'otp_code',
    'recoveryCode',
    'code',
  ])('replaces the value of %s', (key) => {
    expect(redact({ [key]: 'value' })).toEqual({ [key]: '[REDACTED]' });
  });

  it('keeps null, empty and false values: there is nothing to hide, and "cleared" is information', () => {
    expect(
      redact({ password: null, token: '', secret: false, apiKey: [], private_key: {} }),
    ).toEqual({ password: null, token: '', secret: false, apiKey: [], private_key: {} });
  });

  it('does not redact look-alikes that carry no secret', () => {
    const payload = {
      country_code: 'IN',
      statusCode: 404,
      bypass: true,
      passes: 3,
      credential_keys_set: ['clientId'],
      missing_keys: ['secret'],
      changed_keys: ['token'],
    };
    expect(redact(payload)).toEqual(payload);
  });

  it('keeps the password-POLICY settings readable in a policy diff (WD-AUTH-035)', () => {
    const diff = {
      fields: ['passwordMinLength', 'passwordRequireSymbol', 'passwordMaxAgeDays'],
      changes: {
        passwordMinLength: { from: 8, to: 12 },
        passwordRequireSymbol: { from: false, to: true },
        passwordMaxAgeDays: { from: 0, to: 90 },
        webhookSignatureRequired: { from: true, to: false },
      },
    };
    expect(redact(diff)).toEqual(diff);
  });

  it('reaches secrets nested deeper than the old four-level limit', () => {
    const deep = { a: { b: { c: { d: { e: { f: { token: 'leak' } } } } } } };
    expect(JSON.stringify(redact(deep))).not.toContain('leak');
    expect(JSON.stringify(redact(deep))).toContain('[REDACTED]');
  });

  it('cuts a payload that nests absurdly deep instead of storing what it cannot inspect', () => {
    let v: Record<string, unknown> = { password: 'leak' };
    for (let i = 0; i < 30; i++) v = { x: v };
    const out = JSON.stringify(redact(v));
    expect(out).not.toContain('leak');
    expect(out).toContain('[TRUNCATED]');
  });

  it('redacts a whole object or list sitting under a secret-looking key', () => {
    expect(redact({ credentials: { user: 'u', pass: 'p' }, tokens: ['a', 'b'] })).toEqual({
      credentials: '[REDACTED]',
      tokens: '[REDACTED]',
    });
  });
});

describe('risk queue detail (WD-AUTH-036)', () => {
  it('prefers an explicit label, then the identifier, reason and route', () => {
    expect(riskDetail('auth.failed', { identifier: 'ann@x.test', reason: 'bad password' })).toBe(
      'ann@x.test',
    );
    expect(riskDetail('auth.lockout', { reason: 'too many attempts' })).toBe('too many attempts');
    expect(riskDetail('platform.access.blocked_by_ip', { route: '/v2/platform/security' })).toBe(
      '/v2/platform/security',
    );
    expect(riskDetail('x', { _label: 'Order 7', identifier: 'ignored' })).toBe('Order 7');
  });

  it('is empty, not a repeat of the event name, when there is nothing to add', () => {
    expect(riskDetail('auth.lockout', {})).toBe('');
    expect(riskDetail('auth.lockout', null)).toBe('');
    expect(riskDetail('auth.lockout', { reason: 'auth.lockout' })).toBe('');
    expect(riskDetail('auth.lockout', { identifier: '   ' })).toBe('');
  });
});
