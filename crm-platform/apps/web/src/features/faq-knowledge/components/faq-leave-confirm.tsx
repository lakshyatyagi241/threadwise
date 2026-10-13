'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@crm/ui';

/** Asked by the builder when someone leaves the FAQs tab while one of its screens holds unsaved edits. */
export function FaqLeaveConfirm({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const t = useTranslations('faq.panel.leave');
  return (
    <ConfirmDialog
      open={open}
      title={t('title')}
      message={t('body')}
      confirmLabel={t('leave')}
      cancelLabel={t('stay')}
      tone="danger"
      onClose={onStay}
      onConfirm={onLeave}
    />
  );
}
