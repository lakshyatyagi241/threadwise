'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { WizardCreditCheck, WizardDraft, WizardTemplate } from '@crm/contracts';
import { Alert, ConfirmDialog } from '@crm/ui';
import { launchKind } from '../lib/schedule';
import { formatMinor } from '../lib/money';
import { useScheduleWords } from './use-words';

/** The last look before a launch: what is sent, to how many, at what cost, when and with which retry rule. */
export function LaunchDialog({
  open,
  busy,
  error,
  draft,
  template,
  credit,
  recipients,
  skipped,
  onConfirm,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  draft: WizardDraft;
  template: WizardTemplate | null;
  credit: WizardCreditCheck | undefined;
  recipients: number | undefined;
  skipped: number | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('campaigns.wizard.launch');
  const locale = useLocale();
  const words = useScheduleWords();
  const kind = launchKind(draft.schedule);
  const rows: Array<[string, string]> = [
    [t('name'), draft.name],
    [t('template'), template ? `${template.name} (${template.language})` : '-'],
    [t('recipients'), recipients === undefined ? '-' : recipients.toLocaleString()],
    [t('skipped'), skipped === undefined ? '-' : skipped.toLocaleString()],
    [t('cost'), credit ? formatMinor(credit.estimatedCostMinor, credit.currency, locale) : '-'],
    [t('when'), words.schedule(draft.schedule)],
    [
      t('retries'),
      draft.retries.enabled && draft.retries.endDate
        ? t('retriesOn', { date: words.date(draft.retries.endDate) })
        : t('retriesOff'),
    ],
  ];
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      title={t(`title.${kind}`)}
      confirmLabel={t(`confirm.${kind}`)}
      cancelLabel={t('cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
      message={
        <div className="space-y-3">
          <dl className="divide-y divide-border text-foreground">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {kind === 'recurring' && <p className="text-xs">{t('recurringNote')}</p>}
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      }
    />
  );
}
