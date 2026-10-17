import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  IMAP_PRESETS,
  applyPreset,
  buildImapInput,
  buildTestInput,
  emptyImapForm,
  imapFailureKey,
  imapFormFor,
  withSecurity,
  type ImapForm,
} from './imap-form';

const filled = (o: Partial<ImapForm> = {}): ImapForm => ({
  ...emptyImapForm(),
  address: 'Support@Acme.com',
  displayName: 'Acme Support',
  imapHost: 'imap.acme.com',
  imapUsername: 'support@acme.com',
  imapPassword: 'secret',
  smtpHost: 'smtp.acme.com',
  ...o,
});

describe('IMAP form', () => {
  it('builds the exact API body, sending SMTP credentials only when they differ', () => {
    const same = buildImapInput(filled(), 'shared');
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.input.address).toBe('support@acme.com');
      expect(same.input.imap).toMatchObject({ host: 'imap.acme.com', port: 993, security: 'ssl' });
      expect(same.input.smtp).toEqual({ host: 'smtp.acme.com', port: 465, security: 'ssl' });
      expect(same.input.scope).toBe('shared');
    }
    const own = buildImapInput(
      filled({ sameCredentials: false, smtpUsername: 'relay', smtpPassword: 'other' }),
      'personal',
      '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50',
    );
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.input.smtp).toMatchObject({ username: 'relay', password: 'other' });
      expect(own.input.scope).toBe('personal');
      expect(own.input.mailboxId).toBe('0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50');
    }
  });

  it('names every field that is empty or wrong, and builds nothing', () => {
    const r = buildImapInput(
      {
        ...emptyImapForm(),
        address: 'not-an-address',
        imapHost: 'bad host!',
        imapPort: '70000',
        smtpPort: 'x',
      },
      'shared',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toMatchObject({
        address: 'invalid',
        displayName: 'required',
        imapHost: 'invalid',
        imapPort: 'invalid',
        imapUsername: 'required',
        imapPassword: 'required',
        smtpHost: 'required',
        smtpPort: 'invalid',
      });
    }
  });

  it('asks for the SMTP login only when it is not the same as the IMAP one', () => {
    const r = buildImapInput(filled({ sameCredentials: false }), 'shared');
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toMatchObject({ smtpUsername: 'required', smtpPassword: 'required' });
  });

  it('moves the port with the security mode unless the person typed their own', () => {
    let f = withSecurity(emptyImapForm(), 'imap', 'starttls');
    expect(f.imapPort).toBe('143');
    f = withSecurity(emptyImapForm(), 'smtp', 'starttls');
    expect(f.smtpPort).toBe('587');
    const custom = withSecurity({ ...emptyImapForm(), imapPort: '1993' }, 'imap', 'none');
    expect(custom.imapPort).toBe('1993');
  });

  it('fills the server settings from a preset and keeps the rest', () => {
    const icloud = IMAP_PRESETS.find((p) => p.id === 'icloud')!;
    const f = applyPreset(filled(), icloud);
    expect(f).toMatchObject({
      imapHost: 'imap.mail.me.com',
      imapPort: '993',
      smtpHost: 'smtp.mail.me.com',
      smtpSecurity: 'starttls',
      smtpPort: '587',
      address: 'Support@Acme.com',
    });
    expect(applyPreset(filled(), null)).toEqual(filled());
  });

  it('starts a reconnect from the saved summary and never carries a password', () => {
    const f = imapFormFor({
      address: 'support@acme.com',
      displayName: 'Acme',
      imap: {
        host: 'imap.acme.com',
        port: 143,
        security: 'starttls',
        username: 'u',
        smtpHost: 'smtp.acme.com',
        smtpPort: 587,
        smtpSecurity: 'starttls',
      },
    });
    expect(f).toMatchObject({ imapHost: 'imap.acme.com', imapPort: '143', smtpPort: '587' });
    expect(f.imapPassword).toBe('');
    expect(f.smtpPassword).toBe('');
  });

  it('tells which of the two logins failed from the stable code', () => {
    expect(imapFailureKey(ERROR_CODES.MAIL_IMAP_AUTH_FAILED)).toBe('imapAuth');
    expect(imapFailureKey(ERROR_CODES.MAIL_SMTP_AUTH_FAILED)).toBe('smtpAuth');
    expect(imapFailureKey(ERROR_CODES.MAIL_IMAP_CONNECT_FAILED)).toBe('unreachable');
    expect(imapFailureKey('OTHER')).toBeNull();
  });
});

describe('Test credentials input', () => {
  it('needs only the server fields: the address and the name may still be empty', () => {
    const built = buildTestInput(filled({ address: '', displayName: '' }));
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.imap).toMatchObject({
        host: 'imap.acme.com',
        port: 993,
        password: 'secret',
      });
      expect(built.input.smtp).toEqual({ host: 'smtp.acme.com', port: 465, security: 'ssl' });
      expect(JSON.stringify(built.input)).not.toContain('address');
    }
  });
  it('sends the SMTP login only when it differs, and reports what is missing or wrong', () => {
    const own = buildTestInput(
      filled({ sameCredentials: false, smtpUsername: 'relay', smtpPassword: 'other' }),
    );
    expect(own.ok && own.input.smtp).toMatchObject({ username: 'relay', password: 'other' });
    const bad = buildTestInput(
      filled({ imapHost: '', imapPassword: '', smtpHost: 'not a host', smtpPort: '70000' }),
    );
    expect(bad).toEqual({
      ok: false,
      errors: {
        imapHost: 'required',
        imapPassword: 'required',
        smtpHost: 'invalid',
        smtpPort: 'invalid',
      },
    });
  });
});
