'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useFormatter } from 'next-intl';
import { Alert, Badge, Button, EmptyState, Select, Spinner } from '@crm/ui';
import {
  ASSIGNMENT_RUN_OUTCOMES,
  ASSIGNMENT_RUN_RETENTION_DAYS,
  type AssignmentRule,
  type AssignmentSubject,
} from '@crm/contracts';
import { useAssignmentRuns, type RunFilters } from '../api/assignment';
import { runTone } from '../lib/outcome';
import { recordHref } from '../lib/subjects';
import { TraceList } from './test-box';
import { useRa } from './use-ra';

/**
 * The run log of one module: what the engine did with each record, newest first, with the rule, the person, the method, how the
 * record arrived and (expandable) every rule it was tried against. Entries hold ids only and are kept 90 days.
 */
export function RunLog({
  subject,
  rules,
}: {
  subject: AssignmentSubject;
  rules: readonly AssignmentRule[];
}) {
  const { t } = useRa();
  const format = useFormatter();
  const [outcome, setOutcome] = useState<RunFilters['outcome']>(undefined);
  const [ruleId, setRuleId] = useState<string | undefined>(undefined);
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const filters: RunFilters = {
    subject,
    ...(outcome ? { outcome } : {}),
    ...(ruleId ? { ruleId } : {}),
  };
  const q = useAssignmentRuns(filters);
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = outcome !== undefined || ruleId !== undefined;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="space-y-3" data-testid="ra-log" aria-labelledby={`ra-log-${subject}`}>
      <div>
        <h3 id={`ra-log-${subject}`} className="text-sm font-semibold">
          {t('log.title')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('log.intro', { days: ASSIGNMENT_RUN_RETENTION_DAYS })}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{t('log.filterOutcome')}</span>
          <Select
            value={outcome ?? ''}
            onChange={(e) => setOutcome((e.target.value || undefined) as RunFilters['outcome'])}
          >
            <option value="">{t('log.allOutcomes')}</option>
            {ASSIGNMENT_RUN_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`log.outcome.${o}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{t('log.filterRule')}</span>
          <Select value={ruleId ?? ''} onChange={(e) => setRuleId(e.target.value || undefined)}>
            <option value="">{t('log.allRules')}</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {q.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('log.loading')}
        </p>
      ) : q.isError ? (
        <Alert tone="danger">
          <p>{t('log.loadFailed')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            {t('list.retry')}
          </Button>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={t(filtered ? 'log.emptyFiltered' : 'log.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[56rem] text-start text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {(
                  [
                    'when',
                    'record',
                    'outcome',
                    'reason',
                    'rule',
                    'assignedTo',
                    'method',
                    'arrived',
                  ] as const
                ).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`log.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const expanded = openTrace === r.id;
                const label = r.record?.label ?? t('log.deletedRecord');
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {when(r.createdAt)}
                        <span className="block text-muted-foreground">
                          {t(`log.trigger.${r.trigger}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2" dir="auto">
                        {r.record ? (
                          <Link
                            href={recordHref(subject, r.record.id)}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.record.label}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            runTone(r.outcome) === 'success'
                              ? 'success'
                              : runTone(r.outcome) === 'warning'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {t(`log.outcome.${r.outcome}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {t(`log.reason.${r.reason}`)}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={t('log.traceFor', { record: label })}
                          className="mt-1 block text-xs underline underline-offset-2"
                          onClick={() => setOpenTrace(expanded ? null : r.id)}
                        >
                          {expanded ? t('log.hideTrace') : t('log.showTrace')}
                        </button>
                      </td>
                      <td className="px-3 py-2" dir="auto">
                        {r.ruleName ?? (
                          <span className="text-muted-foreground">{t('log.noRule')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2" dir="auto">
                        {r.owner?.name ?? '–'}
                      </td>
                      <td className="px-3 py-2">{r.method ? t(`strategy.${r.method}`) : '–'}</td>
                      <td className="px-3 py-2">{originLabel(r.origin, t)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} className="bg-muted/30 px-3 py-3">
                          <TraceList
                            trace={r.trace}
                            assigned={r.outcome !== 'skipped'}
                            title={t('log.traceFor', { record: label })}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {q.hasNextPage && (
        <Button
          variant="secondary"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage && <Spinner />}
          {t('log.loadMore')}
        </Button>
      )}
    </section>
  );
}

const KNOWN_ORIGINS = ['manual', 'import', 'inbound', 'form', 'lead', 'api'];
function originLabel(origin: string, t: (key: string) => string): string {
  return KNOWN_ORIGINS.includes(origin) ? t(`origin.${origin}`) : origin;
}
