'use client';

import { useId, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  PREVIOUS_SENDS_MAX,
  PREVIOUS_SEND_OUTCOMES,
  type PreviousSendOption,
  type PreviousSendOutcome,
  type PreviousSendsAudience,
} from '@crm/contracts';
import { Input, Select, cn } from '@crm/ui';
import {
  outcomeBlocked,
  outcomeCount,
  previousOrEmpty,
  sendKey,
  tickRefusal,
  toggleSend,
  withOutcome,
} from '../lib/previous-sends';

const SEARCH_FROM = 6;

/**
 * "Previous sends": pick earlier broadcasts and campaigns (a run of a recurring broadcast is one of them) and an outcome, to message
 * the people they went to, or only those who read it, did not read it, replied, clicked or whose message failed. Up to 20 sends. A
 * broadcast records delivery and reading only, so the outcomes about replies and clicks are off while one is ticked, and a broadcast
 * is off while such an outcome is chosen. Shared by the guided wizard and the classic builder.
 */
export function PreviousSendsPicker({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: readonly PreviousSendOption[];
  value: PreviousSendsAudience | null | undefined;
  onChange: (next: PreviousSendsAudience) => void;
  disabled?: boolean | undefined;
  /** The layout of the whole picker (the wizard's panel fills the height; the builder's section caps it). */
  className?: string;
}) {
  const t = useTranslations('campaigns.previousSends');
  const format = useFormatter();
  const uid = useId();
  const [q, setQ] = useState('');
  const v = previousOrEmpty(value);
  const ticked = new Set(v.sends.map(sendKey));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  const atLimit = v.sends.length >= PREVIOUS_SENDS_MAX;
  const tickedBroadcast = v.sends.some((s) => s.kind === 'broadcast');

  if (options.length === 0) {
    return (
      <p
        data-testid="previous-empty"
        className={cn(
          'rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        {t('empty')}
      </p>
    );
  }

  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-col gap-3', className)}
      data-testid="previous-picker"
    >
      <div className="grid gap-1.5 sm:max-w-sm">
        <label htmlFor={`${uid}-outcome`} className="text-sm font-medium">
          {t('outcomeLabel')}
        </label>
        <Select
          id={`${uid}-outcome`}
          value={v.outcome}
          disabled={disabled}
          onChange={(e) => onChange(withOutcome(v, e.target.value as PreviousSendOutcome))}
        >
          {PREVIOUS_SEND_OUTCOMES.map((o) => {
            const off = outcomeBlocked(v.sends, o);
            return (
              <option key={o} value={o} disabled={off}>
                {off ? t('outcomeOff', { name: t(`outcomes.${o}`) }) : t(`outcomes.${o}`)}
              </option>
            );
          })}
        </Select>
        <p className="text-xs text-muted-foreground" data-testid="previous-outcome-hint">
          {t(`outcomeHint.${v.outcome}`)}
        </p>
        {tickedBroadcast && (
          <p className="text-xs text-warning" data-testid="previous-broadcast-note">
            {t('broadcastNote')}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {options.length >= SEARCH_FROM && (
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full max-w-xs"
          />
        )}
        <span
          className={cn(
            'ms-auto inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            atLimit
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-border bg-muted text-muted-foreground',
          )}
          aria-live="polite"
          data-testid="previous-chosen"
        >
          {t('chosen', { count: v.sends.length, max: PREVIOUS_SENDS_MAX })}
        </span>
      </div>
      {atLimit && (
        <p role="status" className="text-xs text-warning" data-testid="previous-limit">
          {t('limit', { max: PREVIOUS_SENDS_MAX })}
        </p>
      )}

      <fieldset className="min-h-0 flex-1 overflow-y-auto">
        <legend className="sr-only">{t('listLabel')}</legend>
        {shown.length === 0 && (
          <p className="p-3 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {shown.map((o) => {
            const key = sendKey(o);
            const on = ticked.has(key);
            const refusal = tickRefusal(v, o);
            const off = !on && refusal !== null;
            const count = outcomeCount(o, v.outcome);
            return (
              <li key={key}>
                <label
                  className={cn(
                    'relative block',
                    disabled || off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  )}
                >
                  <input
                    type="checkbox"
                    name={`${uid}-sends`}
                    checked={on}
                    disabled={disabled || off}
                    onChange={() => onChange(toggleSend(v, o))}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'block rounded-lg border border-border bg-background p-3 text-sm transition hover:bg-muted/60',
                      'peer-checked:border-brand peer-checked:bg-brand/5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                          o.kind === 'campaign'
                            ? 'border-brand/30 bg-brand/10 text-brand'
                            : 'border-border bg-muted text-muted-foreground',
                        )}
                      >
                        {t(`kind.${o.kind}`)}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {o.at
                          ? t('wentOut', {
                              date: format.dateTime(new Date(o.at), { dateStyle: 'medium' }),
                            })
                          : t('wentOutUnknown')}
                      </span>
                      <span>{t('recipients', { count: o.recipients })}</span>
                    </span>
                    <span className="mt-1 block text-xs font-medium" data-testid="previous-count">
                      {count === null
                        ? t('notRecorded')
                        : t(`outcomeCounts.${v.outcome}`, { count })}
                    </span>
                    {off && (
                      <span className="mt-1 block text-xs text-warning">
                        {refusal === 'limit'
                          ? t('limit', { max: PREVIOUS_SENDS_MAX })
                          : t('broadcastOff')}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
