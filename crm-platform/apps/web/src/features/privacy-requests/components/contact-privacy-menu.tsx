'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { PrivacyRequestType } from '@crm/contracts';
import { Menu, MenuItem, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from '../api/hooks';
import { privacyApi } from '../api/service';

/**
 * The "Privacy" menu of a contact profile: export this person's data, or erase them. Each opens a data request for the contact (channel
 * "entered by staff") and goes to it, where identity is checked and the work is previewed and confirmed. Shown only to people who may
 * manage data requests; erasing also needs the erase permission.
 */
export function ContactPrivacyMenu({ contactId }: { contactId: string }) {
  const t = useTranslations('privacy-requests.contactMenu');
  const canManage = useCan('privacy.requests.manage');
  const canErase = useCan('privacy.erase.execute');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: (requestType: PrivacyRequestType) =>
      privacyApi.create({
        requestType,
        subject: { kind: 'contact', id: contactId },
        requesterChannel: 'staff',
        historyMode: 'delete',
      }),
    onSuccess: async (made) => {
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(t('created', { reference: made.reference }), 'success');
      router.push(`/privacy-requests/${made.id}`);
    },
    onError: () => toast(t('failed'), 'danger'),
  });
  if (!canManage) return null;
  return (
    <Menu label={t('group')} trigger={t('group')} align="end" disabled={create.isPending}>
      <MenuItem onSelect={() => create.mutate('export')}>{t('export')}</MenuItem>
      {canErase && (
        <MenuItem danger onSelect={() => create.mutate('erasure')}>
          {t('erase')}
        </MenuItem>
      )}
    </Menu>
  );
}
