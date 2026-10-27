'use client';

import { useTranslations } from 'next-intl';
import { Modal, Spinner } from '@crm/ui';
import { usePipelines } from '../api/hooks';
import type { ContactRef, Deal } from '../api/schemas';
import { DealFormModal } from './deal-form-modal';

/**
 * "Add deal" from a contact's own page: the same form as the Deals page, opened where the person already is, with the contact filled in
 * and fixed, in the workspace's default pipeline (a choice of pipeline when there are several). Nothing leaves the contact's page.
 * Mount it only while it is open.
 */
export function NewDealForContact({
  contact,
  onClose,
  onCreated,
}: {
  contact: ContactRef;
  onClose: () => void;
  onCreated: (deal: Deal) => void;
}) {
  const t = useTranslations('deals-pipelines.form');
  const pipelines = usePipelines();
  const all = pipelines.data ?? [];
  const first = all.find((p) => p.isDefault) ?? all[0];
  if (pipelines.isPending || !first) {
    return (
      <Modal open size="md" onClose={onClose} title={t('title')} closeLabel={t('close')}>
        {pipelines.isPending ? (
          <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> {t('loadingPipelines')}
          </div>
        ) : (
          <p role="alert" className="py-6 text-sm text-muted-foreground">
            {pipelines.isError ? t('pipelinesFailed') : t('noPipelines')}
          </p>
        )}
      </Modal>
    );
  }
  return (
    <DealFormModal
      pipeline={first}
      pipelines={all}
      lockedContact={contact}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
