'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, EmptyState, Spinner, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useAppointmentsSetup, useBookingType } from '../api/hooks';
import { pageThemeApi } from '../api/page-theme-service';
import { errorKind, isUnavailable } from '../lib/errors';
import { AppearanceEditor, THEME_KEYS } from './appearance-editor';
import { ArrowLeftIcon, flip } from './icons';
import { ErrorLine, useAppointmentsCan } from './parts';

function Header({
  title,
  subtitle,
  backHref,
  backLabel,
}: {
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <Link
        href={backHref}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeftIcon className={cn('size-4 shrink-0', flip)} /> {backLabel}
      </Link>
    </header>
  );
}

const Loading = ({ label }: { label: string }) => (
  <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
    <Spinner /> {label}
  </div>
);

/** `/appointments/settings/appearance`: how the workspace's booking page looks (BL-355). */
export function AppearanceScreen() {
  useAppointmentsSetup();
  const t = useTranslations('appointments.appearance');
  const can = useAppointmentsCan();
  const session = useSession();
  const q = useQuery({
    queryKey: THEME_KEYS.workspace,
    queryFn: ({ signal }) => pageThemeApi.get(null, signal),
    enabled: can.read,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Header
        title={t('title')}
        subtitle={t('subtitle')}
        backHref="/appointments/settings"
        backLabel={t('backToSettings')}
      />
      {!can.read ? (
        <Alert tone="warning">{t('forbidden')}</Alert>
      ) : q.isPending ? (
        <Loading label={t('loading')} />
      ) : q.isError ? (
        isUnavailable(q.error) ? (
          <Alert tone="info">{t('notAvailable')}</Alert>
        ) : (
          <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : (
        <AppearanceEditor
          scope={null}
          initial={q.data}
          orgName={session.org.name}
          typeName={null}
          canEdit={can.updateTypes}
        />
      )}
    </div>
  );
}

/** `/appointments/types/<id>/appearance`: one service's look, over the workspace's (BL-356). */
export function TypeAppearanceScreen({ id }: { id: string }) {
  useAppointmentsSetup();
  const t = useTranslations('appointments.appearance');
  const can = useAppointmentsCan();
  const session = useSession();
  const type = useBookingType(id);
  const q = useQuery({
    queryKey: THEME_KEYS.type(id),
    queryFn: ({ signal }) => pageThemeApi.get(id, signal),
    enabled: can.read,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const back = `/appointments/types/${encodeURIComponent(id)}`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Header
        title={t('type.title', { name: type.data?.name ?? '' })}
        subtitle={t('type.subtitle')}
        backHref={type.isError ? '/appointments/types' : back}
        backLabel={t('type.back')}
      />
      {!can.read ? (
        <Alert tone="warning">{t('forbidden')}</Alert>
      ) : q.isPending || type.isPending ? (
        <Loading label={t('loading')} />
      ) : q.isError || type.isError ? (
        errorKind(q.error ?? type.error) === 'notFound' ? (
          <EmptyState title={t('type.notFoundTitle')} message={t('type.notFound')} />
        ) : (
          <ErrorLine
            error={q.error ?? type.error}
            onRetry={() => {
              void q.refetch();
              void type.refetch();
            }}
          />
        )
      ) : (
        <AppearanceEditor
          scope={id}
          initial={q.data}
          orgName={session.org.name}
          typeName={type.data.name}
          canEdit={can.updateTypes}
        />
      )}
    </div>
  );
}
