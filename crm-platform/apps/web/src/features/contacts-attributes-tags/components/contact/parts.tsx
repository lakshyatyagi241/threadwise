'use client';

import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { bandOf, SCORE_MAX, type ScoreBand } from '@/features/lead-scoring';
import { updateContact } from '../../api/contacts';
import { useContactFields } from '../../api/properties';
import type { ContactRow } from '../../api/schemas';
import {
  jobTitleField,
  jobTitleOf,
  socialLinks,
  type SocialNetwork,
} from '../../lib/contact-overview';
import { errorKind } from '../../lib/errors';
import type { OptIn } from '../../lib/subscription';
import { GlobeIcon, PencilIcon } from '../icons';
import { useRefreshContact } from './shared';

const NETWORK_GLYPH: Record<SocialNetwork, string> = {
  facebook: 'f',
  instagram: 'ig',
  linkedin: 'in',
  twitter: 'X',
  youtube: 'yt',
  telegram: 'tg',
  tiktok: 'tt',
  website: '',
};

/** The social profile links the contact's URL properties hold (Facebook, X, LinkedIn ...); nothing when there are none. */
export function SocialIcons({
  contact,
  className,
}: {
  contact: Pick<ContactRow, 'customFields'>;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.social');
  const links = socialLinks(contact.customFields);
  if (links.length === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {links.map((l) => (
        <a
          key={l.network}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          title={t(l.network)}
          aria-label={t('open', { network: t(l.network) })}
          className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground outline-none transition hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {NETWORK_GLYPH[l.network] || <GlobeIcon className="size-3.5" />}
        </a>
      ))}
    </span>
  );
}

/**
 * The job title under the name: click the text (or the "Add job title" placeholder) to edit it in place, Enter saves, Esc cancels.
 * It lives in the workspace's job-title property (`job_title`); a workspace without that property sees nothing here, and someone who
 * may not edit contacts sees the text only.
 */
export function JobTitle({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.header');
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const fields = useContactFields();
  const field = jobTitleField(fields.data);
  const refresh = useRefreshContact(contact.id);
  const current = jobTitleOf(contact, field);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();

  const save = useMutation({
    mutationFn: (value: string) =>
      updateContact(contact.id, {
        customFields: { [field!.key]: value },
        rowVersion: contact.rowVersion,
      }),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: async (e) => {
      const kind = errorKind(e);
      toast(t(kind === 'conflict' ? 'jobTitleConflict' : 'jobTitleFailed'), 'danger');
      if (kind === 'conflict') await refresh();
    },
  });

  if (!field) return null;
  if (draft !== null) {
    const commit = () => {
      const next = draft.trim();
      if (next === current) setDraft(null);
      else save.mutate(next);
    };
    return (
      <input
        id={id}
        autoFocus
        value={draft}
        maxLength={255}
        disabled={save.isPending}
        aria-label={t('jobTitle')}
        placeholder={t('jobTitlePlaceholder')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="h-7 w-full max-w-xs rounded border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    );
  }
  if (!canUpdate)
    return current ? (
      <p dir="auto" className="text-sm text-muted-foreground">
        {current}
      </p>
    ) : null;
  return (
    <button
      type="button"
      onClick={() => setDraft(current)}
      aria-label={t('editJobTitle')}
      className="group/job inline-flex max-w-full items-center gap-1.5 rounded text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span
        dir="auto"
        className={cn(
          'truncate',
          current ? 'text-muted-foreground' : 'italic text-muted-foreground/70',
        )}
      >
        {current || t('jobTitlePlaceholder')}
      </span>
      <PencilIcon className="size-3 shrink-0 opacity-0 transition group-hover/job:opacity-60 group-focus-visible/job:opacity-60" />
    </button>
  );
}

/** Yes / No chip of a channel (or "No" in red when the contact opted out of marketing). */
export function OptInPill({ value, className }: { value: OptIn; className?: string }) {
  const t = useTranslations('contacts-attributes-tags.contact.subscription');
  return (
    <span
      title={value === 'out' ? t('optedOut') : undefined}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        value === 'yes' && 'border-success/30 bg-success/10 text-success',
        value === 'no' && 'border-border bg-muted text-muted-foreground',
        value === 'out' && 'border-danger/30 bg-danger/10 text-danger',
        className,
      )}
    >
      {value === 'yes' ? t('yes') : t('no')}
    </span>
  );
}

const BAND_STROKE: Record<ScoreBand, string> = {
  cold: 'stroke-muted-foreground',
  warm: 'stroke-warning',
  hot: 'stroke-success',
};

/**
 * The lead score as a ring: the arc is score / 100, coloured by the band (cold, warm, hot) that the scoring settings define; the
 * number sits inside. A contact with no score yet shows an empty ring and a dash.
 */
export function ScoreRing({
  score,
  label,
  size = 112,
}: {
  score: number | null;
  label: string;
  size?: number;
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(SCORE_MAX, score)) / SCORE_MAX;
  const band = score === null ? null : bandOf(score);
  return (
    <div
      role="img"
      aria-label={label}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
        {band && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            className={BAND_STROKE[band]}
          />
        )}
      </svg>
      <span className="absolute text-2xl font-semibold tabular-nums">{score ?? '—'}</span>
    </div>
  );
}
