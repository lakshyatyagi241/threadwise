'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspacePlan } from '@crm/contracts';
import { Badge, Button, Card, EmptyState, Input, Select } from '@crm/ui';
import {
  PLANS_QUERY_KEY,
  fetchPlans,
} from '@/features/auth-registration-security/platform/plans/plans-query';
import { useCanEdit } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ReadOnlyNotice } from '@/features/auth-registration-security/platform/ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { WORKSPACE_PLANS_KEY, fetchWorkspacePlans } from '../api';
import { STATE_TONE } from '../lib/format';
import { AttachDialog } from './attach-dialog';
import { RetentionPanel } from './retention-panel';

const NS = 'plans-subscriptions-trials.operator';

/** Super admin console: every workspace with its plan, state and own limits; attach a plan or change a workspace's limits. */
export function WorkspacePlansPage() {
  const t = useTranslations(NS);
  const ts = useTranslations(`${NS}.state`);
  const locale = useLocale();
  const qc = useQueryClient();
  const canEdit = useCanEdit('plans');
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [editing, setEditing] = useState<WorkspacePlan | null>(null);

  const plans = useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlans(signal),
    refetchOnWindowFocus: false,
  });
  const list = useInfiniteQuery({
    queryKey: [...WORKSPACE_PLANS_KEY, search, plan],
    queryFn: ({ pageParam, signal }) =>
      fetchWorkspacePlans(
        { search: search || undefined, plan: plan || undefined, cursor: pageParam, limit: 25 },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
      : t('never');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      {!canEdit && <ReadOnlyNotice section="plans" />}

      <RetentionPanel canEdit={canEdit} />

      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          value={search}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label={t('allPlans')}>
          <option value="">{t('allPlans')}</option>
          {(plans.data?.data ?? []).map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('title')} message={t('empty')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm" data-testid="workspace-plans-table">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {(['workspace', 'plan', 'state', 'ends', 'overrides', 'actions'] as const).map(
                  (c) => (
                    <th key={c} scope="col" className="px-4 py-3 text-start font-medium">
                      {t(`columns.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const count =
                  Object.keys(w.overrides.limits).length + Object.keys(w.overrides.features).length;
                return (
                  <tr key={w.workspaceId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{w.name}</p>
                      <p className="text-xs text-muted-foreground">{w.slug}</p>
                    </td>
                    <td className="px-4 py-3">{w.planName ?? w.planSlug}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATE_TONE[w.validity.state]}>{ts(w.validity.state)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {date(
                        w.validity.state === 'free_trial'
                          ? w.validity.trialEndsAt
                          : w.validity.planEndsAt,
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {count > 0 ? t('overrideCount', { count }) : t('none')}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canEdit}
                        onClick={() => setEditing(w)}
                      >
                        {t('edit')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      )}

      <AttachDialog
        workspace={editing}
        plans={plans.data?.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void qc.invalidateQueries({ queryKey: WORKSPACE_PLANS_KEY });
          void qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
        }}
      />
    </div>
  );
}
