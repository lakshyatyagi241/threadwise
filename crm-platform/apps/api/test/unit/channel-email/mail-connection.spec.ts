import { describe, expect, it } from 'vitest';
import type { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  openConnection,
  publicSummaryOf,
  sealConnection,
} from '../../../src/modules/channel-email/mail-connection';

// A reversible stand-in for the credentials key; the real service is covered by its own tests.
const crypto = {
  encrypt: (s: string) => `v1:${Buffer.from(s).toString('base64')}`,
  decrypt: (s: string) => Buffer.from(s.slice(3), 'base64').toString(),
} as unknown as CryptoService;

const login = (host: string) => ({
  host,
  port: 993,
  security: 'ssl' as const,
  username: 'u@acme.test',
  password: 'hunter2',
});
const connection = { imap: login('imap.acme.test'), smtp: login('smtp.acme.test') };

describe('mail connection seal', () => {
  it('round-trips the logins and the extras', () => {
    const sealed = sealConnection(crypto, { login: connection, extras: { tenant: 't1' } });
    expect(sealed).toMatch(/^v1:/);
    expect(openConnection(crypto, sealed)).toEqual({
      v: 1,
      login: connection,
      extras: { tenant: 't1' },
    });
  });

  it('a missing, unreadable or wrongly shaped blob is null, never a throw', () => {
    expect(openConnection(crypto, null)).toBeNull();
    expect(openConnection(crypto, 'v1:@@@')).toBeNull();
    expect(openConnection(crypto, crypto.encrypt('{"v":2}'))).toBeNull();
    expect(openConnection(crypto, crypto.encrypt('{"v":1,"login":{"imap":{}}}'))).toBeNull();
  });

  it('the public summary carries the settings and never a password', () => {
    const summary = publicSummaryOf(connection);
    expect(summary).toEqual({
      host: 'imap.acme.test',
      port: 993,
      security: 'ssl',
      username: 'u@acme.test',
      smtpHost: 'smtp.acme.test',
      smtpPort: 993,
      smtpSecurity: 'ssl',
    });
    expect(JSON.stringify(summary)).not.toContain('hunter2');
  });
});
