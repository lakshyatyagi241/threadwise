'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { ToastProvider, Alert, Button, Drawer, EmptyState, Spinner } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useAuditEntries, useAuditFacets, useAuditSettings } from '../api/hooks';
import { errorKey } from '../lib/errors';
import {
  EMPTY_FILTERS,
  isFiltered,
  parseFilters,
  toApiFilters,
  toSearch,
  windowOf,
  type AuditFilterState,
} from '../lib/filters';
import { AuditDetail } from './audit-detail';
import { AuditExports } from './audit-exports';
import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';

/**
 * Settings, Audit log (`/activity-log`, Reference's Activity Log): who changed what, when, from what to what. Filters live in the
 * URL; the table loads 50 entries at a time; one entry opens in a side panel (its masked field changes); the filtered window can be
 * exported to CSV. Needs `audit.log.read`; the export section needs `audit.log.export`.
 */
export function AuditLogScreen() {
  const t = useTranslations('audit-log');
  const canRead = useCan('audit.log.read');
  const canExport = useCan('audit.log.export');

  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState title={t('forbidden.title')} message={t('forbidden.body')} />
      </div>
    );
  }
  return (
    <ToastProvider dismissLabel={t('common.dismiss')}>
      <AuditLogBody canExport={canExport} />
    </ToastProvider>
  );
}

function AuditLogBody({ canExport }: { canExport: boolean }) {
  const t = useTranslations('audit-log');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const [tick, setTick] = useState(0);

  const go = useCallback(
    (next: AuditFilterState) => {
      const qs = toSearch(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const change = useCallback(
    (patch: Partial<AuditFilterState>) => go({ ...state, ...patch }),
    [go, state],
  );

  // The window is fixed when the filters change (or on Refresh), never on a render, so the query key stays stable.
  const windowKey = `${state.range}|${state.from}|${state.to}|${tick}`;
  const range = useMemo(() => windowOf(state, new Date()), [windowKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtersKey = toSearch({ ...state, entry: '' }) + `|${tick}`;
  const filters = useMemo(
    () => ({ ...toApiFilters(state, new Date()), ...range }),
    [filtersKey, range], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const settings = useAuditSettings(true);
  const facets = useAuditFacets(range, true);
  const entries = useAuditEntries(filters, tick, true);

  const rows = useMemo(() => entries.data?.pages.flatMap((p) => p.data) ?? [], [entries.data]);
  /** The effective display zone, shown above the table so "09:30" is never ambiguous. */
  const zone = useSession().effectiveTimezone || 'UTC';

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
        <p className="text-xs text-muted-foreground" data-testid="audit-retention">
          {retentionNote(t, settings.data?.retentionDays)}
        </p>
      </header>

      <AuditFilters
        state={state}
        facets={facets.data}
        onChange={change}
        onReset={() => go({ ...EMPTY_FILTERS })}
        onRefresh={() => setTick((n) => n + 1)}
      />

      <p className="text-xs text-muted-foreground">{t('table.zone', { zone })}</p>

      {entries.isError ? (
        <div className="space-y-3" data-testid="audit-error">
          <Alert tone="danger">{t(`errors.${errorKey(entries.error)}`)}</Alert>
          <Button variant="secondary" onClick={() => void entries.refetch()}>
            {t('states.retry')}
          </Button>
        </div>
      ) : entries.isPending ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Spinner label={t('states.loading')} />
          {t('states.loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={isFiltered(state) ? t('states.emptyFiltered') : t('states.empty')}
          message={isFiltered(state) ? t('states.emptyFilteredHint') : t('states.emptyHint')}
          actions={
            isFiltered(state) ? (
              <Button variant="secondary" onClick={() => go({ ...EMPTY_FILTERS })}>
                {t('filters.reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          <AuditTable
            entries={rows}
            selected={state.entry}
            onOpen={(id) => change({ entry: id })}
            timeZone={zone}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span aria-live="polite">{t('states.showing', { count: rows.length })}</span>
            {entries.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void entries.fetchNextPage()}
                disabled={entries.isFetchingNextPage}
              >
                {entries.isFetchingNextPage && <Spinner />}
                {t('states.loadMore')}
              </Button>
            ) : (
              <span>{t('states.end')}</span>
            )}
          </div>
        </div>
      )}

      {canExport && <AuditExports filters={filters} />}

      <Drawer
        open={state.entry !== ''}
        onClose={() => change({ entry: '' })}
        title={t('detail.title')}
        closeLabel={t('common.close')}
      >
        {state.entry !== '' && <AuditDetail id={state.entry} />}
      </Drawer>
    </div>
  );
}

function retentionNote(
  t: ReturnType<typeof useTranslations>,
  days: number | null | undefined,
): string {
  if (days === undefined) return '';
  if (days === null) return t('retention.unknown');
  return days === 0 ? t('retention.forever') : t('retention.days', { days });
}
