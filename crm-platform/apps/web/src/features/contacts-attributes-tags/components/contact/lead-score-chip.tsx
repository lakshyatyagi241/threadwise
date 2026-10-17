'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { bandOf, useLeadScoringEnabled, type ScoreBand } from '@/features/lead-scoring';
import type { ContactRow } from '../../api/schemas';
import { StarIcon } from '../icons';

const TONES: Record<ScoreBand, string> = {
  hot: 'border-success/30 bg-success/10 text-success',
  warm: 'border-warning/30 bg-warning/10 text-warning',
  cold: 'border-border bg-muted text-muted-foreground',
};

/**
 * Whether the contact's lead score is shown as a chip: it has a score, the person may read contacts, and lead scoring is on for the
 * workspace (`useLeadScoringEnabled`: the app and the workspace switch). Off hides every score, a typed one included, and the
 * values come back when scoring is switched on again.
 */
export function useShowLeadScore(contact: Pick<ContactRow, 'leadScore'>): boolean {
  const canRead = useCan('record.contacts.read');
  const on = useLeadScoringEnabled();
  return contact.leadScore !== null && canRead && on;
}

/**
 * The lead score as a small chip (star and number) coloured by its band (cold, warm, hot: the lead-scoring thresholds), for the name
 * line of the contact page's profile card and the quick view's header. With `onOpen` it is a button that opens the Lead score card;
 * the tooltip and the accessible name say the number and the band in words, so colour is never the only signal. Nothing is drawn when
 * there is no score to show (see `useShowLeadScore`): never an empty chip.
 */
export function LeadScoreChip({
  contact,
  onOpen,
  className,
}: {
  contact: ContactRow;
  /** Opens the Lead score card (the side column on the page, the Overview tab in the drawer). */
  onOpen?: () => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.scoreChip');
  const tb = useTranslations('lead-scoring.card.band');
  const show = useShowLeadScore(contact);
  if (!show || contact.leadScore === null) return null;
  const score = contact.leadScore;
  const band = bandOf(score);
  const body = (
    <>
      <StarIcon className="size-3.5" />
      <span aria-hidden="true">{score}</span>
    </>
  );
  const common = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums',
    TONES[band],
    className,
  );
  const title = t('title', { score, band: tb(band) });
  if (!onOpen) {
    return (
      <span
        role="img"
        data-testid="lead-score-chip"
        data-band={band}
        title={title}
        aria-label={title}
        className={common}
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="lead-score-chip"
      data-band={band}
      title={title}
      aria-label={t('aria', { score, band: tb(band) })}
      onClick={onOpen}
      className={cn(
        common,
        'outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {body}
    </button>
  );
}
