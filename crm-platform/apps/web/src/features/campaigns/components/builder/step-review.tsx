'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { editorType, problems, type BuilderForm, type Problem } from '../../lib/builder-model';
import type { RecipientTotals, WizardStep } from '../../lib/wizard-model';
import { stepOf } from '../../lib/wizard-model';
import { StepCard } from './parts';

const CHECKS: Array<{ key: string; fails: Problem[] }> = [
  { key: 'name', fails: ['name'] },
  { key: 'sender', fails: ['sender'] },
  { key: 'content', fails: ['message', 'template', 'flow', 'media'] },
  { key: 'audience', fails: ['audience'] },
  { key: 'schedule', fails: ['date', 'time', 'window', 'throttle', 'expiry'] },
];

/**
 * Step 5 (WD-CAMP-010): confirm. The sender, type, recipients and schedule in one block, a validation checklist whose failing rows
 * take you to the step that fixes them, and the recipient counts the way the queue will be built.
 */
export function StepReview({
  form,
  senderLabel,
  scheduleLabel,
  totals,
  onGo,
}: {
  form: BuilderForm;
  senderLabel: string;
  scheduleLabel: string;
  totals: RecipientTotals;
  onGo: (s: WizardStep) => void;
}) {
  const t = useTranslations('campaigns.builder.review');
  const bad = problems(form);
  const kind = editorType(form.type);
  const rows: Array<[string, string]> = [
    [t('device'), senderLabel],
    [t('type'), t(`types.${kind === 'text' ? 'custom' : kind}`)],
    [t('recipients'), String(totals.total)],
    [t('schedule'), scheduleLabel],
  ];
  return (
    <StepCard index="05" title={t('title')} tag={t('tag')}>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {k}
            </dt>
            <dd className="mt-1 break-words text-[14px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-[13px] font-semibold">{t('checklist')}</h3>
          <ul className="space-y-1.5">
            {CHECKS.map((c) => {
              const failing = bad.find((p) => c.fails.includes(p));
              return (
                <li key={c.key} className="flex items-start gap-2 text-[12.5px]">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                      failing ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand',
                    )}
                  >
                    {failing ? '!' : '✓'}
                  </span>
                  {failing ? (
                    <button
                      type="button"
                      className="text-start text-danger hover:underline"
                      onClick={() => onGo(stepOf(failing))}
                    >
                      {t(`problems.${failing}`)}
                    </button>
                  ) : (
                    <span>{t(`checks.${c.key}`)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-[13px] font-semibold">{t('summary')}</h3>
          <dl className="space-y-1.5 text-[12.5px]">
            <div className="flex justify-between">
              <dt>{t('groups')}</dt>
              <dd className="font-semibold">{totals.groups}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('contacts')}</dt>
              <dd className="font-semibold">{totals.contacts}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('numbers')}</dt>
              <dd className="font-semibold">{totals.numbers}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <dt>{t('total')}</dt>
              <dd className="font-semibold">{totals.total}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">{t('estimate')}</p>
        </div>
      </div>
    </StepCard>
  );
}
