'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, ConfirmDialog } from '@crm/ui';
import { publicApi } from '../api/service';
import type { PublicManage as PublicManageData } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { manageActions, manageStateOf, whereOf, type ManageState } from '../lib/public-booking';
import { browserZone } from '../lib/zone';
import { AlertIcon, CalendarIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from './icons';
import { StatusChip, useNow } from './parts';
import {
  Banner,
  CalendarButtons,
  ProblemCard,
  PublicSkeleton,
  WhenRows,
  WhereRow,
} from './public-parts';
import { PublicShell } from './public-shell';

export const manageKey = (token: string) => ['appointments', 'public', 'manage', token] as const;

/** The booking behind a manage link. The link's secret is the only credential, so every failure here is about the link. */
export function useManageQuery(token: string) {
  return useQuery({
    queryKey: manageKey(token),
    queryFn: ({ signal }) => publicApi.manage(token, signal),
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

/** A short message kept across the redirect from the reschedule page ("Your booking has been rescheduled."). */
export type Flash = 'rescheduled' | 'cancelled';
const flashKey = (token: string) => `appointments:flash:${token}`;

export function setFlash(token: string, flash: Flash): void {
  try {
    window.sessionStorage.setItem(flashKey(token), flash);
  } catch {
    /* the message is then not shown; the booking itself is already changed */
  }
}

function readFlash(token: string): Flash | null {
  try {
    const v = window.sessionStorage.getItem(flashKey(token));
    return v === 'rescheduled' || v === 'cancelled' ? v : null;
  } catch {
    return null;
  }
}

/**
 * `/b/manage/<token>`: Reference's page for a customer to look at one booking and, while it is still ahead of them, move or
 * cancel it. Opening the link never changes anything (a chat app's link preview must not cancel a booking): Reschedule and
 * Cancel are buttons, and Cancel asks first.
 */
export function PublicManage({ token }: { token: string }) {
  const q = useManageQuery(token);
  return (
    <PublicShell orgName={q.data?.org.name} org={q.data?.org.slug} theme={q.data?.theme}>
      {q.isPending ? (
        <PublicSkeleton />
      ) : q.isError ? (
        <ProblemCard error={q.error} context="link" onRetry={() => void q.refetch()} />
      ) : (
        <ManageView token={token} data={q.data} />
      )}
    </PublicShell>
  );
}

function ManageView({ token, data }: { token: string; data: PublicManageData }) {
  const t = useTranslations('appointments.public.manage');
  const qc = useQueryClient();
  const now = useNow();
  const [zone] = useState(() => browserZone());
  const [flash, setFlashState] = useState<Flash | null>(() => readFlash(token));
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<'closed' | 'rateLimited' | 'network' | null>(null);
  const { booking, org } = data;
  const state = manageStateOf(booking, now);
  const can = manageActions(booking, now);

  // The message is shown once: a reload of the page does not repeat it.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(flashKey(token));
    } catch {
      /* nothing stored */
    }
  }, [token]);

  const cancel = useMutation({
    mutationFn: () => publicApi.cancel(token),
    onSuccess: (res) => {
      qc.setQueryData(manageKey(token), res);
      setFlashState('cancelled');
      setFailure(null);
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      const kind = errorKind(e);
      setFailure(
        kind === 'gone' || kind === 'notFound'
          ? 'closed'
          : kind === 'rateLimited'
            ? 'rateLimited'
            : 'network',
      );
      // The booking may have been changed elsewhere: show what is true now.
      if (kind === 'gone') void qc.invalidateQueries({ queryKey: manageKey(token) });
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="text-center">
        <span className="mx-auto mb-2 inline-flex size-12 items-center justify-center rounded-2xl bg-brand text-brand-foreground">
          <CalendarIcon className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>

      <div aria-live="polite" className="space-y-3 empty:hidden">
        {flash && (
          <Banner
            tone="success"
            icon={<CheckCircleIcon className="size-5" />}
            title={t(`flash.${flash}`)}
          />
        )}
        {failure && (
          <Banner
            tone="danger"
            icon={<AlertIcon className="size-5" />}
            title={t(`failure.${failure}`)}
          />
        )}
      </div>

      <section
        className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
        aria-labelledby="manage-what"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="manage-what" className="min-w-0 text-base font-semibold" dir="auto">
              {booking.typeName}
            </h2>
            <StatusChip status={booking.status} />
          </div>
          <div className="space-y-2.5">
            <WhenRows
              startsAt={booking.startsAt}
              endsAt={booking.endsAt}
              visitorZone={zone}
              serviceZone={booking.timezone}
            />
            <WhereRow where={whereOf(booking)} />
          </div>
          <StateNote state={state} status={booking.status} />
        </div>

        {(can.reschedule || can.cancel) && (
          <div className="flex flex-col gap-2 border-t border-border p-5 sm:flex-row">
            {can.reschedule && (
              <Link
                href={`/b/manage/${encodeURIComponent(token)}/reschedule`}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t('reschedule')}
              </Link>
            )}
            {can.cancel && (
              <Button
                variant="secondary"
                className="h-11 flex-1 rounded-full border-danger/40 font-semibold text-danger hover:bg-danger/10"
                onClick={() => {
                  setFailure(null);
                  setConfirming(true);
                }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        )}

        {state === 'open' && (
          <div className="border-t border-border p-5">
            <CalendarButtons booking={booking} orgName={org.name} />
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title={t('confirmCancel.title')}
        message={t('confirmCancel.message', { what: booking.typeName })}
        confirmLabel={t('confirmCancel.confirm')}
        cancelLabel={t('confirmCancel.keep')}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/** Why a booking cannot be changed, or that it is waiting; nothing for a plain confirmed one. */
function StateNote({ state, status }: { state: ManageState; status: string }) {
  const t = useTranslations('appointments.public.manage.state');
  if (state === 'open') {
    return status === 'pending' ? (
      <Banner
        tone="warning"
        live={false}
        icon={<ClockIcon className="size-5" />}
        title={t('pending.title')}
      >
        {t('pending.message')}
      </Banner>
    ) : null;
  }
  const tone = state === 'completed' ? 'neutral' : state === 'passed' ? 'warning' : 'danger';
  return (
    <Banner
      tone={tone}
      live={false}
      icon={
        state === 'completed' ? (
          <CheckCircleIcon className="size-5" />
        ) : state === 'passed' ? (
          <ClockIcon className="size-5" />
        ) : (
          <XCircleIcon className="size-5" />
        )
      }
      title={t(`${state}.title`)}
    >
      {t(`${state}.message`)}
    </Banner>
  );
}
