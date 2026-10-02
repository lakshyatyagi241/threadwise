import { describe, expect, it } from 'vitest';
import {
  MailError,
  type MailMessage,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { MailService } from '../../../src/modules/auth/mail/mail.service';

const config = {
  get: (k: string) => ({ APP_NAME: 'Test CRM', WEB_APP_URL: 'http://web.test/' })[k],
};

function service(port: MailPort) {
  return new MailService(port, config as never);
}
const recorder = () => {
  const sent: MailMessage[] = [];
  return { sent, port: { send: async (m: MailMessage) => void sent.push(m) } satisfies MailPort };
};
const when = new Date('2026-10-01T10:00:00Z');

describe('login alert mail (WD-AUTH-018)', () => {
  it('names a lone new device as such', async () => {
    const r = recorder();
    await service(r.port).sendLoginAlert(
      'a@b.test',
      'Al',
      {
        when,
        ip: '1.2.3.4',
        browser: 'Chrome on Windows',
        reasons: ['new-device'],
        signedIn: true,
      },
      'http://web.test/forgot-password?org=acme',
    );
    expect(r.sent[0]!.subject).toMatch(/new device/i);
    expect(r.sent[0]!.text).toContain('a new device');
    expect(r.sent[0]!.text).not.toContain('different location');
  });

  it('uses the location subject whenever the location is involved', async () => {
    const r = recorder();
    const svc = service(r.port);
    for (const reasons of [['new-country'], ['new-device', 'new-country']] as const) {
      await svc.sendLoginAlert(
        'a@b.test',
        'Al',
        { when, ip: null, browser: 'Chrome on Windows', reasons: [...reasons], signedIn: true },
        'http://web.test/forgot-password?org=acme',
      );
    }
    expect(r.sent[0]!.subject).toMatch(/new location/i);
    expect(r.sent[1]!.subject).toBe(r.sent[0]!.subject);
    expect(r.sent[1]!.text).toContain('a new device and a different location');
  });

  it('puts the action link in both the text and the button', async () => {
    const r = recorder();
    const url = 'http://web.test/forgot-password?org=acme';
    await service(r.port).sendLoginAlert(
      'a@b.test',
      'Al',
      { when, ip: null, browser: 'x', reasons: ['new-device'], signedIn: true },
      url,
    );
    expect(r.sent[0]!.text).toContain(url);
    expect(r.sent[0]!.html).toContain(`href="${url}"`);
  });
});

describe('verification mail delivery result (WD-AUTH-015)', () => {
  it('reports success', async () => {
    const r = recorder();
    expect(await service(r.port).sendVerifyEmailDetailed('a@b.test', 'Al', 'http://x')).toEqual({
      sent: true,
    });
  });

  it.each([
    'not_configured',
    'auth_failed',
    'connection_refused',
    'timeout',
    'transport_error',
  ] as const)('reports a %s failure with its reason', async (reason) => {
    const port: MailPort = {
      send: async () => {
        throw new MailError(reason, 'x');
      },
    };
    expect(await service(port).sendVerifyEmailDetailed('a@b.test', 'Al', 'http://x')).toEqual({
      sent: false,
      reason,
    });
  });

  it('files an unexpected error under unknown, never leaking its text', async () => {
    const port: MailPort = {
      send: async () => {
        throw new Error('smtp password is hunter2');
      },
    };
    const result = await service(port).sendVerifyEmailDetailed('a@b.test', 'Al', 'http://x');
    expect(result).toEqual({ sent: false, reason: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('keeps the boolean API for the callers that only need to know', async () => {
    const port: MailPort = {
      send: async () => {
        throw new MailError('timeout', 'x');
      },
    };
    expect(await service(port).sendVerifyEmail('a@b.test', 'Al', 'http://x')).toBe(false);
  });
});
