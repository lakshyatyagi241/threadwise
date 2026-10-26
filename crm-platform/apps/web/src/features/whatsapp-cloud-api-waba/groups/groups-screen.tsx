'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Card, Spinner, StatTile } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useNumbers } from '../api/hooks';
import { useGroups, useGroupsState } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { CreateGroupForm } from './create-group-form';
import { GroupNumberRail } from './group-number-rail';
import { GroupRow } from './group-row';
import { useGroupsLive } from './use-groups-live';
import { blockedView, pickAccount, type GroupNotice } from './groups-model';
import { BlockedState, CheckFailedNote, NoNumberState } from './groups-states';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * `/waba-groups` (Reference "Meta Groups"): the groups of one connected WhatsApp Business number. Rail with the number and how groups work,
 * the four counters, the inline create form, the list. "Not eligible" and the other blocked states are normal views, not errors.
 * Spec: docs/specs/waba-groups-management.md section 14.
 */
export function GroupsScreen({ accountId }: { accountId?: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const tc = useTranslations('whatsapp-cloud-api-waba.common');
  const errorText = useErrorText();
  const canCreate = useCan('waba.groups.create');
  const canManage = useCan('waba.groups.manage');
  const canDelete = useCan('waba.groups.delete');
  const numbers = useNumbers();
  const [notice, setNotice] = useState<GroupNotice | null>(null);

  const connected = (numbers.data?.items ?? []).filter((n) => n.status === 'connected');
  const account = pickAccount(connected, accountId);
  const number = account?.id ?? null;
  const state = useGroupsState(number);
  const blocked = state.data ? blockedView(state.data.reason) : null;
  const usable = state.data !== undefined && blocked === null;
  const groups = useGroups(number, usable);
  // A colleague's change or Meta's webhook (a join request, a suspension, a new link) shows without a reload.
  useGroupsLive(usable ? number : null);
  const items = groups.data?.pages.flatMap((p) => p.items) ?? [];
  const stats = groups.data?.pages[0]?.stats;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <GroupNumberRail account={account} numbers={connected} state={state.data} />

        <section className="min-w-0 space-y-5">
          <header>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold leading-none">
              {t('headingA')} <span className="not-italic text-primary">{t('headingB')}</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
          </header>

          {notice && (
            <Alert tone={notice.tone}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div>{notice.text}</div>
                </div>
                <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
                  {tc('dismiss')}
                </button>
              </div>
            </Alert>
          )}

          {numbers.isPending ? (
            <Loading label={t('loading')} />
          ) : numbers.isError ? (
            <Alert tone="danger">
              {numbers.error instanceof ApiError && numbers.error.status === 403
                ? t('numbersDenied')
                : t('loadFailed')}{' '}
              <button type="button" className="underline" onClick={() => numbers.refetch()}>
                {t('retry')}
              </button>
            </Alert>
          ) : !account ? (
            <NoNumberState />
          ) : state.isPending ? (
            <Loading label={t('loading')} />
          ) : state.isError || !state.data ? (
            <Alert tone="danger">
              {errorText(state.error).text}{' '}
              <button type="button" className="underline" onClick={() => state.refetch()}>
                {t('retry')}
              </button>
            </Alert>
          ) : blocked ? (
            <BlockedState kind={blocked} number={account.id} />
          ) : (
            <>
              <CheckFailedNote state={state.data} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="groups-kpis">
                <StatTile
                  label={t('kpi.groups')}
                  value={fmt(stats?.groups ?? 0)}
                  hint={t('kpi.groupsSub')}
                />
                <StatTile
                  label={t('kpi.members')}
                  value={fmt(stats?.members ?? 0)}
                  hint={t('kpi.membersSub')}
                />
                <StatTile
                  label={t('kpi.joinRequests')}
                  value={fmt(stats?.joinRequests ?? 0)}
                  hint={t('kpi.joinRequestsSub')}
                />
                <StatTile
                  label={t('kpi.suspended')}
                  value={fmt(stats?.suspended ?? 0)}
                  hint={t('kpi.suspendedSub')}
                  tone={stats && stats.suspended > 0 ? 'warning' : 'default'}
                />
              </div>

              {canCreate && <CreateGroupForm number={account.id} onNotice={setNotice} />}

              <Card className="overflow-hidden">
                <div className="border-b border-border px-5 py-4">
                  <p className="text-lg font-semibold">{t('list.title')}</p>
                </div>
                {groups.isPending ? (
                  <div className="px-5 py-6">
                    <Loading label={t('loading')} />
                  </div>
                ) : groups.isError ? (
                  <div className="px-5 py-6">
                    <Alert tone="danger">
                      {errorText(groups.error).text}{' '}
                      <button type="button" className="underline" onClick={() => groups.refetch()}>
                        {t('retry')}
                      </button>
                    </Alert>
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
                  </div>
                ) : (
                  <>
                    {items.map((g) => (
                      <GroupRow
                        key={g.id}
                        number={account.id}
                        group={g}
                        canManage={canManage}
                        canDelete={canDelete}
                        onNotice={setNotice}
                      />
                    ))}
                    {groups.hasNextPage && (
                      <div className="px-5 py-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={groups.isFetchingNextPage}
                          onClick={() => groups.fetchNextPage()}
                        >
                          {groups.isFetchingNextPage ? t('list.loadingMore') : t('list.loadMore')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}
