import { z } from 'zod';
import type { PasswordConnection } from '../../infra/providers/channel-email';
import type { CryptoService } from '../../common/crypto/crypto.service';

/**
 * What `mail_mailboxes.connection_enc` holds once opened. A password provider keeps its logins in `login`; an OAuth provider may keep
 * extras (`extras`) it needs beside the tokens (a tenant id, ...). Always sealed with the credentials key; the password never leaves
 * the server and never reaches a log, the audit trail or the hub (`connection_public` is the non-secret summary).
 */
const serverLogin = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['ssl', 'starttls', 'none']),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const sealedConnectionSchema = z.object({
  v: z.literal(1),
  login: z.object({ imap: serverLogin, smtp: serverLogin }).optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type SealedConnection = z.infer<typeof sealedConnectionSchema>;

export const sealConnection = (crypto: CryptoService, value: Omit<SealedConnection, 'v'>): string =>
  crypto.encrypt(JSON.stringify({ v: 1, ...value }));

/** Opens a sealed connection; null when it is missing, sealed with a key that is gone, or not the expected shape. */
export function openConnection(
  crypto: CryptoService,
  sealed: string | null,
): SealedConnection | null {
  if (!sealed) return null;
  try {
    const parsed = sealedConnectionSchema.safeParse(JSON.parse(crypto.decrypt(sealed)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The two logins of an IMAP/SMTP form: the outgoing server signs in with the incoming user name and password unless the form gave its
 * own. One place, so connecting and testing build exactly the same connection.
 */
export function passwordConnectionOf(input: {
  imap: PasswordConnection['imap'];
  smtp: Omit<PasswordConnection['smtp'], 'username' | 'password'> &
    Partial<Pick<PasswordConnection['smtp'], 'username' | 'password'>>;
}): PasswordConnection {
  return {
    imap: { ...input.imap },
    smtp: {
      host: input.smtp.host,
      port: input.smtp.port,
      security: input.smtp.security,
      username: input.smtp.username ?? input.imap.username,
      password: input.smtp.password ?? input.imap.password,
    },
  };
}

/** The non-secret summary the hub shows. */
export function publicSummaryOf(connection: PasswordConnection): Record<string, unknown> {
  return {
    host: connection.imap.host,
    port: connection.imap.port,
    security: connection.imap.security,
    username: connection.imap.username,
    smtpHost: connection.smtp.host,
    smtpPort: connection.smtp.port,
    smtpSecurity: connection.smtp.security,
  };
}
