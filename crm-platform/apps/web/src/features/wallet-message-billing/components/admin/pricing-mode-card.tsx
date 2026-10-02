'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PricingMode, WalletSettings } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, cn } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { MODES, modeChanged, pricingModeBody } from '../../lib/pricing-mode';

/**
 * "How customers are priced": typed fixed prices per message, or Meta's cost plus a margin. It is saved on its own (a PUT of this
 * one switch) after a confirmation that says what changes for every workspace.
 */
export function PricingModeCard({
  settings,
  canEdit,
}: {
  settings: WalletSettings;
  canEdit: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.pricing.mode');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const saved = settings.pricingMode;
  const [draft, setDraft] = useState<PricingMode>(saved);
  const [confirm, setConfirm] = useState(false);
  const changed = modeChanged(saved, draft);

  const save = useMutation({
    mutationFn: () => operatorApi.saveSwitches(pricingModeBody(draft)),
    onSuccess: (next) => {
      qc.setQueryData(KEYS.settings, next);
      void qc.invalidateQueries({ queryKey: KEYS.marginsAll });
      setDraft(next.pricingMode);
      setConfirm(false);
      toast.success(t(next.pricingMode === 'margin' ? 'savedMargin' : 'savedFixed'));
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(te(errorKind(err)));
    },
  });

  return (
    <Card id="pricing-mode" className="scroll-mt-6 space-y-4">
      <fieldset className="space-y-3" disabled={!canEdit || save.isPending}>
        <legend className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {t('title')}
          <Badge tone={saved === 'margin' ? 'success' : 'neutral'}>
            {t('current', { mode: t(`${saved}.label`) })}
          </Badge>
        </legend>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {MODES.map((mode) => (
            <label
              key={mode}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                draft === mode ? 'border-primary bg-primary/5' : 'border-border',
                !canEdit && 'cursor-default',
              )}
            >
              <input
                type="radio"
                name="pricing-mode"
                value={mode}
                checked={draft === mode}
                onChange={() => setDraft(mode)}
                className="mt-1 size-4 accent-primary"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">{t(`${mode}.label`)}</span>
                <span className="block text-muted-foreground">{t(`${mode}.body`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button onClick={() => setConfirm(true)} disabled={!changed || save.isPending}>
            {t('save')}
          </Button>
        )}
        <Link href="/admin/wallet/margins" className="text-sm font-medium underline">
          {t('manage')}
        </Link>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('confirmTitle')}
        message={t(draft === 'margin' ? 'confirmMargin' : 'confirmFixed')}
        confirmLabel={t('confirm')}
        cancelLabel={tc('cancel')}
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}
