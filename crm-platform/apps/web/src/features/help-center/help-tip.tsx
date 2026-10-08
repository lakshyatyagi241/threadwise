'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Popover, cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { getHelpTip } from './actions';
import { useHelpEntries, useHelpEntry } from './context';
import { docForPath } from './search';

export function tipHref(doc: string, anchor?: string): string {
  return anchor ? `/help/${doc}#${anchor}` : `/help/${doc}`;
}

/** Where the bubble opens: under an inline "?" (start-aligned), or from the top bar (full width on a phone, right-aligned above it). */
const PLACEMENT = {
  inline: 'start-0 end-auto',
  bar: 'fixed end-2 start-2 top-14 mt-0 w-auto sm:absolute sm:start-auto sm:end-0 sm:top-full sm:mt-1 sm:w-80',
} as const;

interface HelpTipProps {
  /** Id of the guide. When the person cannot see it (their plan, role or the screen is not built), the tip renders nothing. */
  doc: string;
  /** A heading id in the guide: the bubble then shows that section's first paragraph instead of the guide's summary. */
  anchor?: string;
  variant?: keyof typeof PLACEMENT;
  className?: string;
}

/**
 * A "?" button that explains in a line and links to the guide. It opens on click, Enter or Space (never hover alone), closes on
 * Escape or a press outside and returns focus to the button, and ends with a link to the guide (or to the heading).
 * The text lives only in the guide: the summary comes with the page, a section's paragraph is fetched on the first open.
 */
export function HelpTip({ doc, anchor, variant = 'inline', className }: HelpTipProps) {
  const t = useTranslations('help');
  const entry = useHelpEntry(doc);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!open || !anchor || asked.current) return;
    asked.current = true;
    getHelpTip(doc, anchor)
      .then(setSection)
      .catch(() => undefined);
  }, [open, anchor, doc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!entry) return null;
  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('tip.label', { title: entry.title })}
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <NavIcon name="help" className="size-[18px]" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={entry.title}
        className={cn('space-y-2 text-sm', PLACEMENT[variant])}
      >
        <p className="leading-6">{section ?? entry.summary}</p>
        <Link
          href={tipHref(doc, anchor)}
          onClick={() => setOpen(false)}
          className="inline-block font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
        >
          {t('tip.readMore')}
        </Link>
      </Popover>
    </span>
  );
}

/** The "?" in the top bar: the guide of the screen you are on, found by address. Nothing on a screen with no guide, nor on Help itself. */
export function PageHelpTip() {
  const entries = useHelpEntries();
  const entry = docForPath(entries, usePathname());
  return entry ? <HelpTip doc={entry.id} variant="bar" /> : null;
}
