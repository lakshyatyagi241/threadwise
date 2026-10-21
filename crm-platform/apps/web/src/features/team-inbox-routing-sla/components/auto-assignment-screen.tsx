'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { RoutingRule } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Spinner, Switch, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useVocab } from '@/features/persona-vocabulary';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refresh, routingApi, updateRuleFresh, useAssignees, useRules } from '../api/routing';
import {
  everyoneElseOf,
  movedIds,
  pipelineRules,
  shadowedIds,
  shadowedRules,
  neverMatches,
} from '../lib/pipeline';
import { namesSummary, whenChips } from '../lib/summary';
import { AssignmentSwitches } from './assignment-switches';
import { BusinessHoursDialog } from './business-hours-dialog';
import { EveryoneElseRow, ensureEveryoneElseEvenly } from './everyone-else-row';
import { TryItPanel } from './try-it-panel';

const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;
const reason = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.message ? e.message : fallback;

/**
 * `/auto-assignment` (Settings > Automation). From the top (spec H13 to H20): four plain switches (Auto Assignment, Sticky Agent, contact
 * owner, claim sets owner) with Advanced under them; then the OPTIONAL layer "Need more control? Add rules": the one pipeline (the switches'
 * contact-owner and sticky step, your rules in priority order, Everyone else pinned last, then the waiting queue), where it applies, and a
 * "Try it" box that dry-runs the engine. A workspace that only wants the four switches never creates a rule. Reading needs
 * `inbox.settings.read`, changing `inbox.routing.manage`; a plan without Routing rules gets the paywall sheet and the switches its plan allows.
 */
export function AutoAssignmentScreen() {
  const t = useTranslations('team-inbox-routing-sla.page');
  const tr = useTranslations('team-inbox-routing-sla.assign.rules');
  const te = useTranslations('team-inbox-routing-sla.assign.everyone');
  const contactNoun = useVocab('contact');
  const dealNoun = useVocab('deal');
  const canRead = useCan('inbox.settings.read');
  const canManage = useCan('inbox.routing.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const rules = useRules('', canRead);
  const assignees = useAssignees(canRead);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RoutingRule | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  // The pipeline needs every rule at once (Everyone else may be on any page), so the pages load one after the other.
  useEffect(() => {
    if (rules.hasNextPage && !rules.isFetchingNextPage) void rules.fetchNextPage();
  }, [rules]);

  const rows = useMemo(() => rules.data?.pages.flatMap((p) => p.data) ?? [], [rules.data]);
  const first = rules.data?.pages[0];
  const ordered = useMemo(() => pipelineRules(rows), [rows]);
  const everyoneElse = useMemo(() => everyoneElseOf(rows), [rows]);
  const blocked = useMemo(() => shadowedIds(ordered), [ordered]);
  const blockers = useMemo(() => shadowedRules(ordered), [ordered]);
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
    run(r.id, () => updateRuleFresh(r, { isActive }), t('toggleFailed'));

  /** The rules in their new order: they take the priority slots they hold now; Everyone else and the rest keep theirs. */
  const reorderTo = (from: number, to: number) => {
    const current = ordered.map((r) => r.id);
    const ids = movedIds(current, from, to);
    if (ids.length < 2 || ids.join() === current.join()) return;
    void run(
      ordered[from]!.id,
      async () => {
        await routingApi.reorder(ids);
        toast(tr('reordered'));
      },
      t('reorderFailed'),
    );
  };

  /** Auto Assignment was just switched on: when the workspace has no Everyone else row, create it with "evenly" selected (never at deploy). */
  async function onAutoEnabled() {
    let cursor: string | undefined;
    for (;;) {
      const page = await routingApi.list('', cursor);
      if (page.data.some((r) => r.isFallback)) return;
      if (!page.page.nextCursor) break;
      cursor = page.page.nextCursor;
    }
    await ensureEveryoneElseEvenly(undefined, te('ruleName'));
    await refresh(qc);
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
    <section className="mx-auto max-w-4xl space-y-8">
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
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground" data-testid="record-note">
            {t.rich('recordNote', {
              contacts: contactNoun.pluralLower,
              deals: dealNoun.pluralLower,
              link: (chunks) => (
                <Link href="/record-assignment" className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        {canRead && !locked && (
          <Button variant="secondary" onClick={() => setHoursOpen(true)}>
            {t('businessHours')}
          </Button>
        )}
      </header>

      <BusinessHoursDialog
        open={hoursOpen}
        canManage={canManage}
        onClose={() => setHoursOpen(false)}
      />

      <AssignmentSwitches onAutoEnabled={locked ? async () => undefined : onAutoEnabled} />

      <section className="space-y-4" data-testid="rules-layer" aria-labelledby="rules-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="rules-title" className="text-lg font-semibold">
              {tr('title')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tr('intro')}</p>
          </div>
          {canManage && !locked && (
            <div className="text-end">
              {atLimit ? (
                <Button disabled>{tr('add')}</Button>
              ) : (
                <Link href="/auto-assignment/new">
                  <Button>{tr('add')}</Button>
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
        </div>

        {locked ? (
          <Alert tone="info">{tr('locked')}</Alert>
        ) : (
          <>
            <Pipeline />
            <p className="text-sm font-medium" data-testid="never-changes">
              {tr('never')}
            </p>

            {blockers.map((b) => (
              <Alert key={b.blocker.id} tone="warning">
                <span data-testid="shadow-warning">
                  {tr('shadowed', {
                    count: b.blocked.length,
                    blocker: b.blocker.name,
                    names: b.blocked.map((r) => r.name).join(', '),
                  })}
                </span>
              </Alert>
            ))}

            {rules.isPending ? (
              <div className="flex justify-center p-10" role="status" aria-label={tr('loading')}>
                <Spinner />
              </div>
            ) : rules.isError ? (
              <Alert tone="danger">
                {tr('loadFailed')}{' '}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => void rules.refetch()}
                >
                  {t('retry')}
                </button>
              </Alert>
            ) : (
              <>
                {ordered.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">{tr('emptyTitle')}</p>
                    <p>{tr('empty')}</p>
                  </div>
                ) : (
                  <ol className="space-y-3" aria-label={t('list')}>
                    {ordered.map((r, i) => (
                      <RuleRow
                        key={r.id}
                        rule={r}
                        index={i}
                        last={i === ordered.length - 1}
                        searching={false}
                        names={names}
                        busy={busy === r.id}
                        canManage={canManage}
                        shadowed={blocked.has(r.id)}
                        onToggle={(on) => void toggle(r, on)}
                        onMove={(dir) => reorderTo(i, i + dir)}
                        onDragStart={() => setDragFrom(i)}
                        onDragEnd={() => setDragFrom(null)}
                        onDropHere={() => {
                          if (dragFrom !== null) reorderTo(dragFrom, i);
                          setDragFrom(null);
                        }}
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
                )}
                <EveryoneElseRow rule={everyoneElse} names={names} canManage={canManage} />
              </>
            )}
          </>
        )}
      </section>

      {!locked && <TryItPanel names={names} />}
      {!locked && <WhereThisApplies />}

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

/** The four steps in the order a new chat goes through them. */
function Pipeline() {
  const tr = useTranslations('team-inbox-routing-sla.assign.rules');
  const steps = [
    ['agent', 'agentBody'],
    ['rules', 'rulesBody'],
    ['everyone', 'everyoneBody'],
    ['queue', 'queueBody'],
  ] as const;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3" data-testid="pipeline">
      <h3 className="text-sm font-semibold">{tr('pipelineTitle')}</h3>
      <ol className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([key, body]) => (
          <li key={key} className="rounded-lg border border-border bg-background p-2">
            <span className="block font-medium">{tr(`pipeline.${key}`)}</span>
            <span className="block text-xs text-muted-foreground">{tr(`pipeline.${body}`)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WhereThisApplies() {
  const t = useTranslations('team-inbox-routing-sla.assign.where');
  return (
    <section
      className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2"
      data-testid="where-applies"
      aria-labelledby="where-title"
    >
      <h2 id="where-title" className="text-lg font-semibold sm:col-span-2">
        {t('title')}
      </h2>
      <div>
        <h3 className="text-sm font-semibold">{t('applied')}</h3>
        <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('applied1')}</li>
          <li>{t('applied2')}</li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold">{t('not')}</h3>
        <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('not1')}</li>
          <li>{t('not2')}</li>
          <li>{t('not3')}</li>
        </ul>
      </div>
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
  shadowed = false,
  onToggle,
  onMove,
  onDragStart,
  onDragEnd,
  onDropHere,
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
  /** An active catch-all above this rule stops evaluation before it: it can never run. */
  shadowed?: boolean;
  onToggle: (on: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropHere?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('team-inbox-routing-sla.rules');
  const tr = useTranslations('team-inbox-routing-sla.assign.rules');
  const tc = useTranslations('team-inbox-routing-sla.channels');
  const tp = useTranslations('team-inbox-conversations.list');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [over, setOver] = useState(false);
  const chips = whenChips(rule, (k) => tc(k));
  const when = chips.map((c) => t(`when.${c.key}`, c.values)).join(', ');
  const people = [...(rule.assign?.userIds ?? []), ...(rule.assign?.teamIds ?? [])].map(
    (id) => names.get(id) ?? t('someone'),
  );
  const { shown, more } = namesSummary(people);
  const who = rule.assign?.everyone
    ? tr('everyoneWho')
    : shown.join(', ') + (more > 0 ? ` ${t('andMore', { count: more })}` : '');
  const how = rule.assign
    ? tr('assignWho', { strategy: t(`strategy.${rule.assign.strategy}`), who })
    : tr('noAssign');
  const reorderable = canManage && !searching;
  const never = neverMatches(rule);

  return (
    <li
      className={`space-y-3 rounded-xl border bg-background p-4 ${over ? 'border-primary' : 'border-border'}`}
      data-testid="rule-row"
      draggable={reorderable && !busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', rule.id);
        onDragStart?.();
      }}
      onDragEnd={() => {
        setOver(false);
        onDragEnd?.();
      }}
      onDragOver={(e) => {
        if (!reorderable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropHere?.();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex shrink-0 flex-col items-center gap-1"
            title={tr('drag', { name: rule.name })}
          >
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
              className="cursor-grab text-xs font-semibold tabular-nums text-muted-foreground"
              title={t('priority')}
            >
              {index + 1}
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
              {!rule.stopOnMatch && <Badge tone="neutral">{t('continues')}</Badge>}
              {rule.unavailableTargets > 0 && (
                <Badge tone="danger">{t('unavailable', { count: rule.unavailableTargets })}</Badge>
              )}
              {shadowed && <Badge tone="warning">{tr('neverRuns')}</Badge>}
              {never && <Badge tone="warning">{tr('neverMatches')}</Badge>}
            </div>
            <p className="mt-1 text-sm" data-testid="rule-sentence">
              {tr('sentence', { when, how })}
            </p>
            {never && <p className="mt-1 text-xs text-warning">{tr('neverMatchesHint')}</p>}
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

      {(rule.markSpam ||
        rule.priority ||
        rule.autoReply ||
        rule.escalation ||
        rule.addTags.length > 0 ||
        rule.triggerFlow) && (
        <div className="space-y-1 text-sm text-muted-foreground">
          {rule.markSpam && <p>{t('markSpamSummary')}</p>}
          {rule.priority && (
            <p>{t('prioritySummary', { priority: tp(`priority.${rule.priority}`) })}</p>
          )}
          {rule.autoReply && <p>{t('autoReplySummary', { body: rule.autoReply.body })}</p>}
          {rule.escalation && (
            <p>
              {t('escalationSummary', { minutes: rule.escalation.minutes })}{' '}
              {[
                rule.escalation.reassign ? t('escalationReassign') : null,
                rule.escalation.priority
                  ? t('escalationPriority', {
                      priority: tp(`priority.${rule.escalation.priority}`),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          )}
          {rule.addTags.length > 0 && (
            <p>{t('tagsSummary', { tags: rule.addTags.map((x) => x.name).join(', ') })}</p>
          )}
          {rule.triggerFlow && (
            <p className="flex flex-wrap items-center gap-2">
              {rule.triggerFlow.name === null
                ? t('flowGone')
                : t('startsFlow', { name: rule.triggerFlow.name })}
              {rule.triggerFlow.name !== null && !rule.triggerFlow.isActive && (
                <Badge tone="warning">{t('flowOff')}</Badge>
              )}
            </p>
          )}
        </div>
      )}

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
