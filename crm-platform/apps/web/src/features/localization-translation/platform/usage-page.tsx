'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { translationUsageResponseSchema } from '@crm/contracts';
import { Alert, Button, Card, Spinner } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { formatMicros, monthToDate } from '../lib';

const NS = 'localization-translation.usage';
const HEAD = 'font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-2.5 font-medium';

/**
 * TW-I18N-030, laid out like Reference's "Translation usage" page: a From/To/Apply form, four headline cards, the
 * per-provider table with its rate, a 30-day bar chart and the top workspaces. The range opens on this month.
 */
export function UsagePage() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const [draft, setDraft] = useState(() => monthToDate());
  const [range, setRange] = useState(draft);
  const bad = draft.from > draft.to;
  const q = useQuery({
    queryKey: ['i18n', 'usage', range],
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/translation-usage', {
        query: range,
        schema: translationUsageResponseSchema,
        signal,
      }),
  });
  const n = (v: number) => f.number(v);
  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (!bad) setRange(draft);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <form onSubmit={apply} className="flex flex-wrap items-end gap-2 text-xs">
            {(
              [
                ['from', t('from')],
                ['to', t('to')],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                {label}
                <input
                  type="date"
                  value={draft[k]}
                  onChange={(e) =>
                    e.target.value && setDraft((r) => ({ ...r, [k]: e.target.value }))
                  }
                  className="rounded border border-border bg-background px-2 py-1 font-mono"
                />
              </label>
            ))}
            <Button type="submit" size="sm" variant="brand">
              {t('apply')}
            </Button>
          </form>
        }
      />
      {bad && <Alert tone="danger">{t('badRange')}</Alert>}
      {q.isPending && <Spinner label={t('loading')} />}
      {q.isError && <Alert tone="danger">{t('failed')}</Alert>}
      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Headline label={t('totals.calls')} value={n(q.data.totals.calls)} />
            <Headline
              label={t('totals.chars')}
              value={n(q.data.totals.charsIn)}
              hint={t('totals.charsOut', { count: n(q.data.totals.charsOut) })}
            />
            <Headline
              label={t('totals.cost')}
              value={formatMicros(q.data.totals.costMicros)}
              hint={t('totals.costHint')}
            />
            <Headline
              label={t('totals.fallbackHits')}
              value={n(q.data.totals.fallbackHits)}
              hint={t('totals.fallbackHint')}
            />
          </div>
          <Section title={t('byProvider')}>
            {q.data.byProvider.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                {t('emptyProvider')}
              </p>
            ) : (
              <Table
                head={[
                  t('cols.provider'),
                  t('cols.calls'),
                  t('cols.charsIn'),
                  t('cols.cost'),
                  t('cols.rate'),
                ]}
                rows={q.data.byProvider.map((r) => [
                  r.providerSlug,
                  n(r.calls),
                  n(r.charsIn),
                  formatMicros(r.costMicros),
                  r.ratePerMillionChars === '0' ? t('free') : formatMicros(r.ratePerMillionChars),
                ])}
              />
            )}
          </Section>
          {q.data.timeline.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-1 text-lg font-semibold">{t('last30')}</h2>
              <Timeline days={q.data.timeline} />
              <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground">
                {t('timelineHint')}
              </p>
            </Card>
          )}
          <Section title={t('topWorkspaces')}>
            {q.data.topWorkspaces.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                {t('emptyWorkspaces')}
              </p>
            ) : (
              <Table
                head={[t('cols.workspace'), t('cols.calls'), t('cols.chars'), t('cols.cost')]}
                rows={q.data.topWorkspaces.map((r) => [
                  r.name,
                  n(r.calls),
                  n(r.charsIn),
                  formatMicros(r.costMicros),
                ])}
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Headline({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold leading-none tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 font-mono text-[0.7rem] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

/** Bars scaled to the busiest day; each carries its date, characters and cost as a tooltip. */
function Timeline({
  days,
}: {
  days: Array<{ date: string; charsIn: number; costMicros: string }>;
}) {
  const f = useFormatter();
  const max = Math.max(1, ...days.map((d) => d.charsIn));
  return (
    <div className="overflow-x-auto">
      <div
        className="mt-4 flex h-32 min-w-[35rem] items-end gap-1"
        role="img"
        aria-label={days.map((d) => d.date).join(', ')}
      >
        {days.map((d) => (
          <div
            key={d.date}
            className="flex-1 rounded-sm bg-brand/80"
            style={{ height: `${Math.max(2, Math.round((120 * d.charsIn) / max))}px` }}
            title={`${d.date}: ${f.number(d.charsIn)} · ${formatMicros(d.costMicros)}`}
          />
        ))}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-[0.78rem]">
        <thead className="border-b border-border bg-muted text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={HEAD + (i === 0 ? ' text-start' : ' text-end')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className={
                    'px-3 py-2.5 font-mono tabular-nums ' +
                    (j === 0 ? 'text-start font-medium' : 'text-end')
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
