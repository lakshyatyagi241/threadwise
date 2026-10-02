'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { translationUsageResponseSchema } from '@crm/contracts';
import { Alert, Field, Input, Spinner, StatTile } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { formatMicros, lastDays } from '../lib';

const NS = 'localization-translation.usage';

/** WD-I18N-030: translation volume and estimated cost for a date range (default: the last 30 days). */
export function UsagePage() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const [range, setRange] = useState(() => lastDays(30));
  const bad = range.from > range.to;
  const q = useQuery({
    queryKey: ['i18n', 'usage', range],
    enabled: !bad,
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/translation-usage', {
        query: range,
        schema: translationUsageResponseSchema,
        signal,
      }),
  });
  const n = (v: number) => f.number(v);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('kicker')} title={t('title')} description={t('description')} />
      <div className="flex flex-wrap gap-4">
        {(['from', 'to'] as const).map((k) => (
          <Field key={k} label={t(k)} htmlFor={`usage-${k}`}>
            <Input
              id={`usage-${k}`}
              type="date"
              value={range[k]}
              onChange={(e) => e.target.value && setRange((r) => ({ ...r, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {bad && <Alert tone="danger">{t('badRange')}</Alert>}
      {!bad && q.isPending && <Spinner label={t('loading')} />}
      {!bad && q.isError && <Alert tone="danger">{t('failed')}</Alert>}
      {!bad && q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('totals.calls')} value={n(q.data.totals.calls)} />
            <StatTile label={t('totals.charsIn')} value={n(q.data.totals.charsIn)} />
            <StatTile
              label={t('totals.cost')}
              value={formatMicros(q.data.totals.costMicros)}
              tone="accent"
              hint={t('estimate')}
            />
            <StatTile label={t('totals.fallbackHits')} value={n(q.data.totals.fallbackHits)} />
          </div>
          <Table
            title={t('byProvider')}
            head={[t('cols.provider'), t('cols.calls'), t('cols.chars'), t('cols.cost')]}
            rows={q.data.byProvider.map((r) => [
              r.providerSlug,
              n(r.calls),
              n(r.charsIn),
              formatMicros(r.costMicros),
            ])}
            empty={t('empty')}
          />
          <Table
            title={t('topWorkspaces')}
            head={[t('cols.workspace'), t('cols.calls'), t('cols.chars'), t('cols.cost')]}
            rows={q.data.topWorkspaces.map((r) => [
              r.name,
              n(r.calls),
              n(r.charsIn),
              formatMicros(r.costMicros),
            ])}
            empty={t('empty')}
          />
        </>
      )}
    </div>
  );
}

function Table({
  title,
  head,
  rows,
  empty,
}: {
  title: string;
  head: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={head.length} className="px-3 py-4 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
