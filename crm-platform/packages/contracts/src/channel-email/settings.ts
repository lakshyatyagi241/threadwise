import { z } from 'zod';

/**
 * Workspace policy of personal mailboxes (TW-MAIL-035): `GET` / `PATCH /v2/email/settings`. Reading needs `mail.mailboxes.read`, writing
 * `mail.settings.manage`. A workspace that never wrote the policy gets the defaults.
 */
export const MAIL_PERSONAL_CONNECTORS = ['admins', 'agents'] as const;
export const mailPersonalConnectorSchema = z.enum(MAIL_PERSONAL_CONNECTORS);
export type MailPersonalConnector = z.infer<typeof mailPersonalConnectorSchema>;

export const mailWorkspaceSettingsSchema = z.object({
  personalMailboxesEnabled: z.boolean(),
  /** Who may connect a personal mailbox once enabled: only admins, or any member holding `mail.mailboxes.manage_personal`. */
  whoMayConnectPersonal: mailPersonalConnectorSchema,
  /** Admins may read the conversations of other people's personal mailboxes. */
  adminsCanReadPersonal: z.boolean(),
  rowVersion: z.number().int(),
});
export type MailWorkspaceSettings = z.infer<typeof mailWorkspaceSettingsSchema>;

export const DEFAULT_MAIL_WORKSPACE_SETTINGS = {
  personalMailboxesEnabled: false,
  whoMayConnectPersonal: 'admins',
  adminsCanReadPersonal: false,
  rowVersion: 0,
} as const satisfies MailWorkspaceSettings;

export const updateMailWorkspaceSettingsSchema = z.object({
  personalMailboxesEnabled: z.boolean().optional(),
  whoMayConnectPersonal: mailPersonalConnectorSchema.optional(),
  adminsCanReadPersonal: z.boolean().optional(),
  /** The version read; 0 when the workspace has never saved the policy. */
  rowVersion: z.number().int().min(0),
});
export type UpdateMailWorkspaceSettingsInput = z.infer<typeof updateMailWorkspaceSettingsSchema>;
