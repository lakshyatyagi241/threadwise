'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import type { BookingSettings } from '../api/schemas';
import { relativeTime } from '../lib/relative';
import { CalendarIcon, CheckIcon } from './icons';
import { ToneChip, useNow } from './parts';
import { SettingsCard } from './settings-parts';

const BENEFITS = ['freeBusy', 'nextSlots', 'writeBack'] as const;

/**
 * The Google Calendar link of the workspace, as the server reports it. The Google Calendar adapter is not built, so there is
 * no connect button here: `unavailable` and `disconnected` both say so, and `connected` (once it exists) shows which calendar
 * and since when. What the link would do is listed as information, and the hint says bookings work without it.
 */
export function CalendarCard({ calendar }: { calendar: BookingSettings['calendar'] }) {
  const t = useTranslations('appointments.settings.calendar');
  const locale = useLocale();
  const now = useNow();
  const connected = calendar.status === 'connected';
  const ago = relativeTime(calendar.connectedAt, now, locale);

  return (
    <SettingsCard id="calendar" title={t('title')} description={t('description')}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <CalendarIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('provider')}</div>
          <div className="text-xs text-muted-foreground">{t('providerSub')}</div>
        </div>
        <ToneChip
          tone={connected ? 'success' : calendar.status === 'unavailable' ? 'warning' : 'neutral'}
          label={t(`status.${calendar.status}`)}
        />
      </div>

      {connected ? (
        <p className="text-sm text-muted-foreground">
          {t('connectedTo', { name: calendar.calendarName ?? calendar.calendarId ?? '—' })}
          {ago && ` · ${t('connectedAgo', { when: ago })}`}
        </p>
      ) : (
        <Alert tone="warning">
          <p className="font-medium">{t('unavailableTitle')}</p>
          <p className="mt-0.5 text-xs">{t('unavailableBody')}</p>
        </Alert>
      )}

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('whatTitle')}
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(`what.${b}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </SettingsCard>
  );
}
