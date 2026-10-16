import { describe, expect, it, vi } from 'vitest';
import { ImapMailDriver } from '../../../src/modules/channel-email/drivers/imap-mail.driver';
import { MailDriverRegistry } from '../../../src/modules/channel-email/drivers/mail-driver.registry';
import { BlockedHostError } from '../../../src/infra/providers/channel-email/imap/host-guard';
import type { PasswordConnection } from '../../../src/infra/providers/channel-email';
import { INBOX_FAILED } from '../../../src/modules/channel-email/mail-test-rules';

/**
 * "Test credentials" at the driver: both servers are always tried and each side answers on its own, in our words. The IMAP and SMTP clients
 * are stand-ins that fail the way imapflow and nodemailer do; the real network paths are exercised by the IMAP e2e against GreenMail.
 */
const SECRET = 'hunter2-never-shown';
const connection: PasswordConnection = {
  imap: {
    host: 'imap.acme.test',
    port: 993,
    security: 'ssl',
    username: 'support',
    password: SECRET,
  },
  smtp: {
    host: 'smtp.acme.test',
    port: 465,
    security: 'ssl',
    username: 'support',
    password: SECRET,
  },
};

const coded = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${code} from a server banner with imap.acme.test in it`), {
    code,
    ...extra,
  });

function driver(opts: {
  connect?: () => Promise<unknown>;
  openInbox?: () => Promise<{ exists: number }>;
  smtpVerify?: () => Promise<void>;
}) {
  const close = vi.fn(async () => undefined);
  const imap = {
    connect: vi.fn(
      opts.connect ??
        (async () => ({
          openInbox: opts.openInbox ?? (async () => ({ exists: 42 })),
          close,
        })),
    ),
  };
  const smtp = { verify: vi.fn(opts.smtpVerify ?? (async () => undefined)) };
  const d = new ImapMailDriver(imap as never, smtp as never, new MailDriverRegistry());
  return { d, imap, smtp, close };
}

describe('ImapMailDriver.test', () => {
  it('both sides fine: signed in, the INBOX count, nothing sent', async () => {
    const { d, close } = driver({});
    const r = await d.test(connection);
    expect(r).toEqual({
      ok: true,
      imap: { ok: true, failedStep: null, reason: null, message: null, inboxMessages: 42 },
      smtp: { ok: true, failedStep: null, reason: null, message: null, inboxMessages: null },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a refused IMAP password is the login step, and SMTP is still tried', async () => {
    const { d, smtp } = driver({
      connect: async () => {
        throw coded('AUTHENTICATIONFAILED', { authenticationFailed: true });
      },
    });
    const r = await d.test(connection);
    expect(r.ok).toBe(false);
    expect(r.imap).toMatchObject({ ok: false, failedStep: 'login', reason: 'auth_failed' });
    expect(r.smtp.ok).toBe(true);
    expect(smtp.verify).toHaveBeenCalledTimes(1);
  });

  it('a refused SMTP password is the auth step; a wrong SMTP port is the connection', async () => {
    const auth = await driver({
      smtpVerify: async () => {
        throw coded('EAUTH', { responseCode: 535 });
      },
    }).d.test(connection);
    expect(auth.imap.ok).toBe(true);
    expect(auth.smtp).toMatchObject({ failedStep: 'auth', reason: 'auth_failed' });
    const down = await driver({
      smtpVerify: async () => {
        throw coded('ECONNREFUSED');
      },
    }).d.test(connection);
    expect(down.smtp).toMatchObject({ failedStep: 'connect', reason: 'unreachable' });
  });

  it('a certificate problem is a tls reason, a timeout or refusal is unreachable, a blocked address is its own', async () => {
    const tls = await driver({
      connect: async () => {
        throw coded('CERT_HAS_EXPIRED');
      },
    }).d.test(connection);
    expect(tls.imap).toMatchObject({ failedStep: 'connect', reason: 'tls' });
    const timeout = await driver({
      connect: async () => {
        throw coded('ETIMEDOUT');
      },
    }).d.test(connection);
    expect(timeout.imap).toMatchObject({ failedStep: 'connect', reason: 'unreachable' });
    const blocked = await driver({
      connect: async () => {
        throw new BlockedHostError();
      },
      smtpVerify: async () => {
        throw new BlockedHostError();
      },
    }).d.test(connection);
    expect(blocked.imap).toMatchObject({ reason: 'blocked_address' });
    expect(blocked.smtp).toMatchObject({ reason: 'blocked_address' });
  });

  it('a good sign-in that cannot open the INBOX is the inbox step with its own sentence, and the session is closed', async () => {
    const { d, close } = driver({
      openInbox: async () => {
        throw new Error('NO [NONEXISTENT] Unknown Mailbox');
      },
    });
    const r = await d.test(connection);
    expect(r.imap).toMatchObject({ ok: false, failedStep: 'inbox', message: INBOX_FAILED });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never carries a password, a host name or the server’s own text in the answer', async () => {
    const r = await driver({
      connect: async () => {
        throw coded('ECONNRESET');
      },
      smtpVerify: async () => {
        throw coded('EAUTH', { responseCode: 535, response: `535 5.7.8 bad login for ${SECRET}` });
      },
    }).d.test(connection);
    const text = JSON.stringify(r);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('acme.test');
    expect(text).not.toContain('banner');
    expect(text).not.toContain('535');
  });
});
