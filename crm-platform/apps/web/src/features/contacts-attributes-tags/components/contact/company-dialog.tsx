'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Modal, useToast } from '@crm/ui';
import { CompanyPicker } from '@/features/companies';
import { updateContact } from '../../api/contacts';
import type { ContactRow } from '../../api/schemas';
import { errorKind } from '../../lib/errors';
import { useRefreshContact } from './shared';

/**
 * "Add company" / "Change company": pick a company (or make one, for those who may) and the contact is saved with it, carrying the
 * row version it was read with. Picking nothing again (the picker's clear) removes the link. Render it only for someone who may
 * update contacts and read companies; the server checks the same rules.
 */
export function CompanyDialog({
  open,
  contact,
  onClose,
}: {
  open: boolean;
  contact: ContactRow;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.actions');
  const { toast } = useToast();
  const refresh = useRefreshContact(contact.id);

  const save = useMutation({
    mutationFn: (companyId: string | null) =>
      updateContact(contact.id, { companyId, rowVersion: contact.rowVersion }),
    onSuccess: async () => {
      onClose();
      await refresh();
      toast(t('companySaved'), 'success');
    },
    onError: async (e) => {
      const conflict = errorKind(e) === 'conflict';
      toast(t(conflict ? 'conflict' : 'companyFailed'), 'danger');
      if (conflict) await refresh();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact.companyId ? t('changeCompany') : t('addCompany')}
      closeLabel={t('close')}
    >
      {open && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('companyHint')}</p>
          <CompanyPicker
            value={contact.companyId ? { id: contact.companyId } : null}
            onChange={(next) => save.mutate(next ? next.id : null)}
            disabled={save.isPending}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
