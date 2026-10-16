'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Alert, Button, ConfirmDialog, Field, Input, Spinner, Switch, useToast } from '@crm/ui';
import { ICS_FEED_LIMIT, type IcsFeed } from '@crm/contracts';
import { KEYS, useIcsFeeds } from '../api/hooks';
import { calendarsApi } from '../api/calendars-service';
import { icsFailure } from '../lib/calendars';
import { relativeTime } from '../lib/relative';
import { CalendarIcon } from './icons';
import { ErrorLine, ToneChip, useAppointmentsCan, useNow } from './parts';
import { SettingsCard } from './settings-parts';

const TONE = { ok: 'success', error: 'danger', pending: 'neutral' } as const;

/**
 * Read-only iCal subscriptions (BL-035): calendars the workspace cannot connect with a sign-in (Apple, Fastmail, a timetable, a calendar published as a
 * secret address). They contribute BUSY TIME only. The address is read once when it is added, so a wrong one is told at once; it is then stored
 * encrypted and never shown again (only its host is), because published-calendar addresses carry a secret.
 */
export function IcsFeedsCard() {
  const t = useTranslations('appointments.settings.feeds');
  const locale = useLocale();
  const now = useNow();
  const can = useAppointmentsCan();
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useIcsFeeds();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [blockAllDay, setBlockAllDay] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<IcsFeed | null>(null);

  const feeds = query.data?.data ?? [];
  const reload = () => qc.invalidateQueries({ queryKey: KEYS.icsFeeds });
  const failure = icsFailure(error);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    setError(null);
    try {
      await calendarsApi.createIcsFeed({ name: name.trim(), url: url.trim(), blockAllDay });
      setName('');
      setUrl('');
      await reload();
      // New busy time changes the open slots and the calendar overview.
      void qc.invalidateQueries({ queryKey: KEYS.overview });
      toast(t('added'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function act(feed: IcsFeed, what: 'toggle' | 'refresh' | 'allDay') {
    setBusy(`${what}:${feed.id}`);
    setError(null);
    try {
      if (what === 'refresh') await calendarsApi.refreshIcsFeed(feed.id);
      else if (what === 'toggle') {
        await calendarsApi.updateIcsFeed(feed.id, {
          isActive: !feed.isActive,
          rowVersion: feed.rowVersion,
        });
      } else {
        await calendarsApi.updateIcsFeed(feed.id, {
          blockAllDay: !feed.blockAllDay,
          rowVersion: feed.rowVersion,
        });
      }
      await reload();
    } catch (err) {
      setError(err);
      void reload();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(`remove:${removing.id}`);
    setError(null);
    try {
      await calendarsApi.removeIcsFeed(removing.id);
      setRemoving(null);
      await reload();
      toast(t('removed'));
    } catch (err) {
      setRemoving(null);
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const atLimit = feeds.length >= ICS_FEED_LIMIT;

  return (
    <SettingsCard id="ics-feeds" title={t('title')} description={t('description')}>
      {query.isPending ? (
        <Spinner label={t('loading')} />
      ) : query.isError ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : feeds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {feeds.map((f) => {
            const read = relativeTime(f.lastFetchedAt, now, locale);
            const warned =
              f.warnings.unknownZone > 0 || f.warnings.unsupportedRule > 0 || f.warnings.truncated;
            return (
              <li key={f.id} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  >
                    <CalendarIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="truncate text-xs text-muted-foreground" dir="ltr">
                      {f.host}
                      {f.calendarName && f.calendarName !== f.name ? ` · ${f.calendarName}` : ''}
                    </div>
                  </div>
                  {!f.isActive ? (
                    <ToneChip tone="neutral" label={t('paused')} />
                  ) : (
                    <ToneChip tone={TONE[f.status]} label={t(`status.${f.status}`)} />
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {f.status === 'pending' ? t('neverRead') : t('lastRead', { when: read || '—' })}
                  {f.status !== 'pending' && ` · ${t('busyCount', { count: f.busyCount })}`}
                </p>

                {f.errorCode && (
                  <Alert tone="danger">
                    <p className="text-xs">{t(`reason.${f.errorCode}`)}</p>
                  </Alert>
                )}
                {warned && (
                  <Alert tone="warning" className="space-y-0.5 text-xs">
                    {f.warnings.unknownZone > 0 && (
                      <p>{t('warnings.unknownZone', { count: f.warnings.unknownZone })}</p>
                    )}
                    {f.warnings.unsupportedRule > 0 && (
                      <p>{t('warnings.unsupportedRule', { count: f.warnings.unsupportedRule })}</p>
                    )}
                    {f.warnings.truncated && <p>{t('warnings.truncated')}</p>}
                  </Alert>
                )}

                {can.updateTypes && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={f.blockAllDay}
                        onCheckedChange={() => void act(f, 'allDay')}
                        label={t('allDayLabel')}
                        disabled={busy !== null}
                      />
                      {t('allDayLabel')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void act(f, 'toggle')}
                      >
                        {f.isActive ? t('pause') : t('resume')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null || !f.isActive}
                        onClick={() => void act(f, 'refresh')}
                      >
                        {busy === `refresh:${f.id}` ? t('reading') : t('refresh')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setRemoving(f)}
                      >
                        {t('remove')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error !== null &&
        (failure ? (
          <Alert tone="danger">
            {failure.kind === 'unreadable'
              ? t(`reason.${failure.reason}`)
              : t(`errors.${failure.kind}`)}
          </Alert>
        ) : (
          <ErrorLine error={error} />
        ))}

      {can.updateTypes && !query.isPending && (
        <form
          onSubmit={(e) => void add(e)}
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <h3 className="text-sm font-semibold">{t('addTitle')}</h3>
          {atLimit ? (
            <p className="text-sm text-muted-foreground">{t('errors.limit')}</p>
          ) : (
            <>
              <Field label={t('nameLabel')} htmlFor="ics-name">
                <Input
                  id="ics-name"
                  value={name}
                  maxLength={80}
                  required
                  placeholder={t('namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={t('urlLabel')} htmlFor="ics-url" hint={t('urlHint')}>
                <Input
                  id="ics-url"
                  type="url"
                  dir="ltr"
                  value={url}
                  maxLength={2000}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={blockAllDay}
                  onCheckedChange={setBlockAllDay}
                  label={t('allDayLabel')}
                />
                {t('allDayLabel')}
              </label>
              <Button
                type="submit"
                variant="brand"
                disabled={busy !== null || !name.trim() || !url.trim()}
              >
                {busy === 'add' ? t('adding') : t('add')}
              </Button>
            </>
          )}
        </form>
      )}

      <p className="text-xs text-muted-foreground">{t('hint')}</p>

      <ConfirmDialog
        open={removing !== null}
        title={t('confirmRemove.title')}
        message={t('confirmRemove.message', { name: removing?.name ?? '' })}
        confirmLabel={t('confirmRemove.confirm')}
        cancelLabel={t('confirmRemove.cancel')}
        tone="danger"
        busy={busy?.startsWith('remove:') ?? false}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
      />
    </SettingsCard>
  );
}
