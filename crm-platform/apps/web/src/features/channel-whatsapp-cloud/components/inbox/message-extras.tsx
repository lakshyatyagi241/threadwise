'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { MessageContactCard, MessageInteractive } from '@crm/contracts';
import { contactCards, interactiveChip } from '../../lib/media-state';

/** A customer's answer to a button or a list, shown as a chip with the title they chose (not as a plain sentence they typed). */
export function InteractiveChip({
  kind,
  body,
  interactive,
}: {
  kind: string;
  body: string | null;
  interactive?: MessageInteractive | null;
}) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.interactive');
  const chip = interactiveChip({ kind, body, interactive });
  if (!chip) return null;
  return (
    <div data-testid="inbox-interactive" data-type={chip.type} className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">
        {chip.type === 'list' ? t('list') : t('button')}
      </p>
      <span
        dir="auto"
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary',
        )}
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        <span className="truncate">{chip.title}</span>
      </span>
      {chip.description && (
        <p dir="auto" className="text-xs text-muted-foreground">
          {chip.description}
        </p>
      )}
    </div>
  );
}

/** The contact card(s) a customer shared: a name and the numbers on it. */
export function ContactCards({
  kind,
  body,
  contacts,
}: {
  kind: string;
  body: string | null;
  contacts?: MessageContactCard[] | null;
}) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.contact');
  const cards = contactCards({ kind, body, contacts });
  if (cards.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="inbox-contact-cards">
      {cards.map((c, i) => (
        <li
          key={`${c.name ?? ''}-${i}`}
          className="flex w-64 max-w-full items-start gap-3 rounded-md border border-border bg-background/70 p-2.5"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-medium">
              {c.name ?? t('unnamed')}
            </span>
            {c.phones.length > 0 ? (
              c.phones.map((p) => (
                <span
                  key={p}
                  dir="ltr"
                  className="block truncate text-start font-mono text-xs text-muted-foreground"
                >
                  {p}
                </span>
              ))
            ) : (
              <span className="block text-xs text-muted-foreground">{t('shared')}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
