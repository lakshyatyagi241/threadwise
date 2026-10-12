'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { FlowSummary } from '@crm/contracts';
import { Alert, Badge, Button, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFlowOptions } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { useDebounced } from './parts';
import { CheckIcon, FlowIcon, SearchIcon } from './icons';

/** A flow's readiness as the picker shows it: only a published, active flow can start from an FAQ. */
export const flowState = (
  f: Pick<FlowSummary, 'isPublished' | 'isActive'>,
): 'live' | 'off' | 'draft' => (!f.isPublished ? 'draft' : f.isActive ? 'live' : 'off');

export interface PickedFlow {
  id: string;
  name: string;
}

/** Searchable single choice of a workspace flow. The FAQ starts the chosen flow from its trigger. */
export function FlowPicker({
  value,
  onChange,
  invalid,
  describedBy,
  missing,
}: {
  value: PickedFlow | null;
  onChange: (flow: PickedFlow) => void;
  invalid?: boolean;
  describedBy?: string;
  /** The saved flow no longer exists. */
  missing?: boolean;
}) {
  const t = useTranslations('faq.flowPicker');
  const te = useTranslations('faq.errors');
  const id = useId();
  const canFlows = useCan('flb.flows.read');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const flows = useFlowOptions(debounced, canFlows);

  if (!canFlows) return <Alert tone="warning">{t('noAccess')}</Alert>;

  return (
    <div className="space-y-2">
      {missing && <Alert tone="danger">{t('missing')}</Alert>}
      {value && !missing && (
        <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <FlowIcon />
          <span className="min-w-0 flex-1 truncate font-medium">{value.name}</span>
          <Badge tone="success">{t('selected')}</Badge>
        </p>
      )}
      <div className="relative">
        <label htmlFor={`${id}-search`} className="sr-only">
          {t('search')}
        </label>
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${id}-search`}
          type="search"
          value={search}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            'h-10 w-full rounded-md border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
            invalid ? 'border-danger' : 'border-border',
          )}
        />
      </div>
      <div aria-live="polite" className="max-h-56 overflow-auto rounded-md border border-border">
        {flows.isError ? (
          <p className="p-3 text-sm text-danger">
            {te(errorKey(flows.error))}{' '}
            <Button size="sm" variant="ghost" onClick={() => void flows.refetch()}>
              {t('retry')}
            </Button>
          </p>
        ) : flows.isPending ? (
          <p className="p-3 text-sm text-muted-foreground">{t('loading')}</p>
        ) : flows.data.data.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {debounced ? t('noMatch') : t('none')}
          </p>
        ) : (
          <ul role="listbox" aria-label={t('listLabel')} className="divide-y divide-border">
            {flows.data.data.map((f) => {
              const state = flowState(f);
              const on = value?.id === f.id;
              return (
                <li key={f.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => onChange({ id: f.id, name: f.name })}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                      on && 'bg-primary/5',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <Badge tone={state === 'live' ? 'success' : 'warning'}>
                      {t(`state.${state}`)}
                    </Badge>
                    {on && <CheckIcon className="text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}
