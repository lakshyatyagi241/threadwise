'use client';

import { useTranslations } from 'next-intl';

/**
 * The mailboxes as a group of the inbox channel filter (TW-MAIL-024): every mailbox is its own inbox, listed under an Email heading
 * so several of them stay easy to tell apart from the other channels. Renders nothing when there is no mailbox.
 */
export function EmailChannelOptions({
  channels,
}: {
  channels: ReadonlyArray<{ id: string; name: string; kind: string }>;
}) {
  const t = useTranslations('email.inbox');
  const mail = channels.filter((c) => c.kind === 'email');
  if (mail.length === 0) return null;
  return (
    <optgroup label={t('group')} data-testid="inbox-email-group">
      {mail.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </optgroup>
  );
}
