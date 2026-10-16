'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PreviousSendsAudience, WizardAudienceSources } from '@crm/contracts';
import { Input } from '@crm/ui';
import { PreviousSendsPicker } from '../../components/previous-sends-picker';
import { toggleId } from '../lib/audience';
import { ChoiceCard, Chip, ErrorBlock, Skeleton } from './parts';

export interface SourcesQuery {
  data?: WizardAudienceSources;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

interface Item {
  id: string;
  name: string;
  color: string | null;
  memberCount: number | null;
}

const SEARCH_FROM = 6;

function SourceList({
  title,
  empty,
  items,
  chosen,
  onChange,
  disabled,
  kind,
}: {
  title: string;
  empty: string;
  items: Item[];
  chosen: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  kind: 'groups' | 'segments';
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const [q, setQ] = useState('');
  const uid = useId();
  const shown = useMemo(
    () => items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase())),
    [items, q],
  );
  const allShown = shown.length > 0 && shown.every((i) => chosen.includes(i.id));
  return (
    <fieldset className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {items.length >= SEARCH_FROM && (
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t(kind === 'groups' ? 'searchGroups' : 'searchSegments')}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full max-w-xs"
          />
        )}
        {items.length > 0 && (
          <button
            type="button"
            disabled={disabled || shown.length === 0}
            onClick={() =>
              onChange(
                allShown
                  ? chosen.filter((id) => !shown.some((i) => i.id === id))
                  : [...new Set([...chosen, ...shown.map((i) => i.id)])],
              )
            }
            className="text-sm font-semibold text-brand hover:underline disabled:opacity-50"
          >
            {allShown ? t('unselectAllShown') : t('selectAllShown')}
          </button>
        )}
        {chosen.length > 0 && (
          <Chip tone="brand" className="ms-auto">
            {t('chosen', { count: chosen.length })}
          </Chip>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && (
            <p className="p-3 text-center text-sm text-muted-foreground">{t('noSourceMatch')}</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.map((i) => (
              <ChoiceCard
                key={i.id}
                type="checkbox"
                name={`${uid}-${kind}`}
                checked={chosen.includes(i.id)}
                disabled={disabled}
                onChange={() => onChange(toggleId(chosen, i.id))}
                className="py-2"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: i.color || 'var(--primary)' }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                  <Chip>
                    {i.memberCount === null
                      ? t('countUnknown')
                      : t('members', { count: i.memberCount })}
                  </Chip>
                </span>
              </ChoiceCard>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** Contact groups, or saved segments, as checkbox cards with their member counts (one mode of the audience step). */
export function SourcePicker({
  kind,
  sources,
  chosen,
  onChange,
  disabled,
}: {
  kind: 'groups' | 'segments';
  sources: SourcesQuery;
  chosen: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  if (sources.isPending) {
    return (
      <div className="p-4">
        <Skeleton label={t('loadingSources')} lines={5} />
      </div>
    );
  }
  if (sources.isError) {
    return (
      <div className="p-4">
        <ErrorBlock error={sources.error} onRetry={() => void sources.refetch()} />
      </div>
    );
  }
  const data = sources.data;
  return (
    <SourceList
      kind={kind}
      title={t(kind)}
      empty={t(kind === 'groups' ? 'noGroups' : 'noSegments')}
      items={(kind === 'groups' ? data?.groups : data?.segments) ?? []}
      chosen={chosen}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/** Earlier broadcasts and campaigns, with the outcome that narrows who is taken from them (one mode of the audience step). */
export function PreviousSourcePicker({
  sources,
  value,
  onChange,
  disabled,
}: {
  sources: SourcesQuery;
  value: PreviousSendsAudience | null | undefined;
  onChange: (next: PreviousSendsAudience) => void;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  if (sources.isPending) {
    return (
      <div className="p-4">
        <Skeleton label={t('loadingSources')} lines={5} />
      </div>
    );
  }
  if (sources.isError) {
    return (
      <div className="p-4">
        <ErrorBlock error={sources.error} onRetry={() => void sources.refetch()} />
      </div>
    );
  }
  return (
    <PreviousSendsPicker
      options={sources.data?.previousSends ?? []}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="flex-1 p-4"
    />
  );
}
