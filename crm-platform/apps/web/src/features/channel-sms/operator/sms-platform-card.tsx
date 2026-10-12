'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { smsPlatformStateSchema } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from '@/features/node-bridge-runtime/lib/errors';
import { SMS_PLATFORM_QUERY_KEY } from './queries';

const NS = 'sms.operator';

/**
 * The platform switch for the SMS channel. Off is the default: workspaces see no SMS menu, pickers or template channel. Turning it
 * on is one click; turning it off asks for a confirmation (every workspace loses the entry points at once, though no sender,
 * template or running send is touched).
 */
export function SmsPlatformCard({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const status = enabled ? 'enabled' : 'disabled';

  const change = useMutation({
    mutationFn: (next: boolean) =>
      operatorFetch('/sms', {
        method: 'PUT',
        body: { enabled: next },
        schema: smsPlatformStateSchema,
      }),
    onSuccess: async (state) => {
      toast.success(t(state.enabled ? 'enabledToast' : 'disabledToast'));
      setConfirmOff(false);
      await qc.invalidateQueries({ queryKey: SMS_PLATFORM_QUERY_KEY });
    },
    onError: (err) => {
      setConfirmOff(false);
      toast.error(t(`errors.${errorKind(err)}`));
    },
  });

  return (
    <Card className="space-y-4 border-2" data-testid="sms-platform-card" data-state={status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <Badge tone={enabled ? 'success' : 'neutral'} data-testid="sms-platform-status">
          {t(`status.${status}`)}
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('explanation')}</p>
      <p className="max-w-3xl text-sm">{t(`state.${status}`)}</p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            disabled={change.isPending}
            onClick={() => (enabled ? setConfirmOff(true) : change.mutate(true))}
            id="sms-platform-toggle"
            data-testid="sms-platform-toggle"
          >
            {t(enabled ? 'disable' : 'enable')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOff}
        title={t('disableDialog.title')}
        message={t('disableDialog.body')}
        confirmLabel={t('disableDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={change.isPending}
        onConfirm={() => change.mutate(false)}
        onClose={() => setConfirmOff(false)}
      />
    </Card>
  );
}
