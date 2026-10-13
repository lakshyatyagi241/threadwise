import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  isOAuthDriver,
  MailDriverError,
  type MailDriver,
} from '../../../src/modules/channel-email/drivers/mail-driver';
import { MailDriverRegistry } from '../../../src/modules/channel-email/drivers/mail-driver.registry';

const base = {
  readiness: async () => ({ ready: true, notReadyReason: null }),
  sync: async () => {
    throw new Error('unused');
  },
  send: async () => {
    throw new Error('unused');
  },
  health: async () => ({ displayName: null }),
};
const oauth = (provider: 'google' | 'microsoft'): MailDriver => ({
  ...base,
  provider,
  authKind: 'oauth',
  label: provider,
  requiredScopes: [],
  authorizeUrl: async () => 'https://x',
  exchange: async () => {
    throw new Error('unused');
  },
  refresh: async () => {
    throw new Error('unused');
  },
  revoke: async () => undefined,
  profile: async () => ({ address: 'a@b', sub: null, name: null }),
});
const password: MailDriver = {
  ...base,
  provider: 'imap',
  authKind: 'password',
  label: 'IMAP',
  verify: async () => ({ address: 'a@b', sub: null, name: null }),
};

describe('MailDriverRegistry', () => {
  it('finds a registered driver by provider and lists them in hub order', () => {
    const r = new MailDriverRegistry();
    r.register(password);
    r.register(oauth('microsoft'));
    r.register(oauth('google'));
    expect(r.get('google').provider).toBe('google');
    expect(r.has('imap')).toBe(true);
    expect(r.list().map((d) => d.provider)).toEqual(['google', 'microsoft', 'imap']);
  });

  it('an unknown provider is a 422 MAIL_PROVIDER_UNSUPPORTED, never a crash', () => {
    const r = new MailDriverRegistry();
    expect(r.find('microsoft')).toBeUndefined();
    expect(() => r.get('microsoft')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED }),
    );
  });

  it('oauth() and password() refuse a driver of the other kind', () => {
    const r = new MailDriverRegistry();
    r.register(oauth('google'));
    r.register(password);
    expect(isOAuthDriver(r.oauth('google'))).toBe(true);
    expect(r.password('imap').provider).toBe('imap');
    expect(() => r.oauth('imap')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED }),
    );
    expect(() => r.password('google')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED }),
    );
  });

  it('a second driver for the same provider replaces the first (how a test swaps one)', () => {
    const r = new MailDriverRegistry();
    r.register(oauth('google'));
    const other = { ...oauth('google'), label: 'fake' };
    r.register(other);
    expect(r.get('google').label).toBe('fake');
    expect(r.list()).toHaveLength(1);
  });
});

describe('MailDriverError', () => {
  it('outages retry, refusals do not, a dead login needs reconnecting', () => {
    expect(new MailDriverError('transient', 'x').retryable).toBe(true);
    expect(new MailDriverError('rate_limit', 'x').retryable).toBe(true);
    expect(new MailDriverError('token_rejected', 'x').retryable).toBe(true);
    expect(new MailDriverError('forbidden', 'x').retryable).toBe(false);
    expect(new MailDriverError('bad_request', 'x').retryable).toBe(false);
    expect(new MailDriverError('auth_failed', 'x').needsReauth).toBe(true);
    expect(new MailDriverError('reauth', 'x').needsReauth).toBe(true);
    expect(new MailDriverError('forbidden', 'x').needsReauth).toBe(false);
    expect(new MailDriverError('forbidden', 'x', { needsReauth: true }).needsReauth).toBe(true);
    expect(new MailDriverError('transient', 'x', { retryable: false }).retryable).toBe(false);
  });
});
