'use client';

import { useTranslations } from 'next-intl';
import { useGroupCountForRemoval } from '../api/groups-hooks';

/**
 * The confirm text of "Remove number" plus, when the number has group records, what goes with it (decision D6: removing a number keeps
 * cascading its `waba_groups` rows, with a warning). The groups themselves stay on WhatsApp and their chats stay in the inbox. A failed
 * lookup (no permission) shows the plain message: the warning is a courtesy, the removal's own checks decide.
 */
export function RemoveNumberMessage({ id, message }: { id: string; message: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const count = useGroupCountForRemoval(id);
  const n = count.data?.count ?? 0;
  return (
    <>
      {message}
      {n > 0 && (
        <span className="mt-2 block font-medium" data-testid="remove-number-groups-warning">
          {t('removeNumberWarning', { count: n })}
        </span>
      )}
    </>
  );
}
