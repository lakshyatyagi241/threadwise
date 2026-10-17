'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { useStoredChoice } from '../../lib/use-stored-choice';
import { ChevronDownIcon } from '../icons';

const STATES = ['open', 'closed'] as const;

/**
 * A card of the contact's side column that folds into one line. Folded, it shows its title and a short summary of what is inside
 * ("WhatsApp yes, SMS no"), so most things can be seen without opening anything; open, it shows its content, which is only drawn then
 * (nothing inside is fetched or rendered while the card is shut). The choice is remembered for this browser, per card, so a person's
 * layout stays as they left it on every contact.
 */
export function CollapseCard({
  id,
  title,
  summary,
  defaultOpen = false,
  openSignal,
  children,
  className,
}: {
  /** Names the card for the remembered choice and the ids; stable, unique on the page. */
  id: string;
  title: string;
  /** What the folded card says beside its title; plain text, one line. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Changes whenever something outside (the Company shortcut) wants the card open. */
  openSignal?: number;
  children: ReactNode;
  className?: string;
}) {
  const [stored, setStored] = useStoredChoice(
    `crm.contact.card.${id}`,
    STATES,
    defaultOpen ? 'open' : 'closed',
  );
  const [forced, setForced] = useState(false);
  const [seen, setSeen] = useState<number | undefined>(undefined);
  if (openSignal !== seen) {
    setSeen(openSignal);
    if (openSignal) setForced(true);
  }
  const open = stored === 'open' || forced;
  const bodyId = useId();
  return (
    <section className={cn('rounded-xl border border-border bg-background', className)}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setForced(false);
            setStored(open ? 'closed' : 'open');
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-4 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {!open && summary && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
          )}
          <ChevronDownIcon
            className={cn(
              'ms-auto size-4 shrink-0 text-muted-foreground transition',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="border-t border-border px-4 py-3">
          {children}
        </div>
      )}
    </section>
  );
}
