'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@crm/ui';

/**
 * What a contact delete removes, and the choice to keep the conversation history without the person's identity. Shown inside the
 * delete confirmations (one contact or a selection). Unchecked means the history is erased with the contact.
 */
export function DeleteHistoryOption({
  many,
  keepHistory,
  onChange,
}: {
  many?: boolean;
  keepHistory: boolean;
  onChange: (keep: boolean) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.erase');
  // Several confirmations (the list's, the selection's, the quick view's) can be on the page at once: one id each.
  const id = useId();
  return (
    <div className="mt-3 space-y-3">
      <p>{many ? t('scopeMany') : t('scope')}</p>
      <Checkbox
        id={id}
        label={t('keepHistory')}
        checked={keepHistory}
        onChange={(e) => onChange(e.target.checked)}
      />
      <p className="text-xs">{t('keepHistoryHint')}</p>
    </div>
  );
}
