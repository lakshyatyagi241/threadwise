'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, Spinner } from '@crm/ui';
import { publicApi } from '../api/service';
import type { PublicManage as PublicManageData } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { formatDay, formatTime } from '../lib/format';
import { manageStateOf } from '../lib/public-booking';
import type { Slot } from '../lib/slots';
import { browserZone } from '../lib/zone';
import { AlertIcon, ArrowLeftIcon, InfoIcon, flip } from './icons';
import { manageKey, setFlash, useManageQuery } from './public-manage';
import { useNow } from './parts';
import { Banner, ProblemCard, PublicSkeleton, WhenRows } from './public-parts';
import { PublicShell } from './public-shell';
import { SlotPicker } from './slot-picker';

type Failure = 'slotTaken' | 'closed' | 'rateLimited' | 'validation' | 'network';

/**
 * `/b/manage/<token>/reschedule`: Reference's page for moving a booking to another time. The current time cannot be picked again;
 * the new time is confirmed with one button. If someone else takes the time first, the page says so and loads the times again.
 */
export function PublicReschedule({ token }: { token: string }) {
  const q = useManageQuery(token);
  return (
    <PublicShell orgName={q.data?.org.name}>
      {q.isPending ? (
        <PublicSkeleton />
      ) : q.isError ? (
        <ProblemCard error={q.error} context="link" onRetry={() => void q.refetch()} />
      ) : (
        <RescheduleView token={token} data={q.data} />
      )}
    </PublicShell>
  );
}

function RescheduleView({ token, data }: { token: string; data: PublicManageData }) {
  const t = useTranslations('appointments.public.reschedule');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const now = useNow();
  const scope = `manage:${token}`;
  const [zone, setZone] = useState(() => browserZone());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { booking } = data;
  const state = manageStateOf(booking, now);
  const back = `/b/manage/${encodeURIComponent(token)}`;

  async function confirm() {
    if (busyRef.current || !slot) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const res = await publicApi.reschedule(token, slot.start);
      qc.setQueryData(manageKey(token), res);
      setFlash(token, 'rescheduled');
      router.push(back);
    } catch (e) {
      const kind = errorKind(e);
      if (kind === 'slotTaken') {
        setFailure('slotTaken');
        // The times on screen are out of date: ask again and let the visitor choose again.
        void qc.invalidateQueries({ queryKey: ['appointments', 'picker', scope] });
        setSlot(null);
      } else if (kind === 'gone' || kind === 'notFound') {
        setFailure('closed');
        void qc.invalidateQueries({ queryKey: manageKey(token) });
      } else if (kind === 'rateLimited') setFailure('rateLimited');
      else if (kind === 'validation') setFailure('validation');
      else setFailure('network');
      busyRef.current = false;
      setBusy(false);
      return;
    }
    // On success the page is left; the button stays disabled until it is.
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={back}
          aria-label={t('back')}
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeftIcon className={flip} />
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('title')}
          </p>
          <h1 className="truncate text-xl font-semibold" dir="auto">
            {booking.typeName}
          </h1>
        </div>
      </div>

      {state !== 'open' ? (
        <div className="space-y-3">
          <Banner
            tone="warning"
            icon={<InfoIcon className="size-5" />}
            title={t(`closed.${state === 'passed' ? 'passed' : 'closed'}.title`)}
          >
            {t(`closed.${state === 'passed' ? 'passed' : 'closed'}.message`)}
          </Banner>
          <Link
            href={back}
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            {t('backToBooking')}
          </Link>
        </div>
      ) : (
        <section className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('current')}</p>
            <WhenRows
              startsAt={booking.startsAt}
              endsAt={booking.endsAt}
              visitorZone={zone}
              serviceZone={booking.timezone}
            />
          </div>

          <div aria-live="polite" className="empty:hidden">
            {failure && (
              <Banner
                tone={failure === 'slotTaken' ? 'warning' : 'danger'}
                icon={<AlertIcon className="size-5" />}
                title={t(`failure.${failure}`)}
              />
            )}
          </div>

          <SlotPicker
            scope={scope}
            load={async (range, signal) =>
              (await publicApi.manageSlots(token, range, signal)).slots
            }
            zone={zone}
            onZoneChange={setZone}
            value={slot?.start ?? null}
            onChange={(s) => {
              setSlot(s);
              if (s) setFailure(null);
            }}
            typeZone={booking.timezone}
            disabledStart={booking.startsAt}
          />

          {slot && (
            <Button
              className="h-11 w-full rounded-full"
              variant="brand"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy && <Spinner label={t('saving')} />}
              {t('confirm', {
                when: `${formatDay(slot.start, locale, zone)}, ${formatTime(slot.start, locale, zone)}`,
              })}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
