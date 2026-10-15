import type { EmailReplyExtras, MailSignatureResponse } from '@crm/contracts';
import { fillSignatureVariables, sanitizeHtml, type SignatureVariables } from './rich-text';

/** What the composer's signature picker holds: the default the server would pick, none, or one chosen signature. */
export type SignatureChoice = { kind: 'auto' } | { kind: 'none' } | { kind: 'id'; id: string };

export const AUTO_SIGNATURE: SignatureChoice = { kind: 'auto' };

/**
 * The signature a reply gets when the agent does not choose (the server's order): the sender's own default, else the default of the
 * mailbox the reply goes out from, else none.
 */
export function autoSignature(
  list: readonly MailSignatureResponse[],
  mailboxId: string | undefined,
  userId: string,
): MailSignatureResponse | null {
  const own = list.find((s) => s.scope === 'user' && s.userId === userId && s.isDefault);
  if (own) return own;
  return (
    list.find((s) => s.scope === 'mailbox' && s.mailboxId === mailboxId && s.isDefault) ?? null
  );
}

/** The signatures the picker offers on a mailbox: the sender's own and the mailbox's. */
export const pickable = (
  list: readonly MailSignatureResponse[],
  mailboxId: string | undefined,
  userId: string,
): MailSignatureResponse[] =>
  list.filter(
    (s) =>
      (s.scope === 'user' && s.userId === userId) ||
      (s.scope === 'mailbox' && s.mailboxId === mailboxId),
  );

/** The signature that will be added for a choice (null = none). */
export function chosenSignature(
  choice: SignatureChoice,
  list: readonly MailSignatureResponse[],
  mailboxId: string | undefined,
  userId: string,
): MailSignatureResponse | null {
  if (choice.kind === 'none') return null;
  if (choice.kind === 'id') return list.find((s) => s.id === choice.id) ?? null;
  return autoSignature(list, mailboxId, userId);
}

/** The reply fields for a choice: nothing for the default, `signature: false` for none, the id for a chosen one. */
export function signatureExtras(choice: SignatureChoice): Partial<EmailReplyExtras> {
  if (choice.kind === 'none') return { signature: false };
  if (choice.kind === 'id') return { signatureId: choice.id };
  return {};
}

/** The signature as it will look: variables filled for the sender, then cleaned. Safe to put in the page. */
export const signaturePreviewHtml = (
  sig: MailSignatureResponse,
  vars: SignatureVariables,
): string => sanitizeHtml(fillSignatureVariables(sig.bodyHtml, vars));

/** The sender's values for `{{name}}`, `{{title}}`, `{{phone}}` (the title is not part of the session: the server fills it). */
export function variablesOf(user: {
  fullName: string;
  displayName: string | null;
  phone: string | null;
}): SignatureVariables {
  return { name: user.displayName?.trim() || user.fullName, title: '', phone: user.phone ?? '' };
}

/** Who may edit or delete a signature: their own user signatures, and mailbox signatures for people who manage mailboxes. */
export function canEditSignature(
  sig: Pick<MailSignatureResponse, 'scope' | 'userId'>,
  who: { userId: string; canManageSignatures: boolean; canManageMailboxes: boolean },
): boolean {
  if (!who.canManageSignatures) return false;
  return sig.scope === 'user' ? sig.userId === who.userId : who.canManageMailboxes;
}
