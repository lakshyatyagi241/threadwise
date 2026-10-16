import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MailConnectionTestResponse, MailTestSide } from '@crm/contracts';
import { ConnectionTestResult } from './connection-test-result';
import { ImapConnectDialog } from './imap-connect-dialog';
import { render } from './render-utils';

const ok = (inboxMessages: number | null = null): MailTestSide => ({
  ok: true,
  failedStep: null,
  reason: null,
  message: null,
  inboxMessages,
});
const bad = (
  reason: MailTestSide['reason'],
  failedStep: MailTestSide['failedStep'],
): MailTestSide => ({
  ok: false,
  failedStep,
  reason,
  message: 'The IMAP server said something in English from imap.secret.example',
  inboxMessages: null,
});
const result = (imap: MailTestSide, smtp: MailTestSide): MailConnectionTestResponse => ({
  ok: imap.ok && smtp.ok,
  imap,
  smtp,
});

describe('Test credentials result', () => {
  it('both fine: the INBOX count, nothing sent, nothing saved', () => {
    const html = render(<ConnectionTestResult result={result(ok(1), ok())} />);
    expect(html).toContain('data-testid="email-test-result"');
    expect(html).toContain('Incoming (IMAP)');
    expect(html).toContain('The INBOX holds 1 message.');
    expect(html).toContain('Signed in. Nothing was sent.');
    expect(html).toContain('Nothing was saved and no email was sent.');
    expect(render(<ConnectionTestResult result={result(ok(0), ok())} />)).toContain('0 messages');
  });

  it('names which side failed and why, in our translated words and never the server text', () => {
    const html = render(
      <ConnectionTestResult result={result(bad('auth_failed', 'login'), bad('tls', 'connect'))} />,
    );
    expect(html).toContain('data-testid="email-test-imap" data-ok="false"');
    expect(html).toContain('The server refused the user name or password.');
    expect(html).toContain('The secure connection could not be verified.');
    expect(html).not.toContain('imap.secret.example');
    expect(html).not.toContain('Nothing was saved');
  });

  it('one side can be fine while the other is not', () => {
    const html = render(
      <ConnectionTestResult result={result(ok(5), bad('unreachable', 'connect'))} />,
    );
    expect(html).toContain('data-testid="email-test-imap" data-ok="true"');
    expect(html).toContain('data-testid="email-test-smtp" data-ok="false"');
    expect(html).toContain('The server could not be reached.');
  });

  it('renders every reason in a right-to-left language without a missing message', () => {
    for (const l of ['ar', 'he', 'ur']) {
      for (const r of [
        'auth_failed',
        'tls',
        'unreachable',
        'blocked_address',
        'rejected',
        'unknown',
      ] as const) {
        expect(() =>
          render(<ConnectionTestResult result={result(bad(r, 'connect'), ok())} />, { locale: l }),
        ).not.toThrow();
      }
    }
  });
});

describe('Test credentials in the connect dialog', () => {
  it('has a Test credentials button beside Verify and connect', () => {
    const html = render(
      <ImapConnectDialog
        target={{ scope: 'shared' }}
        onClose={() => undefined}
        onConnected={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="email-imap-test"');
    expect(html).toContain('Test credentials');
    expect(html).toContain('Verify and connect');
  });
});

/** Every language ships the new strings (the loader falls back to English silently, so the files are read directly). */
describe('Test credentials strings in all 21 languages', () => {
  const root = join(__dirname, '../../../../messages');
  const locales = readdirSync(root).filter((d) => !d.includes('.'));
  const reasons = ['auth_failed', 'tls', 'unreachable', 'blocked_address', 'rejected', 'unknown'];
  const cardKeys = ['test', 'testing', 'lag', 'lagUnderMinute', 'lagMinutes', 'lagHours'];
  const testKeys = [
    'button',
    'testing',
    'imap',
    'smtp',
    'ok',
    'inbox',
    'smtpOk',
    'note',
    'tooMany',
    'failed',
  ];

  it('has 21 languages', () => expect(locales).toHaveLength(21));
  for (const l of locales) {
    it(`${l} has every key`, () => {
      const email = JSON.parse(readFileSync(join(root, l, 'channel-email.json'), 'utf8')).email;
      for (const k of cardKeys) expect(email.card[k], `card.${k}`).toBeTruthy();
      for (const k of testKeys) expect(email.imap.test[k], `imap.test.${k}`).toBeTruthy();
      for (const k of reasons) expect(email.imap.test.reasons[k], `reasons.${k}`).toBeTruthy();
      // A message in another language is not the English one.
      if (l !== 'en') expect(email.imap.test.button).not.toBe('Test credentials');
    });
  }
});
