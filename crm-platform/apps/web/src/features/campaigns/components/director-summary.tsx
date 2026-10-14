'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { CampaignSummary, SummaryFormRef, SummaryPerson } from '@crm/contracts';
import { Alert, Button, MultiSelect, Spinner, cn, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  fetchAllPeople,
  useDirectorSummary,
  useSummaryForms,
  useSummaryPeople,
} from '../api/summary';
import {
  PEOPLE_KINDS,
  WINDOWS,
  buildTiles,
  busiestDay,
  caveatLines,
  csvFileName,
  funnelRows,
  headlineText,
  isNotSent,
  isStillSending,
  peopleCsv,
  totalCameBack,
  type PeopleKind,
  type PctWords,
  type SummaryKind,
  type Tile,
} from '../lib/summary-model';
import { AreaChart, HBars } from './charts';
import { useSummaryForms as useRememberedForms, useSummaryWindow } from './use-summary-state';

/** Hides everything around the summary and sets the page for A4, so Print summary gives one clean page (the pattern of the invoice page). */
export const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; color: #000 !important; }
  body * { visibility: hidden !important; }
  .dsum-doc, .dsum-doc * { visibility: visible !important; }
  .dsum-doc { position: absolute !important; inset-inline-start: 0 !important; top: 0 !important; width: 100% !important;
    max-width: 100% !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
  .dsum-doc * { color: #000 !important; box-shadow: none !important; }
  .no-print { display: none !important; }
  .dsum-print-only { display: block !important; }
  .dsum-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .dsum-tile, .dsum-card { break-inside: avoid; border: 1px solid #999 !important; background: #fff !important; }
  .dsum-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

const CARD = 'dsum-card rounded-2xl border border-border bg-background p-5 shadow-sm';

/* ------------------------------------------------------------------------------------------- pieces */

function SummarySkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="h-24 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
    </div>
  );
}

function WindowPicker({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  const t = useTranslations('campaigns.detail.summary.window');
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium">{t('label')}</legend>
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((d) => (
          <label key={d} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={d}
              checked={days === d}
              onChange={() => onChange(d)}
              className="peer sr-only"
            />
            <span className="block rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
              {t('option', { days: d })}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{t('hint')}</p>
    </fieldset>
  );
}

function FormPicker({
  forms,
  failed,
  value,
  onChange,
}: {
  forms: SummaryFormRef[];
  failed: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('campaigns.detail.summary.forms');
  const id = useId();
  const options = forms.map((f) => ({
    value: f.id,
    label: t(f.kind === 'web' ? 'web' : 'whatsapp', { name: f.name }),
  }));
  return (
    <div className="min-w-0 flex-1 sm:max-w-md">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {t('label')}
      </label>
      <MultiSelect
        id={id}
        label={t('label')}
        options={options}
        value={value}
        onChange={onChange}
        placeholder={t('placeholder')}
        emptyLabel={t('empty')}
        removeLabel={(name) => t('remove', { name })}
        clearLabel={t('clear')}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{failed ? t('loadError') : t('hint')}</p>
    </div>
  );
}

function pctText(t: ReturnType<typeof useTranslations>, pct: PctWords): string {
  return pct.key === 'of' ? t('of', { pct: pct.pct }) : t(pct.key);
}

function TileCard({ tile, s }: { tile: Tile; s: CampaignSummary }) {
  const t = useTranslations('campaigns.detail.summary');
  const tp = useTranslations('campaigns.detail.summary.pct');
  const format = useFormatter();
  const accent = tile.key === 'wroteBack' || tile.key === 'filledForm';
  const explain =
    tile.key === 'wroteBack'
      ? t('tile.wroteBack.explain', { days: s.window.days })
      : tile.key === 'filledForm'
        ? s.filledForm && !s.filledForm.allForms
          ? t('tile.filledForm.explainSome', { count: s.filledForm.formsCounted.length })
          : t('tile.filledForm.explainAll')
        : t(`tile.${tile.key}.explain`);
  return (
    <li
      className={cn(
        'dsum-tile rounded-2xl border p-5',
        accent ? 'border-brand/40 bg-brand/5' : 'border-border bg-background',
      )}
    >
      <p className="text-sm font-semibold">{t(`tile.${tile.key}.label`)}</p>
      <p className="mt-2 text-4xl font-semibold leading-none tabular-nums">
        {format.number(tile.count)}
        <span className="sr-only"> {t('tile.unit', { count: tile.count })}</span>
      </p>
      <p className="mt-2 text-sm font-medium">
        {tile.pct ? pctText(tp, tile.pct) : t('tile.messaged.pct')}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{explain}</p>
    </li>
  );
}

function DailyChart({ s }: { s: CampaignSummary }) {
  const t = useTranslations('campaigns.detail.summary.daily');
  const locale = useLocale();
  const total = totalCameBack(s.cameBackByDay);
  const dayLabel = (day: string) => {
    const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(0, 10)}T00:00:00Z` : day);
    return Number.isNaN(d.getTime())
      ? day
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
          d,
        );
  };
  const best = busiestDay(s.cameBackByDay);
  return (
    <section className={cn(CARD, 'no-print')} aria-labelledby="dsum-daily-title">
      <h3 id="dsum-daily-title" className="mb-3 text-lg">
        {t('title')}
      </h3>
      {total === 0 || !best ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <figure dir="ltr">
          <AreaChart
            label={t('alt', { total, day: dayLabel(best.day), count: best.count })}
            labels={s.cameBackByDay.map((d) => dayLabel(d.day))}
            series={[
              {
                name: t('series'),
                color: 'var(--brand)',
                data: s.cameBackByDay.map((d) => d.count),
              },
            ]}
          />
        </figure>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------- the name lists */

function PersonRow({
  p,
  withForm,
  when,
}: {
  p: SummaryPerson;
  withForm: boolean;
  when: (iso: string | null) => string;
}) {
  const t = useTranslations('campaigns.detail.summary.people');
  const label = p.name?.trim() || p.phone || t('unknown');
  return (
    <tr className="border-t border-border/60">
      <td className="min-w-0 break-words px-3 py-2 text-start">
        {p.contactId ? (
          <Link
            href={`/contacts/${p.contactId}`}
            aria-label={t('open', { name: label })}
            className="font-medium text-brand underline underline-offset-2"
          >
            {p.name?.trim() || t('unknown')}
          </Link>
        ) : (
          <span>
            {p.name?.trim() || t('unknown')}
            <span className="block text-[11px] text-muted-foreground">{t('noContact')}</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-start font-mono text-xs tabular-nums" dir="ltr">
        {p.phone ?? '—'}
      </td>
      <td className="px-3 py-2 text-start text-xs text-muted-foreground">{when(p.at)}</td>
      {withForm && (
        <td className="break-words px-3 py-2 text-start text-xs">{p.formName ?? '—'}</td>
      )}
    </tr>
  );
}

/** One list of names as a table; the cells are plain text, so a name typed into a form can never run as markup. */
export function PeopleTable({
  rows,
  who,
  title,
  when,
}: {
  rows: SummaryPerson[];
  who: PeopleKind;
  title: string;
  when: (iso: string | null) => string;
}) {
  const t = useTranslations('campaigns.detail.summary.people');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="text-muted-foreground">
            {(['name', 'phone', 'when'] as const).map((c) => (
              <th key={c} scope="col" className="px-3 py-2 text-start text-xs font-medium">
                {t(c)}
              </th>
            ))}
            {who === 'filled_form' && (
              <th scope="col" className="px-3 py-2 text-start text-xs font-medium">
                {t('form')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <PersonRow
              key={`${p.contactId ?? p.phone ?? 'x'}-${i}`}
              p={p}
              withForm={who === 'filled_form'}
              when={when}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeopleList({
  kind,
  id,
  who,
  days,
  formIds,
  count,
}: {
  kind: SummaryKind;
  id: string;
  who: PeopleKind;
  days: number;
  formIds: string[];
  count: number | null;
}) {
  const t = useTranslations('campaigns.detail.summary.people');
  const format = useFormatter();
  const { effectiveTimezone } = useSession();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const q = useSummaryPeople({ kind, id, who, days, formIds, enabled: open });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const total = q.data?.pages[0]?.total ?? null;
  const shownCount = count ?? total;
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  const when = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(iso), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: effectiveTimezone,
        })
      : '—';
  const title = t(`${who}.title`);
  return (
    <div className="rounded-xl border border-border">
      <h4 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-start text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span>{shownCount === null ? title : t('show', { title, count: shownCount })}</span>
          <span aria-hidden="true" className={cn('transition', open && 'rotate-180')}>
            ▾
          </span>
        </button>
      </h4>
      {open && (
        <div id={panel} className="border-t border-border px-1 pb-3">
          <p className="px-3 pt-3 text-xs text-muted-foreground">{t(`${who}.hint`)}</p>
          {q.isPending ? (
            <div
              className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner /> {t('loading')}
            </div>
          ) : forbidden ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">{t('forbidden')}</p>
          ) : q.isError ? (
            <div className="px-3 py-4">
              <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('error')}</span>
                <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
                  {t('retry')}
                </Button>
              </Alert>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <>
              <PeopleTable rows={rows} who={who} title={title} when={when} />
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 text-xs text-muted-foreground">
                <span>{t('shown', { shown: rows.length, total: total ?? rows.length })}</span>
                {q.hasNextPage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={q.isFetchingNextPage}
                    onClick={() => void q.fetchNextPage()}
                  >
                    {q.isFetchingNextPage && <Spinner />}
                    {t('more')}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PeopleSection({
  kind,
  id,
  s,
  days,
  formIds,
}: {
  kind: SummaryKind;
  id: string;
  s: CampaignSummary;
  days: number;
  formIds: string[];
}) {
  const t = useTranslations('campaigns.detail.summary.people');
  const kinds = PEOPLE_KINDS.filter((k) => k !== 'filled_form' || s.filledForm);
  return (
    <section className={cn(CARD, 'no-print')} aria-labelledby="dsum-people-title">
      <h3 id="dsum-people-title" className="mb-3 text-lg">
        {t('title')}
      </h3>
      <div className="space-y-2">
        {kinds.map((k) => (
          <PeopleList
            key={k}
            kind={kind}
            id={id}
            who={k}
            days={days}
            formIds={formIds}
            count={
              k === 'came_back'
                ? s.cameBack.count
                : k === 'filled_form'
                  ? (s.filledForm?.count ?? null)
                  : null
            }
          />
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------------------- the view */

export interface SummaryViewProps {
  kind: SummaryKind;
  id: string;
  /** A short sentence the caller wants under the title, already translated (for example, which run of a series). */
  note?: ReactNode;
  state: { isPending: boolean; isError: boolean; data: CampaignSummary | undefined };
  onRetry: () => void;
  days: number;
  onDays: (days: number) => void;
  forms: SummaryFormRef[];
  /** The list of forms has answered (with forms or with an error), so the picker can show names instead of ids. */
  formsLoaded: boolean;
  formsFailed: boolean;
  formIds: string[];
  onFormIds: (ids: string[]) => void;
  /** Whether the viewer may open the lists of names and download them. */
  canSeeNames: boolean;
  canDownload: boolean;
  onPrint: () => void;
  onDownload: () => void;
  downloading: boolean;
  printedAt: Date | null;
}

/** The summary drawn from its state; the hooks live in `DirectorSummary`, so every state can be rendered in a test. */
export function SummaryView(p: SummaryViewProps) {
  const t = useTranslations('campaigns.detail.summary');
  const tHead = useTranslations('campaigns.detail.summary.headline');
  const format = useFormatter();
  const titleId = useId();
  const s = p.state.data;
  const ready = Boolean(s) && !isNotSent(s!);

  const headline = s
    ? headlineText(
        s,
        (key, values) => tHead(key as Parameters<typeof tHead>[0], values),
        (items) => format.list(items, { type: 'conjunction' }),
      )
    : '';
  const tiles = s ? buildTiles(s) : [];
  const funnel = s ? funnelRows(s) : [];
  const caveats = s ? caveatLines(s) : [];
  const sentOn = s?.sentAt
    ? format.dateTime(new Date(s.sentAt), { dateStyle: 'long' })
    : t('print.notSent');

  return (
    <section aria-labelledby={titleId} className="dsum-doc space-y-5">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-2xl leading-tight">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
          {p.note && <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>}
        </div>
        {ready && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="rounded-full" onClick={p.onPrint}>
              {t('print.button')}
            </Button>
            {p.canDownload && (
              <Button
                variant="secondary"
                className="rounded-full"
                disabled={p.downloading}
                onClick={p.onDownload}
              >
                {p.downloading && <Spinner />}
                {p.downloading ? t('download.busy') : t('download.button')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* What the printed page opens with: the campaign, when it went out and what was counted. */}
      {s && (
        <header className="dsum-print-only hidden border-b border-border pb-3">
          <p className="text-xl font-semibold">{s.name}</p>
          <p className="text-sm">
            {t('print.sent', { date: sentOn })} · {t('print.window', { days: s.window.days })}
          </p>
          {p.printedAt && (
            <p className="text-xs">
              {t('print.printed', { date: format.dateTime(p.printedAt, { dateStyle: 'long' }) })}
            </p>
          )}
        </header>
      )}

      <div className="no-print flex flex-wrap items-start gap-x-8 gap-y-4 rounded-2xl border border-border bg-muted/30 p-4">
        <WindowPicker days={p.days} onChange={p.onDays} />
        {s?.filledForm && p.formsLoaded && (
          <FormPicker
            forms={p.forms}
            failed={p.formsFailed}
            value={p.formIds}
            onChange={p.onFormIds}
          />
        )}
      </div>

      {p.state.isPending ? (
        <SummarySkeleton label={t('loading')} />
      ) : p.state.isError || !s ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-medium">{t('error.title')}</span>
          <Button size="sm" variant="secondary" onClick={p.onRetry}>
            {t('error.retry')}
          </Button>
        </Alert>
      ) : !ready ? (
        <div className={cn(CARD, 'text-center')}>
          <p className="text-lg font-semibold">{t('notSent.title')}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{t('notSent.body')}</p>
        </div>
      ) : (
        <>
          <div className={cn(CARD, 'bg-muted/30')}>
            <p className="text-2xl font-medium leading-snug sm:text-[28px]" aria-live="polite">
              {headline}
            </p>
            {isStillSending(s.status) && (
              <p className="mt-2 text-sm text-muted-foreground">{t('sending')}</p>
            )}
          </div>

          <ul
            aria-label={t('tile.listLabel')}
            className="dsum-tiles grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {tiles.map((tile) => (
              <TileCard key={tile.key} tile={tile} s={s} />
            ))}
          </ul>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className={CARD} aria-labelledby={`${titleId}-funnel`}>
              <h3 id={`${titleId}-funnel`} className="mb-3 text-lg">
                {t('funnel.title')}
              </h3>
              <div className="dsum-bar">
                <HBars
                  rows={funnel.map((f) => ({ label: t(`tile.${f.key}.label`), value: f.value }))}
                  color="var(--brand)"
                  label={t('funnel.alt')}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t('funnel.note')}</p>
            </section>
            <DailyChart s={s} />
          </div>

          {caveats.length > 0 && (
            <aside className="rounded-2xl border border-border bg-muted/30 px-5 py-4">
              <h3 className="text-sm font-semibold">{t('caveats.title')}</h3>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                {caveats.map((c) => (
                  <li key={c.code}>{t(`caveats.${c.key}`, c.values)}</li>
                ))}
              </ul>
            </aside>
          )}

          {p.canSeeNames && (
            <PeopleSection kind={p.kind} id={p.id} s={s} days={p.days} formIds={p.formIds} />
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------------- the screen */

/**
 * The director summary of a sent campaign or broadcast, in plain words: one sentence, five tiles, one funnel, one line of replies per
 * day, and the names behind the numbers. Shared by the campaign page (Summary tab), the broadcast run screen and the legacy broadcast
 * detail (top of its Overview tab); `kind` picks the endpoint family.
 */
export function DirectorSummary({
  kind,
  id,
  note,
}: {
  kind: SummaryKind;
  id: string;
  note?: ReactNode;
}) {
  const t = useTranslations('campaigns.detail.summary');
  const format = useFormatter();
  const { toast } = useToast();
  const [days, setDays] = useSummaryWindow();
  const { formIds, setFormIds, ready } = useRememberedForms();
  const canSeeNames = useCan(kind === 'campaign' ? 'camp.campaigns.read' : 'bcast.broadcasts.read');
  const canDownload =
    useCan(kind === 'campaign' ? 'camp.campaigns.export' : 'bcast.broadcasts.export') &&
    canSeeNames;
  const [downloading, setDownloading] = useState(false);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  const q = useDirectorSummary({ kind, id, days, formIds, enabled: ready });
  const s = q.data;
  const forms = useSummaryForms(Boolean(s?.filledForm));

  // A remembered form that was deleted since is dropped, so the choice never counts a form that is gone.
  useEffect(() => {
    if (!forms.data) return;
    const known = new Set(forms.data.map((f) => f.id));
    if (formIds.some((f) => !known.has(f))) setFormIds(formIds.filter((f) => known.has(f)));
  }, [forms.data, formIds, setFormIds]);

  useEffect(() => {
    const stamp = () => setPrintedAt(new Date());
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);

  const download = async () => {
    if (!s) return;
    setDownloading(true);
    try {
      const wanted: PeopleKind[] = PEOPLE_KINDS.filter((k) => k !== 'filled_form' || s.filledForm);
      const lists = await Promise.all(
        wanted.map(async (who) => ({
          kind: who,
          ...(await fetchAllPeople({ kind, id, who, days, formIds })),
        })),
      );
      if (lists.every((l) => l.rows.length === 0)) {
        toast(t('download.none'), 'info');
        return;
      }
      const csv = peopleCsv(lists, {
        headers: {
          group: t('download.csv.group'),
          name: t('download.csv.name'),
          phone: t('download.csv.phone'),
          when: t('download.csv.when'),
          form: t('download.csv.form'),
        },
        group: {
          came_back: t('people.came_back.title'),
          filled_form: t('people.filled_form.title'),
          not_reached: t('people.not_reached.title'),
        },
      });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFileName(s.name);
      a.click();
      URL.revokeObjectURL(url);
      const cut = lists.find((l) => l.truncated);
      toast(
        cut
          ? t('download.truncated', { count: format.number(cut.rows.length) })
          : t('download.done'),
        cut ? 'info' : 'success',
      );
    } catch {
      toast(t('download.failed'), 'danger');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SummaryView
      kind={kind}
      id={id}
      note={note}
      state={{ isPending: q.isPending || !ready, isError: q.isError, data: s }}
      onRetry={() => void q.refetch()}
      days={days}
      onDays={setDays}
      forms={forms.data ?? []}
      formsLoaded={forms.isSuccess || forms.isError}
      formsFailed={forms.isError}
      formIds={formIds}
      onFormIds={setFormIds}
      canSeeNames={canSeeNames}
      canDownload={canDownload}
      onPrint={() => {
        setPrintedAt(new Date());
        window.print();
      }}
      onDownload={() => void download()}
      downloading={downloading}
      printedAt={printedAt}
    />
  );
}
