'use client';

import { useTranslations } from 'next-intl';
import { Button, Spinner, useToast } from '@crm/ui';
import type { ContactMeetingResponse } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useRetryConferencing } from '../api/conferencing';
import { safeHref } from '../lib/status-model';

/**
 * What a meeting row says about its video link and calendar entry (BL-360..BL-362): the provider, a Join button when there is a link, a
 * plain sentence when a step did not work with a Try again button, and whether the meeting is on the calendar. A meeting that asked for
 * none of this draws nothing, so the row is exactly what it was.
 */
export function MeetingVideoStatus({
  meeting,
  listKey,
  contactId,
}: {
  meeting: ContactMeetingResponse;
  /** The query key of the contact's meetings list, refreshed after a retry. */
  listKey: readonly unknown[];
  contactId: string;
}) {
  const c = meeting.conferencing;
  const t = useTranslations('meeting-conferencing.row');
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const retry = useRetryConferencing(contactId, listKey);
  if (!c) return null;

  const provider = c.videoProvider ? t(`provider.${c.videoProvider}`) : '';
  const href = safeHref(meeting.joinUrl);
  const failedVideo = c.videoStatus === 'failed';
  const failedCalendar = c.calendarStatus === 'failed';
  const pending = c.videoStatus === 'pending' && !failedVideo;
  const own = !meeting.id.startsWith('pending-');

  const problemText =
    failedVideo && c.videoError ? t(`problem.${c.videoError}`, { provider }) : null;
  const calendarText = failedCalendar
    ? c.calendarError === 'calendar_not_connected' || c.calendarError === 'provider_failed'
      ? t(`calendarProblem.${c.calendarError}`)
      : t('calendarProblem.other')
    : null;

  const onRetry = () =>
    retry.mutate(meeting.id, {
      onSuccess: (m) =>
        toast(
          m.conferencing?.videoStatus === 'failed' || m.conferencing?.calendarStatus === 'failed'
            ? t('retryFailed')
            : t('retried'),
        ),
      onError: () => toast(t('retryFailed'), 'danger'),
    });

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {c.videoProvider && (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {provider}
          </span>
        )}
        {href && c.videoStatus === 'ready' && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('joinAria', { provider, title: meeting.title })}
            className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            {t('join')}
          </a>
        )}
        {pending && own && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner /> {t('pending')}
          </span>
        )}
        {c.calendarStatus === 'synced' && (
          <span className="text-xs text-muted-foreground">
            {c.invited ? t('invited') : t('onCalendar')}
          </span>
        )}
      </div>
      {(problemText || calendarText) && (
        <div role="status" className="space-y-1">
          {problemText && <p className="text-xs text-danger">{problemText}</p>}
          {calendarText && <p className="text-xs text-danger">{calendarText}</p>}
          {canUpdate && own && (
            <Button
              variant="secondary"
              size="sm"
              disabled={retry.isPending}
              onClick={onRetry}
              aria-label={t('retry')}
            >
              {retry.isPending && <Spinner />}
              {retry.isPending ? t('retrying') : t('retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
