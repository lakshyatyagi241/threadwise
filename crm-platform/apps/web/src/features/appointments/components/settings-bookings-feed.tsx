'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, ConfirmDialog, Field, Input, Spinner, useToast } from '@crm/ui';
import { KEYS, useBookingsFeed } from '../api/hooks';
import { calendarsApi } from '../api/calendars-service';
import { toWebcal } from '../lib/calendars';
import { relativeTime } from '../lib/relative';
import { ErrorLine, useAppointmentsCan, useNow } from './parts';
import { SettingsCard } from './settings-parts';

/**
 * The signed-in person's own bookings as a calendar subscription (BL-035): a link for Apple Calendar, Outlook or Google Calendar ("subscribe by
 * address"). The link is theirs alone, a new one replaces the old at once, and ending it stops the feed. What it shows follows what the person
 * can see in the bookings list today.
 */
export function BookingsFeedCard() {
  const t = useTranslations('appointments.settings.bookingsFeed');
  const locale = useLocale();
  const now = useNow();
  const can = useAppointmentsCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useBookingsFeed(can.read);
  const [busy, setBusy] = useState<'make' | 'stop' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<'rotate' | 'stop' | null>(null);

  if (!can.read) return null;
  const link = query.data;
  const reload = () => qc.invalidateQueries({ queryKey: KEYS.bookingsFeed });

  async function make() {
    setBusy('make');
    setError(null);
    try {
      qc.setQueryData(KEYS.bookingsFeed, await calendarsApi.makeBookingsFeed());
      setConfirm(null);
      toast(t('made'));
    } catch (e) {
      setConfirm(null);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    setError(null);
    try {
      await calendarsApi.stopBookingsFeed();
      setConfirm(null);
      await reload();
      toast(t('stopped'));
    } catch (e) {
      setConfirm(null);
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'));
    } catch {
      // No clipboard permission: the field is selectable, the person copies it by hand.
      toast(t('copyFailed'));
    }
  }

  return (
    <SettingsCard id="bookings-feed" title={t('title')} description={t('description')}>
      {query.isPending ? (
        <Spinner label={t('loading')} />
      ) : query.isError || !link ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : link.url === null ? (
        <>
          <p className="text-sm text-muted-foreground">{t('none')}</p>
          <div>
            <Button variant="brand" disabled={busy !== null} onClick={() => void make()}>
              {busy === 'make' ? t('making') : t('make')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field label={t('linkLabel')} htmlFor="bookings-feed-url">
            <Input
              id="bookings-feed-url"
              dir="ltr"
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            {link.lastUsedAt
              ? t('lastUsed', { when: relativeTime(link.lastUsedAt, now, locale) || '—' })
              : t('neverUsed')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" onClick={() => void copy(link.url!)}>
              {t('copy')}
            </Button>
            <a
              href={toWebcal(link.url)}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('open')}
            </a>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setConfirm('rotate')}
            >
              {t('rotate')}
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirm('stop')}>
              {t('stop')}
            </Button>
          </div>
          <Alert tone="warning">
            <p className="text-xs">{t('warning')}</p>
          </Alert>
        </>
      )}

      {error !== null && <ErrorLine error={error} />}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'stop' ? t('confirmStop.title') : t('confirmRotate.title')}
        message={confirm === 'stop' ? t('confirmStop.message') : t('confirmRotate.message')}
        confirmLabel={confirm === 'stop' ? t('confirmStop.confirm') : t('confirmRotate.confirm')}
        cancelLabel={t('confirmCancel')}
        tone="danger"
        busy={busy !== null}
        onConfirm={() => void (confirm === 'stop' ? stop() : make())}
        onClose={() => setConfirm(null)}
      />
    </SettingsCard>
  );
}
