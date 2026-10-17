'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { useStoredChoice } from '../../lib/use-stored-choice';
import { ChevronDownIcon } from '../icons';

const STATES = ['open', 'closed'] as const;

/** The "+ Add" at the end of a card's header row: a link, or a button that does something in place. */
export interface CardAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

/**
 * A small card of the contact's side column that folds into ONE header row: its title, a count, what is inside in a few words (or the
 * `summary` node, such as three channel ticks) and "+ Add". Open, it shows its content, at most about 200 px tall (it scrolls inside), and
 * the content is only drawn then (nothing inside is fetched or rendered while the card is shut). The choice is remembered for this
 * browser, per card, so a person's layout stays as they left it on every contact.
 */
export function CollapseCard({
  id,
  title,
  count,
  summary,
  inline,
  action,
  defaultOpen = false,
  openSignal,
  children,
  className,
}: {
  /** Names the card for the remembered choice and the ids; stable, unique on the page. */
  id: string;
  title: string;
  /** A number beside the title (how many deals, open tasks ...). */
  count?: number | null;
  /** What the folded card says beside its title: one line. */
  summary?: ReactNode;
  /** Always shown at the end of the header row, folded or open (the three channel ticks). */
  inline?: ReactNode;
  action?: CardAction;
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
  const actionClass =
    'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <section className={cn('rounded-xl border border-border bg-background', className)}>
      <div className="flex min-h-10 items-center gap-1 pe-2">
        <h3 className="m-0 min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              setForced(false);
              setStored(open ? 'closed' : 'open');
            }}
            className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDownIcon
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition',
                !open && '-rotate-90 rtl:rotate-90',
              )}
            />
            <span className="shrink-0 text-[13px] font-semibold">{title}</span>
            {count !== undefined && count !== null && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
            {!open && summary && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {summary}
              </span>
            )}
            {inline && <span className="ms-auto shrink-0">{inline}</span>}
          </button>
        </h3>
        {action &&
          (action.href ? (
            <Link href={action.href} className={actionClass}>
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className={actionClass}>
              {action.label}
            </button>
          ))}
      </div>
      {open && (
        <div
          id={bodyId}
          className="thin-scrollbar max-h-[200px] overflow-y-auto border-t border-border px-3 py-2 text-sm"
        >
          {children}
        </div>
      )}
    </section>
  );
}
