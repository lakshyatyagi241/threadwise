import {
  GmailClient,
  GoogleMailOAuthClient,
  GraphMailClient,
  MicrosoftMailOAuthClient,
} from '../../../infra/providers/channel-email';
import { GoogleMailDriver } from './google-mail.driver';
import { ImapMailClient } from '../../../infra/providers/channel-email/imap/imap-mail.client';
import { SmtpMailClient } from '../../../infra/providers/channel-email/imap/smtp-mail.client';
import { ImapMailDriver } from './imap-mail.driver';
import { MailDriverRegistry } from './mail-driver.registry';
import { MicrosoftMailConfig } from '../microsoft-mail-config.service';
import { MicrosoftMailDriver } from './microsoft-mail.driver';

/**
 * Every provider the Email channel module registers: each mail driver and the infra clients only it needs. A driver registers itself with
 * the `MailDriverRegistry` in its own `onModuleInit`, so adding a provider is adding its classes HERE and nothing else in the module.
 * One provider per block, a blank line between blocks, so parallel builds do not touch the same lines.
 */
export const MAIL_DRIVER_PROVIDERS = [
  MailDriverRegistry,

  // google (Gmail / Google Workspace)
  GoogleMailOAuthClient,
  GmailClient,
  GoogleMailDriver,

  // microsoft (Microsoft 365 / Outlook)
  MicrosoftMailConfig,
  MicrosoftMailOAuthClient,
  GraphMailClient,
  MicrosoftMailDriver,

  // imap (any IMAP/SMTP server): TW-MAIL-031 adds its clients and driver here
  ImapMailClient,
  SmtpMailClient,
  ImapMailDriver,
];
