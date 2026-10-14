'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, cn } from '@crm/ui';
import { PLAN_UPGRADE_PATH, type HistoryImportMode } from '@crm/contracts';
import { HISTORY_CHOICES } from '../lib/history-model';

const NS = 'whatsapp-devices-baileys.history.choice';

/**
 * The step before the QR: bring the existing chats in, or start empty. WhatsApp sends a number's history only right after it is first
 * linked, so the choice cannot wait until the scan has happened. `none` is the default and never pre-ticks anything else.
 */
export function HistoryChoice({
  value,
  onChange,
  fullAllowed = true,
}: {
  value: HistoryImportMode;
  onChange: (v: HistoryImportMode) => void;
  /** False when the plan lacks the full-history feature: that option is shown but disabled, with a pointer to the plans. */
  fullAllowed?: boolean;
}) {
  const t = useTranslations(NS);
  return (
    <fieldset className="space-y-3" data-testid="history-choice">
      <div>
        <legend className="text-base font-semibold">{t('title')}</legend>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <div role="radiogroup" aria-label={t('label')} className="grid gap-2">
        {HISTORY_CHOICES.map((m) => {
          const locked = m === 'full' && !fullAllowed;
          return (
            <label
              key={m}
              className={cn(
                'flex items-start gap-2 rounded-md border p-3 text-sm',
                locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                value === m ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="wadev-history"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={value === m}
                disabled={locked}
                aria-describedby={locked ? 'history-full-locked' : undefined}
                onChange={() => onChange(m)}
                data-testid={`history-${m}`}
              />
              <span>
                <span className="block font-medium">{t(m)}</span>
                <span className="block text-xs text-muted-foreground">{t(`${m}Help`)}</span>
                {locked && (
                  <span
                    id="history-full-locked"
                    data-testid="history-full-locked"
                    className="mt-1 block text-xs"
                  >
                    {t('fullLocked')}{' '}
                    <Link href={PLAN_UPGRADE_PATH} className="font-semibold underline">
                      {t('fullLockedLink')}
                    </Link>
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {value !== 'none' && (
        <Alert tone="info" data-testid="history-points">
          <p className="mb-1 font-medium">{t('pointsTitle')}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {(
              [
                'pointQuiet',
                'pointNothingSent',
                'pointMedia',
                'pointGroups',
                'pointConsent',
                'pointLimit',
                'pointTime',
                'pointOnce',
              ] as const
            ).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Alert>
      )}
    </fieldset>
  );
}
