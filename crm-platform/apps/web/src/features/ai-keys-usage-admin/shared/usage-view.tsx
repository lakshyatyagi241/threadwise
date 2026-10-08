'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AI_USAGE_MAX_CUSTOM_DAYS, AI_USAGE_WINDOWS, type AiUsageWindow } from '@crm/contracts';
import { cn } from '@crm/ui';
import { barPercent, compactNumber, maxOf, shortDay } from '../lib/format';

const NS = 'ai-keys-usage-admin';

/** The usage screens' range: a preset window, or `custom` with inclusive UTC days. */
export interface UsageRangeValue {
  window: AiUsageWindow | 'custom';
  from: string;
  to: string;
}

export const DEFAULT_USAGE_RANGE: UsageRangeValue = { window: '30d', from: '', to: '' };

/** Whether the range can be asked for: a preset, or custom days both filled in, in order and within the ceiling. */
export function usageRangeReady(r: UsageRangeValue): boolean {
  if (r.window !== 'custom') return true;
  if (!r.from || !r.to || r.from > r.to) return false;
  return (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1 <= AI_USAGE_MAX_CUSTOM_DAYS;
}

/** The query the API takes: a preset, or the custom days. */
export function usageRangeQuery(r: UsageRangeValue): Record<string, string> {
  return r.window === 'custom' ? { from: r.from, to: r.to } : { window: r.window };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** The 7 days / 30 days / 90 days / 1 year / custom switch of both usage screens, with the two date pickers. */
export function WindowSwitch({
  value,
  onChange,
}: {
  value: UsageRangeValue;
  onChange: (r: UsageRangeValue) => void;
}) {
  const t = useTranslations(`${NS}.windows`);
  const pill = (active: boolean) =>
    cn(
      'h-8 rounded px-3 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-primary',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
    );
  const custom = value.window === 'custom';
  const invalid = custom && value.from !== '' && value.to !== '' && value.from > value.to;
  const days =
    custom && value.from && value.to && !invalid
      ? (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 + 1
      : 0;
  const tooLong = days > AI_USAGE_MAX_CUSTOM_DAYS;
  const dateInput = 'h-8 rounded-md border border-border bg-background px-2 text-sm';
  return (
    <div className="flex flex-col items-end gap-2">
      <div
        role="group"
        aria-label={t('label')}
        className="inline-flex rounded-md border border-border p-0.5"
      >
        {AI_USAGE_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={w === value.window}
            onClick={() => onChange({ ...value, window: w })}
            className={pill(w === value.window)}
          >
            {t(w)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() =>
            onChange(
              custom ? value : { window: 'custom', from: value.from, to: value.to || todayUtc() },
            )
          }
          className={pill(custom)}
        >
          {t('custom')}
        </button>
      </div>
      {custom && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            {t('from')}
            <input
              type="date"
              className={dateInput}
              value={value.from}
              max={value.to || todayUtc()}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            {t('to')}
            <input
              type="date"
              className={dateInput}
              value={value.to}
              min={value.from || undefined}
              max={todayUtc()}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </label>
          {(invalid || tooLong || !value.from || !value.to) && (
            <p role="status" className="basis-full text-end text-xs text-muted-foreground">
              {invalid
                ? t('invalid')
                : tooLong
                  ? t('tooLong', { days: AI_USAGE_MAX_CUSTOM_DAYS })
                  : t('pick')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tokens per day as bars. Every day of the window is a column, so a quiet day shows as a gap. Long windows are thin
 * on purpose: the exact numbers are on each bar's tooltip and in the table that follows for screen readers.
 */
export function DailyBars({
  data,
  caption,
}: {
  data: Array<{ date: string; tokens: number }>;
  caption: string;
}) {
  const locale = useLocale();
  const max = maxOf(data.map((d) => d.tokens));
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">{caption}</figcaption>
      <div className="flex h-36 items-end gap-px" aria-hidden="true">
        {data.map((d) => (
          <div
            key={d.date}
            title={`${shortDay(d.date, locale)}: ${new Intl.NumberFormat(locale).format(d.tokens)}`}
            className="flex h-full min-w-px flex-1 items-end"
          >
            <div
              className="w-full rounded-t-sm bg-primary/80"
              style={{ height: `${barPercent(d.tokens, max)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{data[0] ? shortDay(data[0].date, locale) : ''}</span>
        <span>{data.at(-1) ? shortDay(data.at(-1)!.date, locale) : ''}</span>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{d.tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** One labelled horizontal bar per row, longest first as given. */
export function ShareBars({
  rows,
  caption,
  empty,
}: {
  rows: Array<{ key: string; label: string; value: number; note?: string }>;
  caption: string;
  empty: string;
}) {
  const locale = useLocale();
  const max = maxOf(rows.map((r) => r.value));
  return (
    <section className="space-y-2" aria-label={caption}>
      <h3 className="text-sm font-medium">{caption}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {compactNumber(r.value, locale)}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${barPercent(r.value, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Platform key versus workspace key as one stacked bar with both figures. */
export function SourceSplit({
  caption,
  platformLabel,
  ownLabel,
  platform,
  own,
}: {
  caption: string;
  platformLabel: string;
  ownLabel: string;
  platform: number;
  own: number;
}) {
  const locale = useLocale();
  const total = platform + own;
  const platformPct = total === 0 ? 0 : Math.round((platform / total) * 100);
  return (
    <section className="space-y-2" aria-label={caption}>
      <h3 className="text-sm font-medium">{caption}</h3>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-3 bg-primary" style={{ width: `${platformPct}%` }} />
        <div
          className="h-3 bg-warning"
          style={{ width: `${total === 0 ? 0 : 100 - platformPct}%` }}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block size-2 rounded-full bg-primary" aria-hidden="true" />
            {platformLabel}
          </dt>
          <dd className="font-mono font-medium">
            {new Intl.NumberFormat(locale).format(platform)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block size-2 rounded-full bg-warning" aria-hidden="true" />
            {ownLabel}
          </dt>
          <dd className="font-mono font-medium">{new Intl.NumberFormat(locale).format(own)}</dd>
        </div>
      </dl>
    </section>
  );
}
