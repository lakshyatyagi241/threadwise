'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardAudienceSources } from '@crm/contracts';
import { Input } from '@crm/ui';
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
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>{title}</span>
        {chosen.length > 0 && <Chip tone="brand">{t('chosen', { count: chosen.length })}</Chip>}
      </legend>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <>
          {items.length >= SEARCH_FROM && (
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t(kind === 'groups' ? 'searchGroups' : 'searchSegments')}
              placeholder={t('searchPlaceholder')}
              className="h-9"
            />
          )}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
            {shown.length === 0 && (
              <p className="p-3 text-center text-sm text-muted-foreground">{t('noSourceMatch')}</p>
            )}
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
        </>
      )}
    </fieldset>
  );
}

/** Contact groups and saved segments as checkbox cards with their member counts. */
export function SourcePicker({
  sources,
  groupIds,
  segmentIds,
  onGroups,
  onSegments,
  disabled,
}: {
  sources: SourcesQuery;
  groupIds: readonly string[];
  segmentIds: readonly string[];
  onGroups: (ids: string[]) => void;
  onSegments: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  if (sources.isPending) return <Skeleton label={t('loadingSources')} lines={5} />;
  if (sources.isError) {
    return <ErrorBlock error={sources.error} onRetry={() => void sources.refetch()} />;
  }
  const data = sources.data;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <SourceList
        kind="groups"
        title={t('groups')}
        empty={t('noGroups')}
        items={data?.groups ?? []}
        chosen={groupIds}
        onChange={onGroups}
        disabled={disabled}
      />
      <SourceList
        kind="segments"
        title={t('segments')}
        empty={t('noSegments')}
        items={data?.segments ?? []}
        chosen={segmentIds}
        onChange={onSegments}
        disabled={disabled}
      />
    </div>
  );
}
