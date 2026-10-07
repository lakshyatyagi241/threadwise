'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useDeferredValue, useMemo, useState } from 'react';
import type { RoutingRule } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import {
  refresh,
  routingApi,
  useAssignees,
  useRoutingSettings,
  useRules,
  KEYS,
} from '../api/routing';
import { namesSummary, whenChips } from '../lib/summary';

const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;
const reason = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.message ? e.message : fallback;

/**
 * `/auto-assignment` (Settings > Automation): the rules that give a new conversation to an agent, in the order they are tried, and the
 * switch that keeps a returning contact with their agent. Reading needs `inbox.settings.read`, changing needs `inbox.routing.manage`; a plan
 * without Routing rules gets the paywall sheet.
 */
export function AutoAssignmentScreen() {
  const t = useTranslations('team-inbox-routing-sla.page');
  const canRead = useCan('inbox.settings.read');
  const canManage = useCan('inbox.routing.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const rules = useRules(q, canRead);
  const settings = useRoutingSettings(canRead);
  const assignees = useAssignees(canRead);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RoutingRule | null>(null);

  const rows = useMemo(() => rules.data?.pages.flatMap((p) => p.data) ?? [], [rules.data]);
  const first = rules.data?.pages[0];
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of assignees.data?.users ?? []) m.set(u.id, u.name ?? u.email);
    for (const tm of assignees.data?.teams ?? []) m.set(tm.id, tm.name);
    return m;
  }, [assignees.data]);

  async function run(id: string, action: () => Promise<unknown>, failed: string) {
    setBusy(id);
    try {
      await action();
      await refresh(qc);
    } catch (e) {
      toast(reason(e, failed), 'danger');
    } finally {
      setBusy(null);
    }
  }

  const toggle = (r: RoutingRule, isActive: boolean) =>
    run(
      r.id,
      async () => {
        try {
          await routingApi.update(r.id, { rowVersion: r.rowVersion, isActive });
        } catch (e) {
          // The engine moves a rule's version each time it fires; a switch has nothing to lose, so it takes the current version once.
          if (!isCode(e, 'ROW_VERSION_CONFLICT')) throw e;
          const fresh = await routingApi.get(r.id);
          await routingApi.update(r.id, { rowVersion: fresh.rowVersion, isActive });
        }
      },
      t('toggleFailed'),
    );

  const move = (index: number, dir: -1 | 1) => {
    const a = rows[index];
    const b = rows[index + dir];
    if (!a || !b) return;
    // The two swap the priority slots they hold; every other rule keeps its place.
    const ids = dir === -1 ? [a.id, b.id] : [b.id, a.id];
    void run(a.id, () => routingApi.reorder(ids), t('reorderFailed'));
  };

  const keep = settings.data?.keepContactAgent ?? false;
  async function setKeep(on: boolean) {
    setBusy('settings');
    try {
      await routingApi.updateSettings(on);
      await qc.invalidateQueries({ queryKey: KEYS.settings });
    } catch (e) {
      toast(reason(e, t('settingsFailed')), 'danger');
    } finally {
      setBusy(null);
    }
  }

  if (!canRead) {
    return (
      <section className="mx-auto max-w-4xl">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }

  const locked = isCode(rules.error, 'PLAN_FEATURE_LOCKED');
  const atLimit = first?.limit != null && first.total >= first.limit;

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      {locked && (
        <PlanPaywall gates={[{ href: pathname, feature: 'inbox_routing' }]} enabled={[]} />
      )}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/automation"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('back')}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage && !locked && (
          <div className="text-end">
            {atLimit ? (
              <Button disabled>{t('create')}</Button>
            ) : (
              <Link href="/auto-assignment/new">
                <Button>{t('create')}</Button>
              </Link>
            )}
            {first?.limit != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {atLimit
                  ? t('limitReached', { limit: first.limit })
                  : t('limitUsed', { used: first.total, limit: first.limit })}
              </p>
            )}
          </div>
        )}
      </header>

      {!locked && (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-background p-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-base font-semibold">{t('keepTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('keepBody')}</p>
          </div>
          <Switch
            checked={keep}
            onCheckedChange={(on) => void setKeep(on)}
            disabled={!canManage || settings.isPending || busy === 'settings'}
            label={t('keepTitle')}
          />
        </div>
      )}

      {!locked && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t('rulesTitle')}</h2>
            <div className="w-full sm:w-72">
              <Input
                type="search"
                value={search}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchLabel')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('howItWorks')}</p>

          {rules.isPending ? (
            <div className="flex justify-center p-10" role="status" aria-label={t('loading')}>
              <Spinner />
            </div>
          ) : rules.isError ? (
            <Alert tone="danger">
              {t('loadFailed')}{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => void rules.refetch()}
              >
                {t('retry')}
              </button>
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              title={q ? t('noMatchTitle') : t('emptyTitle')}
              message={q ? t('noMatch', { q }) : t('empty')}
              actions={
                canManage && !q ? (
                  <Link href="/auto-assignment/new">
                    <Button>{t('create')}</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <ol className="space-y-3" aria-label={t('list')}>
                {rows.map((r, i) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    index={i}
                    last={i === rows.length - 1 && !rules.hasNextPage}
                    searching={q !== ''}
                    names={names}
                    busy={busy === r.id}
                    canManage={canManage}
                    onToggle={(on) => void toggle(r, on)}
                    onMove={(dir) => move(i, dir)}
                    onDuplicate={() =>
                      void run(
                        r.id,
                        async () => {
                          await routingApi.duplicate(r.id);
                          toast(t('duplicated'), 'success');
                        },
                        t('duplicateFailed'),
                      )
                    }
                    onDelete={() => setDeleting(r)}
                  />
                ))}
              </ol>
              {rules.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    disabled={rules.isFetchingNextPage}
                    onClick={() => void rules.fetchNextPage()}
                  >
                    {rules.isFetchingNextPage && <Spinner />}
                    {t('loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={deleting !== null && busy === deleting.id}
        onConfirm={() => {
          if (!deleting) return;
          const d = deleting;
          void run(
            d.id,
            async () => {
              await routingApi.remove(d.id);
              setDeleting(null);
              toast(t('deleted'), 'success');
            },
            t('deleteFailed'),
          );
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

export function RuleRow({
  rule,
  index,
  last,
  searching,
  names,
  busy,
  canManage,
  onToggle,
  onMove,
  onDuplicate,
  onDelete,
}: {
  rule: RoutingRule;
  index: number;
  last: boolean;
  searching: boolean;
  names: ReadonlyMap<string, string>;
  busy: boolean;
  canManage: boolean;
  onToggle: (on: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('team-inbox-routing-sla.rules');
  const tc = useTranslations('team-inbox-routing-sla.channels');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const chips = whenChips(rule, (k) => tc(k));
  const people = [...rule.assign.userIds, ...rule.assign.teamIds].map(
    (id) => names.get(id) ?? t('someone'),
  );
  const { shown, more } = namesSummary(people);
  const reorderable = canManage && !searching;

  return (
    <li className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label={t('moveUp', { name: rule.name })}
              disabled={!reorderable || index === 0 || busy}
              onClick={() => onMove(-1)}
            >
              <span aria-hidden="true">↑</span>
            </button>
            <span
              className="text-xs font-semibold tabular-nums text-muted-foreground"
              title={t('priority')}
            >
              {rule.position}
            </span>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label={t('moveDown', { name: rule.name })}
              disabled={!reorderable || last || busy}
              onClick={() => onMove(1)}
            >
              <span aria-hidden="true">↓</span>
            </button>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">{rule.name}</h3>
              <Badge tone={rule.isActive ? 'success' : 'neutral'}>
                {rule.isActive ? t('active') : t('off')}
              </Badge>
              {rule.isFallback && <Badge tone="warning">{t('fallback')}</Badge>}
              {!rule.stopOnMatch && <Badge tone="neutral">{t('continues')}</Badge>}
              {rule.unavailableTargets > 0 && (
                <Badge tone="danger">{t('unavailable', { count: rule.unavailableTargets })}</Badge>
              )}
            </div>
            {rule.description && (
              <p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>
            )}
          </div>
        </div>
        {canManage && (
          <Switch
            checked={rule.isActive}
            onCheckedChange={onToggle}
            disabled={busy}
            label={t('activeFor', { name: rule.name })}
          />
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-muted-foreground">{t('whenLabel')}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Badge key={c.key}>{t(`when.${c.key}`, c.values)}</Badge>
          ))}
        </dd>
        <dt className="font-medium text-muted-foreground">{t('thenLabel')}</dt>
        <dd>
          {t(`strategy.${rule.assign.strategy}`)}
          {': '}
          {shown.join(', ')}
          {more > 0 && ` ${t('andMore', { count: more })}`}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {rule.firedCount === 0 ? t('neverFired') : t('fired', { count: rule.firedCount })}
          {rule.lastFiredAt &&
            ` · ${t('lastFired', {
              when: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone,
              }).format(new Date(rule.lastFiredAt)),
            })}`}
        </span>
        {canManage && (
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/auto-assignment/${rule.id}`}>
              <Button variant="secondary" size="sm">
                {t('edit')}
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={onDuplicate} disabled={busy}>
              {t('duplicate')}
            </Button>
            <Button variant="secondary" size="sm" onClick={onDelete} disabled={busy}>
              {t('delete')}
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}
