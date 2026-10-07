'use client';

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { Chip } from './parts';
import type { AudienceTally } from '../lib/audience';

export const AUDIENCE_MODES = ['contacts', 'groups', 'segments', 'csv'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

/** What a mode's pill shows beside its name: how much it holds right now (nothing when it holds nothing). */
export function modeBadge(mode: AudienceMode, t: AudienceTally): string | null {
  switch (mode) {
    case 'contacts':
      return t.allMatching ? '*' : t.contacts > 0 ? t.contacts.toLocaleString() : null;
    case 'groups':
      return t.groups > 0 ? String(t.groups) : null;
    case 'segments':
      return t.segments > 0 ? String(t.segments) : null;
    case 'csv':
      return t.csv > 0 ? t.csv.toLocaleString() : null;
  }
}

/**
 * "Broadcast Action": the four ways to choose who gets the broadcast, as pill buttons with one active at a time. Each keeps its own
 * selection (the badge shows it), and the audience is everything selected across them.
 */
export function AudienceModes({
  mode,
  tally,
  onMode,
  panelId,
}: {
  mode: AudienceMode;
  tally: AudienceTally;
  onMode: (mode: AudienceMode) => void;
  panelId: string;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const base = useId();
  const onKey = (e: KeyboardEvent, index: number) => {
    const last = AUDIENCE_MODES.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % AUDIENCE_MODES.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + AUDIENCE_MODES.length) % AUDIENCE_MODES.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onMode(AUDIENCE_MODES[next]!);
    document.getElementById(`${base}-${AUDIENCE_MODES[next]}`)?.focus();
  };
  const label: Record<AudienceMode, ReactNode> = {
    contacts: t('modeContacts'),
    groups: t('modeGroups'),
    segments: t('modeSegments'),
    csv: t('modeCsv'),
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id={`${base}-label`} className="text-sm font-semibold">
        {t('modesTitle')}
      </span>
      <div role="tablist" aria-labelledby={`${base}-label`} className="flex flex-wrap gap-2">
        {AUDIENCE_MODES.map((m, i) => {
          const active = m === mode;
          const badge = modeBadge(m, tally);
          return (
            <button
              key={m}
              id={`${base}-${m}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => onMode(m)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active
                  ? 'border-brand bg-brand text-brand-foreground shadow-sm'
                  : 'border-border bg-background hover:bg-muted',
              )}
            >
              {label[m]}
              {badge && (
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                    active ? 'bg-white/25' : 'bg-brand/10 text-brand',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The chips above the panel: what is selected in each mode, and the one rule that joins them. */
export function AudienceSummary({
  tally,
  allTotal,
}: {
  tally: AudienceTally;
  /** The size of "all matching" while the table that chose it is open. */
  allTotal: number | null;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const chips: ReactNode[] = [];
  if (tally.contacts > 0) chips.push(t('chipContacts', { count: tally.contacts }));
  if (tally.allMatching)
    chips.push(
      allTotal === null ? t('chipAllMatching') : t('chipAllMatchingN', { count: allTotal }),
    );
  if (tally.groups > 0) chips.push(t('chipGroups', { count: tally.groups }));
  if (tally.segments > 0) chips.push(t('chipSegments', { count: tally.segments }));
  if (tally.csv > 0) chips.push(t('chipCsv', { count: tally.csv }));
  if (tally.hubSelection) chips.push(t('chipHub'));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="audience-summary">
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        {chips.length === 0 ? (
          <span className="text-sm text-muted-foreground">{t('nothingSelected')}</span>
        ) : (
          chips.map((c, i) => (
            <Chip key={i} tone="brand">
              {c}
            </Chip>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('unionRule')}</p>
    </div>
  );
}
