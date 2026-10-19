'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { invalidateContacts, KEYS } from '../../api/contacts';
import type { ContactRow } from '../../api/schemas';

/**
 * What every section of a contact receives (the quick view's panels and the details page's sections are the same components).
 * `variant` only tunes density: `drawer` is the narrower, denser one.
 */
export interface SectionProps {
  /** The contact with its group chips (`useContact`). */
  contact: ContactRow;
  variant: 'page' | 'drawer';
}

/** Refreshes the contact and every list that shows it; call it after a change a section made to the contact itself. */
export function useRefreshContact(id: string) {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all([invalidateContacts(qc), qc.invalidateQueries({ queryKey: KEYS.contact(id) })]),
    [qc, id],
  );
}

/** The white card every block of the contact screens sits in: a title row (with an optional action at its end) and the content. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Anchor for `aria-labelledby` on the title. */
  id?: string;
}) {
  return (
    <section
      aria-labelledby={title && id ? `${id}-title` : undefined}
      className={cn('rounded-xl border border-border bg-background', className)}
    >
      {(title || action) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          {title && (
            <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export interface KeyValueRow {
  key: string;
  label: string;
  /** What is shown; an empty string, null or false shows a dash. */
  value: ReactNode;
  /** Shown left-to-right whatever the page direction (numbers, e-mail addresses, phone numbers). */
  ltr?: boolean;
}

const isEmpty = (v: ReactNode) => v === '' || v === null || v === undefined || v === false;

/** Clean key-value rows: the label muted at the start, the value after it, a thin divider between rows. */
export function KeyValueList({
  rows,
  className,
  narrow,
}: {
  rows: readonly KeyValueRow[];
  className?: string;
  /** A narrower label column, for the side column of the overview. */
  narrow?: boolean;
}) {
  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {rows.map((r) => (
        <div
          key={r.key}
          className={cn(
            'grid items-start gap-x-4 py-2.5 first:pt-0 last:pb-0',
            narrow
              ? 'grid-cols-[minmax(4.5rem,6rem)_minmax(0,1fr)] gap-x-3'
              : 'grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)]',
          )}
        >
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 break-words" dir={r.ltr ? 'ltr' : 'auto'}>
            {isEmpty(r.value) ? <span className="text-muted-foreground">&mdash;</span> : r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet line for "nothing here yet". */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
