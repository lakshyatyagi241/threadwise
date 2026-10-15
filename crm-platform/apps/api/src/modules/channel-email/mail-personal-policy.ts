import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type MailScope, type MailWorkspaceSettings } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * Who may do what with personal mailboxes (TW-MAIL-035). Pure functions over the actor's three relevant permissions and the workspace
 * policy, so every rule is unit-tested without a database. The CONVERSATIONS of a personal mailbox are protected separately and more strictly
 * by the inbox visibility predicate (`conversationVisible` / `visibleToSql`, `channelOwnerUserId`): nothing here opens a conversation.
 *
 * Three permissions decide, all in the `email_channel` family:
 *   `mail.mailboxes.manage`           the company's shared mailboxes (Admin)
 *   `mail.mailboxes.manage_personal`  connecting and managing one's OWN personal mailbox (Admin, Manager, Agent)
 *   `mail.settings.manage`            the workspace policy; it is also what marks an ADMIN for the rules below (Admin preset only)
 */
export interface MailActor {
  userId: number | null;
  canManageShared: boolean;
  canManagePersonal: boolean;
  /** Holds `mail.settings.manage`. */
  isAdmin: boolean;
}

/** The part of a mailbox row the rules look at. */
export interface MailboxOwnership {
  scope: MailScope;
  ownerUserId: number | null;
}

export type MailboxView = 'full' | 'summary' | 'none';
export type MailboxAction = 'rename' | 'sync' | 'reconnect' | 'disconnect';

export const isOwner = (actor: MailActor, row: MailboxOwnership): boolean =>
  row.scope === 'personal' && actor.userId !== null && row.ownerUserId === actor.userId;

/**
 * What the hub shows of a mailbox to this person:
 *   shared mailbox                       full, to anyone who may read the hub
 *   my own personal mailbox              full
 *   someone else's personal mailbox      an admin sees a SUMMARY (address, owner, status, plan use; no conversation count, no error text,
 *                                        no inbox filter) unless the policy lets admins read personal mail, then full; anyone else sees NOTHING
 */
export function viewOf(
  actor: MailActor,
  row: MailboxOwnership,
  policy: Pick<MailWorkspaceSettings, 'adminsCanReadPersonal'>,
): MailboxView {
  if (row.scope === 'shared' || isOwner(actor, row)) return 'full';
  if (!actor.isAdmin) return 'none';
  return policy.adminsCanReadPersonal ? 'full' : 'summary';
}

/**
 * May this person do `action` to this mailbox? A shared mailbox needs `mail.mailboxes.manage`. A personal one is its owner's alone
 * (they must still hold `manage_personal`), with one exception: an admin may DISCONNECT anyone's personal mailbox (offboarding, freeing a seat of
 * the plan) without being able to read it. Reconnecting is only ever the owner (their login is theirs).
 */
export function mayAct(actor: MailActor, row: MailboxOwnership, action: MailboxAction): boolean {
  if (row.scope === 'shared') return actor.canManageShared;
  if (isOwner(actor, row)) return actor.canManagePersonal;
  return action === 'disconnect' && actor.isAdmin;
}

/** Why a NEW personal mailbox cannot be connected by this person right now, or null when they may. */
export function personalConnectRefusal(
  actor: MailActor,
  policy: Pick<MailWorkspaceSettings, 'personalMailboxesEnabled' | 'whoMayConnectPersonal'>,
): 'disabled' | 'not_allowed' | null {
  if (!policy.personalMailboxesEnabled) return 'disabled';
  const allowed =
    policy.whoMayConnectPersonal === 'admins' ? actor.isAdmin : actor.canManagePersonal;
  return allowed ? null : 'not_allowed';
}

export const personalDisabled = () =>
  new AppError(
    ERROR_CODES.MAIL_PERSONAL_DISABLED,
    'Personal mailboxes are not enabled for this workspace.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const personalNotAllowed = () =>
  new AppError(
    ERROR_CODES.MAIL_PERSONAL_NOT_ALLOWED,
    'You are not allowed to connect a personal mailbox in this workspace.',
    HttpStatus.FORBIDDEN,
  );
