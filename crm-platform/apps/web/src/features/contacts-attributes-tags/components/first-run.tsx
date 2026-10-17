'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import { PlusIcon, UploadIcon, WhatsAppIcon } from './icons';

/**
 * What a workspace with no contacts at all sees instead of an empty table: three ways to start (add one person, import a CSV,
 * connect WhatsApp), each drawn only where the person may do it. A filtered list with no match keeps the plain empty state.
 */
export function FirstRun({
  onAdd,
  onImport,
  connectHref,
}: {
  /** Opens the new-contact form; absent without `record.contacts.create`. */
  onAdd?: () => void;
  /** Opens the CSV import; absent without `record.contacts.import`. */
  onImport?: () => void;
  /** Where WhatsApp is connected; absent without `waba.numbers.read`. */
  connectHref?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const ta = useTranslations('contacts-attributes-tags.list.firstRun');
  const card = (icon: ReactNode, title: string, body: string, action: ReactNode) => (
    <li className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background p-4">
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand dark:text-primary">
        {icon}
      </span>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="mt-auto">{action}</div>
    </li>
  );
  return (
    <section
      aria-labelledby="first-run-title"
      className="mx-auto w-full max-w-4xl space-y-5 p-4 py-8"
    >
      <div className="space-y-1 text-center">
        <h2 id="first-run-title" className="text-lg font-semibold">
          {ta('title')}
        </h2>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground">{ta('message')}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {onAdd &&
          card(
            <PlusIcon className="size-5" />,
            t('addContact'),
            ta('addBody'),
            <Button variant="brand" size="sm" onClick={onAdd}>
              {t('addContact')}
            </Button>,
          )}
        {onImport &&
          card(
            <UploadIcon className="size-5" />,
            ta('importCsv'),
            ta('importBody'),
            <Button variant="secondary" size="sm" onClick={onImport}>
              {ta('importCsv')}
            </Button>,
          )}
        {connectHref &&
          card(
            <WhatsAppIcon className="size-5" />,
            ta('connect'),
            ta('connectBody'),
            <Link
              href={connectHref}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {ta('connect')}
            </Link>,
          )}
      </ul>
      {!onAdd && !onImport && !connectHref && (
        <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
      )}
    </section>
  );
}
