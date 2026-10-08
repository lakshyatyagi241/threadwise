'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, cancelAddonRenewal } from '../api';

const NS = 'addons-extension-registry.workspace.renewal';

/** "Cancel renewal" for one owned add-on that renews by autopay: the paid term keeps running, so the confirmation says so. */
export function CancelAddonRenewal({ addonId }: { addonId: string }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () => cancelAddonRenewal(addonId),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: KEYS.workspace });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 403
          ? t('forbidden')
          : e instanceof ApiError && e.code === 'PLAN_NO_SUBSCRIPTION'
            ? t('none')
            : t('failed'),
      ),
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        data-testid="cancel-addon-renewal"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t('cancel')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('confirmTitle')}
        message={
          <>
            <p>{t('confirmBody')}</p>
            {error && <p className="mt-2 text-danger">{error}</p>}
          </>
        }
        confirmLabel={t('confirm')}
        cancelLabel={t('keep')}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
