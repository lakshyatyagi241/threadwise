'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { PermissionDefResponse, RecordScope } from '@crm/contracts';
import { Alert, Input, Select, cn } from '@crm/ui';
import { usePlanFeature } from '@/lib/plan-features';
import { SearchIcon } from '../../ui/icons';
import { SectionBadge } from '../../ui/chrome';
import { TriCheckbox } from '../../ui/tri-checkbox';
import {
  isLocked,
  permissionBadge,
  planFeatureFallback,
  selectableKeys,
} from '../lib/permission-lock';
import {
  countDenied,
  countSelected,
  filterDefs,
  groupByCategory,
  needsTeamWarning,
  scopeOptions,
  setEffect,
  setMany,
  setScope,
  toggleKey,
  triState,
  type GrantDraft,
} from '../lib/matrix';

const NS = 'roles-permissions-workspace.matrix';

/**
 * The permission matrix of the role editor: every key of `GET /v2/permissions`, grouped by category. A key is granted
 * with its checkbox; a granted key can be flipped to Deny (deny beats allow) and, when it supports a record scope,
 * limited to all records, the team and its sub-teams, the team or own records.
 */
export function PermissionMatrix({
  defs,
  draft,
  onChange,
  readOnly,
  membersWithoutTeam,
}: {
  defs: readonly PermissionDefResponse[];
  draft: GrantDraft;
  onChange: (next: GrantDraft) => void;
  readOnly: boolean;
  /** Active members holding the edited role who are in no team (`RoleResponse.membersWithoutTeam`). */
  membersWithoutTeam?: number;
}) {
  const t = useTranslations(NS);
  const tf = useTranslations('plans-subscriptions-trials.features');
  const [query, setQuery] = useState('');
  const allKeys = useMemo(() => selectableKeys(defs), [defs]);
  const visible = useMemo(() => filterDefs(defs, query), [defs, query]);
  const groups = useMemo(() => groupByCategory(visible), [visible]);
  const visibleKeys = useMemo(() => selectableKeys(visible), [visible]);
  const denied = countDenied(draft);
  // Offered only when the workspace has the plan feature `team_hierarchy` (BL-383); a role that already holds it keeps the option.
  const hierarchyOffered = usePlanFeature('team_hierarchy');
  const legend = scopeOptions(hierarchyOffered);

  return (
    <section
      aria-labelledby="matrix-title"
      className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <div className="space-y-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <SectionBadge n="02" />
            <h2 id="matrix-title" className="text-lg font-semibold leading-none">
              {t('title')}
            </h2>
            <span
              aria-live="polite"
              dir="auto"
              data-testid="perm-count"
              className="font-mono text-xs text-muted-foreground"
            >
              {t('counter', { count: countSelected(draft, allKeys), total: allKeys.length })}
              {denied > 0 && ` · ${t('deniedCount', { count: denied })}`}
            </span>
          </div>
          <TriCheckbox
            state={triState(draft, visibleKeys)}
            disabled={readOnly || visibleKeys.length === 0}
            onChange={(on) => onChange(setMany(draft, visibleKeys, on))}
            label={<span className="text-sm font-semibold">{t('selectAll')}</span>}
            data-testid="grand-select"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              aria-label={t('searchLabel')}
              placeholder={t('search')}
              className="h-9 rounded-full ps-9 text-xs"
            />
          </div>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('denyHint')}</p>
        </div>
        {needsTeamWarning(draft, membersWithoutTeam, defs) && (
          <Alert tone="warning" data-testid="no-team-warning">
            {t.rich('noTeamWarning', {
              count: membersWithoutTeam ?? 0,
              link: (chunks) => (
                <Link href="/teams" className="font-medium underline">
                  {chunks}
                </Link>
              ),
            })}
          </Alert>
        )}
        <ul
          aria-label={t('scopeLegend')}
          data-testid="scope-legend"
          className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2"
        >
          {[...legend].reverse().map((s) => (
            <li key={s}>
              <span className="font-medium text-foreground">{t(`scope.${s}`)}</span>
              {': '}
              {t(`scopeHelp.${s}`)}
            </li>
          ))}
        </ul>
      </div>

      {groups.length === 0 ? (
        <p
          className="px-4 py-10 text-center text-sm text-muted-foreground"
          data-testid="matrix-empty"
        >
          {defs.length === 0 ? t('emptyCatalogue') : t('noMatch', { query })}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => {
            const headingId = `matrix-cat-${g.category}`;
            const open = selectableKeys(g.items);
            return (
              <div
                key={g.category}
                role="group"
                aria-labelledby={headingId}
                data-category={g.category}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <h3 id={headingId} className="text-sm font-semibold">
                      {g.category}
                    </h3>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {countSelected(draft, open)} / {open.length}
                    </span>
                  </div>
                  <TriCheckbox
                    state={triState(draft, open)}
                    disabled={readOnly || open.length === 0}
                    onChange={(on) => onChange(setMany(draft, open, on))}
                    label={<span className="text-xs">{t('selectAllCategory')}</span>}
                    aria-label={t('selectAllOf', { category: g.category })}
                    data-testid={`select-all-${g.category}`}
                  />
                </div>
                <ul className="divide-y divide-border/60">
                  {g.items.map((d) => {
                    const grant = draft.get(d.key);
                    const id = `perm-${d.key}`;
                    const badge = permissionBadge(d);
                    const lockedRow = isLocked(d);
                    return (
                      <li
                        key={d.key}
                        data-testid={`perm-row-${d.key}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-muted/30"
                      >
                        <label
                          htmlFor={id}
                          className={cn(
                            'flex min-w-0 flex-1 basis-60 items-start gap-2.5',
                            readOnly || lockedRow ? 'cursor-default' : 'cursor-pointer',
                            lockedRow && 'opacity-70',
                          )}
                        >
                          <input
                            id={id}
                            type="checkbox"
                            checked={Boolean(grant)}
                            disabled={readOnly || lockedRow}
                            onChange={() => onChange(toggleKey(draft, d.key))}
                            className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span>{d.label}</span>
                              {badge && (
                                <span
                                  data-testid={`lock-badge-${d.key}`}
                                  title={t('lockedHint')}
                                  className="inline-flex max-w-full items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
                                >
                                  {badge.kind === 'plan_feature'
                                    ? t('needsPlan', {
                                        feature: tf.has(badge.key)
                                          ? tf(badge.key)
                                          : planFeatureFallback(badge.key),
                                      })
                                    : t('needsApp', { app: badge.slug })}
                                </span>
                              )}
                            </span>
                            {t.has(`permissionHelp.${d.key.replaceAll('.', '_')}`) && (
                              <span
                                data-testid={`perm-help-${d.key}`}
                                className="mt-0.5 block text-xs text-muted-foreground"
                              >
                                {t(`permissionHelp.${d.key.replaceAll('.', '_')}`)}
                              </span>
                            )}
                            <span
                              className="block break-all font-mono text-[11px] text-muted-foreground"
                              dir="ltr"
                            >
                              {d.key}
                            </span>
                          </span>
                        </label>
                        {grant && (
                          <div className="flex flex-wrap items-center gap-2">
                            <div
                              role="group"
                              aria-label={t('effectLabel', { label: d.label })}
                              className="inline-flex overflow-hidden rounded-full border border-border text-xs"
                            >
                              {(['allow', 'deny'] as const).map((effect) => (
                                <button
                                  key={effect}
                                  type="button"
                                  disabled={readOnly}
                                  aria-pressed={grant.effect === effect}
                                  data-testid={`effect-${effect}-${d.key}`}
                                  onClick={() => onChange(setEffect(draft, d.key, effect))}
                                  className={cn(
                                    'px-3 py-1 font-medium focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
                                    grant.effect === effect
                                      ? effect === 'deny'
                                        ? 'bg-danger text-danger-foreground'
                                        : 'bg-primary text-primary-foreground'
                                      : 'text-muted-foreground hover:bg-muted',
                                  )}
                                >
                                  {t(effect)}
                                </button>
                              ))}
                            </div>
                            {d.supportsScope && (
                              <Select
                                aria-label={t('scopeLabel', { label: d.label })}
                                data-testid={`scope-${d.key}`}
                                value={grant.recordScope}
                                disabled={readOnly}
                                onChange={(e) =>
                                  onChange(setScope(draft, d.key, e.target.value as RecordScope))
                                }
                                className="h-8 w-auto px-2 text-xs"
                              >
                                {scopeOptions(hierarchyOffered, grant.recordScope).map((s) => (
                                  <option key={s} value={s}>
                                    {t(`scope.${s}`)}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
