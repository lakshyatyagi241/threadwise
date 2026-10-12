import {
  connectImapMailboxSchema,
  type ConnectImapMailboxInput,
  type ImapSummary,
  type MailScope,
  type MailTlsMode,
} from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';

/** The default port of a connection security mode. Choosing a mode moves the port only while it still holds the old default. */
export const IMAP_PORTS: Record<MailTlsMode, number> = { ssl: 993, starttls: 143, none: 143 };
export const SMTP_PORTS: Record<MailTlsMode, number> = { ssl: 465, starttls: 587, none: 25 };

export interface ImapPreset {
  id: string;
  /** Provider names are brand names and are not translated. */
  name: string;
  imapHost: string;
  imapSecurity: MailTlsMode;
  smtpHost: string;
  smtpSecurity: MailTlsMode;
}

/** Settings of common hosts (the picker fills the server fields; every field stays editable). */
export const IMAP_PRESETS: readonly ImapPreset[] = [
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapSecurity: 'ssl',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpSecurity: 'ssl',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    imapHost: 'imap.mail.me.com',
    imapSecurity: 'ssl',
    smtpHost: 'smtp.mail.me.com',
    smtpSecurity: 'starttls',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    imapHost: 'imap.zoho.com',
    imapSecurity: 'ssl',
    smtpHost: 'smtp.zoho.com',
    smtpSecurity: 'ssl',
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    imapHost: 'imap.fastmail.com',
    imapSecurity: 'ssl',
    smtpHost: 'smtp.fastmail.com',
    smtpSecurity: 'ssl',
  },
  {
    id: 'ovh',
    name: 'OVH',
    imapHost: 'ssl0.ovh.net',
    imapSecurity: 'ssl',
    smtpHost: 'ssl0.ovh.net',
    smtpSecurity: 'ssl',
  },
  {
    id: 'gmx',
    name: 'GMX',
    imapHost: 'imap.gmx.com',
    imapSecurity: 'ssl',
    smtpHost: 'mail.gmx.com',
    smtpSecurity: 'starttls',
  },
];

export interface ImapForm {
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: MailTlsMode;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: MailTlsMode;
  sameCredentials: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

export const emptyImapForm = (): ImapForm => ({
  address: '',
  displayName: '',
  imapHost: '',
  imapPort: String(IMAP_PORTS.ssl),
  imapSecurity: 'ssl',
  imapUsername: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: String(SMTP_PORTS.ssl),
  smtpSecurity: 'ssl',
  sameCredentials: true,
  smtpUsername: '',
  smtpPassword: '',
});

/** A reconnect starts from what the hub knows of the mailbox; the password is never part of it and must be typed again. */
export function imapFormFor(m: {
  address: string;
  displayName: string;
  imap: ImapSummary | null;
}): ImapForm {
  const base = emptyImapForm();
  if (!m.imap) return { ...base, address: m.address, displayName: m.displayName };
  return {
    ...base,
    address: m.address,
    displayName: m.displayName,
    imapHost: m.imap.host,
    imapPort: String(m.imap.port),
    imapSecurity: m.imap.security,
    imapUsername: m.imap.username,
    smtpHost: m.imap.smtpHost,
    smtpPort: String(m.imap.smtpPort),
    smtpSecurity: m.imap.smtpSecurity,
  };
}

export function applyPreset(form: ImapForm, preset: ImapPreset | null): ImapForm {
  if (!preset) return form;
  return {
    ...form,
    imapHost: preset.imapHost,
    imapSecurity: preset.imapSecurity,
    imapPort: String(IMAP_PORTS[preset.imapSecurity]),
    smtpHost: preset.smtpHost,
    smtpSecurity: preset.smtpSecurity,
    smtpPort: String(SMTP_PORTS[preset.smtpSecurity]),
  };
}

/** Changes the security mode and moves the port with it, unless the person typed a port of their own. */
export function withSecurity(
  form: ImapForm,
  side: 'imap' | 'smtp',
  security: MailTlsMode,
): ImapForm {
  if (side === 'imap') {
    const keep = form.imapPort !== String(IMAP_PORTS[form.imapSecurity]);
    return {
      ...form,
      imapSecurity: security,
      imapPort: keep ? form.imapPort : String(IMAP_PORTS[security]),
    };
  }
  const keep = form.smtpPort !== String(SMTP_PORTS[form.smtpSecurity]);
  return {
    ...form,
    smtpSecurity: security,
    smtpPort: keep ? form.smtpPort : String(SMTP_PORTS[security]),
  };
}

/** Field names an error can be attached to; the message key is under `email.imap.errors`. */
export type ImapField =
  | 'address'
  | 'displayName'
  | 'imapHost'
  | 'imapPort'
  | 'imapUsername'
  | 'imapPassword'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpUsername'
  | 'smtpPassword';
export type ImapErrors = Partial<Record<ImapField, 'required' | 'invalid'>>;

const HOST = /^[A-Za-z0-9.-]+$/;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function portOk(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 65535;
}

/** Checks the form and, when it is fine, builds the exact body the API takes (checked against the shared contract too). */
export function buildImapInput(
  form: ImapForm,
  scope: MailScope,
  mailboxId?: string,
): { ok: true; input: ConnectImapMailboxInput } | { ok: false; errors: ImapErrors } {
  const errors: ImapErrors = {};
  const need = (field: ImapField, value: string) => {
    if (value.trim() === '') errors[field] = 'required';
  };
  need('address', form.address);
  need('displayName', form.displayName);
  need('imapHost', form.imapHost);
  need('imapUsername', form.imapUsername);
  need('smtpHost', form.smtpHost);
  if (form.imapPassword === '') errors.imapPassword = 'required';
  if (!errors.address && !ADDRESS.test(form.address.trim())) errors.address = 'invalid';
  if (!errors.displayName && form.displayName.trim().length > 80) errors.displayName = 'invalid';
  if (!errors.imapHost && !HOST.test(form.imapHost.trim())) errors.imapHost = 'invalid';
  if (!errors.smtpHost && !HOST.test(form.smtpHost.trim())) errors.smtpHost = 'invalid';
  if (!portOk(form.imapPort)) errors.imapPort = 'invalid';
  if (!portOk(form.smtpPort)) errors.smtpPort = 'invalid';
  if (!form.sameCredentials) {
    need('smtpUsername', form.smtpUsername);
    if (form.smtpPassword === '') errors.smtpPassword = 'required';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = connectImapMailboxSchema.safeParse({
    scope,
    address: form.address,
    displayName: form.displayName,
    imap: {
      host: form.imapHost,
      port: Number(form.imapPort),
      security: form.imapSecurity,
      username: form.imapUsername,
      password: form.imapPassword,
    },
    smtp: {
      host: form.smtpHost,
      port: Number(form.smtpPort),
      security: form.smtpSecurity,
      ...(form.sameCredentials ? {} : { username: form.smtpUsername, password: form.smtpPassword }),
    },
    ...(mailboxId ? { mailboxId } : {}),
  });
  if (!parsed.success) {
    // The checks above cover what a person can get wrong; anything the contract still refuses is pinned to the address.
    return { ok: false, errors: { address: 'invalid' } };
  }
  return { ok: true, input: parsed.data };
}

/** Which message (under `email.imap.failure`) explains a refused connect: the code says which of the two logins failed. */
export function imapFailureKey(code: string): 'imapAuth' | 'smtpAuth' | 'unreachable' | null {
  switch (code) {
    case ERROR_CODES.MAIL_IMAP_AUTH_FAILED:
      return 'imapAuth';
    case ERROR_CODES.MAIL_SMTP_AUTH_FAILED:
      return 'smtpAuth';
    case ERROR_CODES.MAIL_IMAP_CONNECT_FAILED:
      return 'unreachable';
    default:
      return null;
  }
}
