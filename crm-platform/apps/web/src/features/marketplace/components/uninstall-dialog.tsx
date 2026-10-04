'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { MarketDataChoice } from '@crm/contracts';
import { Alert, ConfirmDialog } from '@crm/ui';
import { DATA_CHOICES, DEFAULT_DATA_CHOICE, isDataChoice } from '../lib/manage';
import type { UninstallRenewal } from '../lib/pricing';
import { ErrorLine } from './ui';

/**
 * Uninstall: access ends at once, and the person chooses what happens to the data the app created. The note is honest about the
 * current limit: the platform deletes no contact itself, so contacts stay either way until a data-deletion consumer exists.
 * A paid app on a running subscription also says what uninstalling does to it: renewal stops, nothing more is charged, and the
 * period already paid for stays the workspace's (`renewal` is null for a free app, a trial, a comp or one not renewing).
 */
export function UninstallDialog({
  open,
  name,
  hasConnection,
  renewal = null,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  name: string;
  hasConnection: boolean;
  renewal?: UninstallRenewal | null;
  busy: boolean;
  error: unknown;
  onConfirm: (choice: MarketDataChoice) => void;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.manage.uninstall');
  const f = useFormatter();
  const [choice, setChoice] = useState<MarketDataChoice>(DEFAULT_DATA_CHOICE);
  const paidUntil = renewal?.paidUntil
    ? f.dateTime(new Date(renewal.paidUntil), { dateStyle: 'medium' })
    : null;
  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={t('title', { name })}
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      busy={busy}
      onConfirm={() => onConfirm(choice)}
      onClose={onClose}
      message={
        <div className="space-y-4">
          <p>{hasConnection ? t('effectConnection') : t('effect')}</p>
          {renewal && (
            <Alert tone="warning" data-testid="uninstall-renewal">
              <p className="font-medium">{t('renewal.title')}</p>
              <p>
                {paidUntil ? t('renewal.messageUntil', { date: paidUntil }) : t('renewal.message')}
              </p>
            </Alert>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-foreground">{t('dataLegend')}</legend>
            {DATA_CHOICES.map((c) => (
              <label
                key={c}
                htmlFor={`mkt-data-${c}`}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-foreground has-[:checked]:border-primary"
              >
                <input
                  id={`mkt-data-${c}`}
                  type="radio"
                  name="mkt-data-choice"
                  value={c}
                  checked={choice === c}
                  disabled={busy}
                  onChange={(e) => {
                    if (isDataChoice(e.target.value)) setChoice(e.target.value);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">{t(`choices.${c}.label`)}</span>
                  <span className="block text-muted-foreground">{t(`choices.${c}.help`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="rounded-md bg-muted p-2 text-xs">{t('honestNote')}</p>
          <p className="text-xs">{t('irreversible')}</p>
          {error ? <ErrorLine error={error} /> : null}
        </div>
      }
    />
  );
}
