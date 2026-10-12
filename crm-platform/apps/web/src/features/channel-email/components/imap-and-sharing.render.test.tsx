import { describe, expect, it } from 'vitest';
import type { MailWorkspaceSettings } from '@crm/contracts';
import { ImapConnectDialog } from './imap-connect-dialog';
import { SharingPanel } from './sharing-panel';
import { imapFormFor } from '../lib/imap-form';
import { render } from './render-utils';

const noop = () => undefined;

describe('IMAP connect form', () => {
  it('renders nothing while closed and the full form when open', () => {
    expect(
      render(<ImapConnectDialog target={null} onClose={noop} onConnected={noop} />),
    ).not.toContain('email-imap-form');
    const html = render(
      <ImapConnectDialog target={{ scope: 'shared' }} onClose={noop} onConnected={noop} />,
    );
    expect(html).toContain('data-testid="email-imap-form"');
    expect(html).toContain('Connect IMAP / SMTP mailbox');
    expect(html).toContain('Incoming mail (IMAP)');
    expect(html).toContain('Outgoing mail (SMTP)');
    expect(html).toContain('Use the same user name and password for sending');
    expect(html).toContain('Stored encrypted and never shown again.');
    expect(html).toContain('Verify and connect');
    // presets of common hosts, security modes, and no insecure-certificate option anywhere
    expect(html).toContain('Fastmail');
    expect(html).toContain('>SSL/TLS<');
    expect(html).toContain('>STARTTLS<');
    expect(html.toLowerCase()).not.toContain('insecure');
    expect(html).toContain('type="password"');
  });

  it('prefills a reconnect, fixes the address and asks for the password again', () => {
    const initial = imapFormFor({
      address: 'support@acme.com',
      displayName: 'Acme',
      imap: {
        host: 'imap.acme.com',
        port: 993,
        security: 'ssl',
        username: 'support',
        smtpHost: 'smtp.acme.com',
        smtpPort: 465,
        smtpSecurity: 'ssl',
      },
    });
    const html = render(
      <ImapConnectDialog
        target={{ scope: 'shared', mailboxId: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50', initial }}
        onClose={noop}
        onConnected={noop}
      />,
    );
    expect(html).toContain('Reconnect IMAP / SMTP mailbox');
    expect(html).toContain('value="imap.acme.com"');
    expect(html).toContain('readOnly');
    expect(html).toContain('Type the password again. It is never shown.');
    expect(html).toContain('Verify and reconnect');
    expect(html).not.toContain('secret');
  });

  it('renders in every right-to-left language without a missing message', () => {
    for (const l of ['ar', 'he', 'ur']) {
      expect(() =>
        render(
          <ImapConnectDialog target={{ scope: 'personal' }} onClose={noop} onConnected={noop} />,
          {
            locale: l,
          },
        ),
      ).not.toThrow();
    }
  });
});

const policy = (o: Partial<MailWorkspaceSettings> = {}): MailWorkspaceSettings => ({
  personalMailboxesEnabled: true,
  whoMayConnectPersonal: 'agents',
  adminsCanReadPersonal: false,
  rowVersion: 4,
  ...o,
});

describe('Email sharing panel', () => {
  it('shows the three settings, the privacy note and a Save that waits for a change', () => {
    const html = render(<SharingPanel settings={policy()} />);
    expect(html).toContain('data-testid="email-sharing"');
    expect(html).toContain('role="switch"');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).toContain('Admins only');
    expect(html).toContain('Admins and agents');
    expect(html).toContain('stay private to their owners');
    expect(html).toMatch(/disabled=""[^>]*data-testid="email-sharing-save"/);
  });

  it('disables the who-may-connect choice while personal mailboxes are off', () => {
    const html = render(<SharingPanel settings={policy({ personalMailboxesEnabled: false })} />);
    expect(html).toMatch(/<select[^>]*id="email-who-connects"[^>]*disabled/);
  });

  it('renders in Hindi and Arabic without a missing message', () => {
    for (const l of ['hi', 'ar'])
      expect(() => render(<SharingPanel settings={policy()} />, { locale: l })).not.toThrow();
  });
});
