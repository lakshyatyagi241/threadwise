'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, Spinner } from '@crm/ui';
import { AppointmentsIcon, ArrowLeftIcon, flip } from './icons';

/** A titled card of the settings form (rounded, bordered, on the page background). */
export function SettingsCard({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-border bg-background"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

export interface HeaderSave {
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
}

/**
 * The header band: icon tile, title and subtitle, the breadcrumb (Integrations is plain text, that screen does not exist yet),
 * a way back to the bookings, and the one primary action.
 */
export function SettingsHeader({ save }: { save?: HeaderSave }) {
  const t = useTranslations('appointments.settings');
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-background px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
      >
        <AppointmentsIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <nav aria-label={t('breadcrumb.label')} className="mb-0.5 text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-x-1.5">
            <li>{t('breadcrumb.integrations')}</li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href="/appointments"
                className="underline-offset-2 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {t('breadcrumb.appointments')}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{t('breadcrumb.settings')}</li>
          </ol>
        </nav>
        <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href="/appointments"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeftIcon className={`size-4 shrink-0 ${flip}`} /> {t('back')}
        </Link>
        {save && (
          <Button variant="brand" disabled={save.disabled || save.saving} onClick={save.onSave}>
            {save.saving && <Spinner />} {t('save')}
          </Button>
        )}
      </div>
    </header>
  );
}
