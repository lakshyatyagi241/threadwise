'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useRiskNotice } from '../api/devices';
import { formatWhen } from '../lib/format';
import { ErrorNotice } from './error-notice';
import { RiskNotice } from './risk-notice';
import { useErrorText } from './use-error-text';

/** `/devices/notice`: the notice again, with the version and the date this person accepted it (spec 13.2). */
export function NoticeScreen() {
  const t = useTranslations('whatsapp-devices-baileys.notice');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const errorText = useErrorText();
  const q = useRiskNotice();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link href="/devices" className="inline-block text-sm underline">
        {t('backToList')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('pageIntro')}</p>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNotice error={errorText(q.error)} />
      ) : (
        <>
          <Alert tone={q.data.accepted ? 'success' : 'info'} data-testid="notice-standing">
            {q.data.accepted
              ? t('acceptedOn', {
                  version: q.data.version,
                  date: formatWhen(q.data.acceptedAt, locale, timeZone) ?? '-',
                })
              : t('notAccepted')}
          </Alert>
          <RiskNotice version={q.data.version} />
        </>
      )}
    </div>
  );
}
