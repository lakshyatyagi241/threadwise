'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useWizardBroadcasts } from '../api/wizard';
import { statusTone } from '../lib/broadcast';
import { scheduleZone } from '../lib/schedule';
import { Chip } from './parts';
import { useScheduleWords } from './use-words';

/**
 * The broadcasts made with the Create broadcast wizard, newest first, at the top of the Broadcasts list: a wizard broadcast is a
 * campaign or a recurring series, so it is not a row of the classic list below. Shows nothing until there is one.
 */
export function WizardBroadcastsPanel() {
  const t = useTranslations('campaigns.wizard.panel');
  const ts = useTranslations('campaigns.wizard.status.state');
  const canRead = useCan('camp.campaigns.read');
  const list = useWizardBroadcasts();
  const words = useScheduleWords();
  if (!canRead || list.isPending || list.isError || list.data.data.length === 0) return null;
  return (
    <section
      aria-label={t('title')}
      className="mb-6 overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-lg leading-tight">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <ul className="divide-y divide-border">
        {list.data.data.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <Link
                href={`/campaigns/wizard/broadcasts/${b.id}`}
                className="font-medium text-brand hover:underline"
              >
                {b.name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t(`mode.${b.mode}`)}</span>
                {b.templateName && <span>{b.templateName}</span>}
                <span>{t('recipients', { count: b.recipients })}</span>
                {b.nextRunAt && (
                  <span>
                    {t('next', {
                      when: words.instant(new Date(b.nextRunAt), scheduleZone(b.schedule)),
                    })}
                  </span>
                )}
              </div>
            </div>
            <Chip tone={statusTone(b.status)}>{ts(b.status)}</Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}
