'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, EmptyState, ToastProvider } from '@crm/ui';
import type { FlowRunStatus, FlowSubscriberStatus } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  durationParts,
  errorKey,
  humanize,
  reasonKind,
  runTone,
  subscriberTone,
} from '../lib/model';

/** Toast host for the flow runtime screens (one region, translated dismiss label). */
export function FlrProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('flr.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}

export function RunStatusChip({ status }: { status: FlowRunStatus }) {
  const t = useTranslations('flr.status');
  return <Badge tone={runTone(status)}>{t(status)}</Badge>;
}

export function SubscriberStatusChip({ status }: { status: FlowSubscriberStatus }) {
  const t = useTranslations('flr.subscriberStatus');
  return <Badge tone={subscriberTone(status)}>{t(status)}</Badge>;
}

/** The permission-denied state every screen shows when `flr.runs.read` is missing. */
export function Denied() {
  const t = useTranslations('flr.common');
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <EmptyState title={t('deniedTitle')} message={t('deniedBody')} />
    </main>
  );
}

/** Text for an error: a known problem code gets a translated sentence, anything else the server's own message. */
export function useErrorText() {
  const t = useTranslations('flr');
  return (e: unknown, fallback?: string): string => {
    if (e instanceof ApiError) {
      const key = errorKey(e.code);
      if (key) return t(`errors.${key}`);
      if (e.message) return e.message;
    }
    return fallback ?? t('common.actionFailed');
  };
}

/** `90 s`, `1 h 5 m`, `2 d 4 h`; the dash when the value is unknown. */
export function useDuration() {
  const t = useTranslations('flr');
  return (seconds: number | null): string => {
    const parts = durationParts(seconds);
    return parts ? parts.map(([u, n]) => t(`duration.${u}`, { n })).join(' ') : t('common.noValue');
  };
}

export function useDateTime() {
  const t = useTranslations('flr.common');
  const timeZone = useTimeZone();
  return (iso: string | null): string => {
    if (!iso) return t('noValue');
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? t('noValue')
      : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  };
}

/** A source such as `any_message`, translated, with the raw value humanised when the key is not known. */
export function useSourceLabel() {
  const t = useTranslations('flr.source');
  return (source: string): string => (t.has(source) ? t(source) : humanize(source));
}

/** A run's or subscriber's reason text: a translated lead for the known shapes, the engine's words otherwise. */
export function useReasonText() {
  const t = useTranslations('flr.reason');
  return (reason: string | null): string => {
    const kind = reasonKind(reason);
    if (kind === 'unknown') return t('unknown');
    if (kind === 'paused') return t('paused');
    if (kind === 'loop') return t('loop', { text: reason ?? '' });
    return reason ?? '';
  };
}

export const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
export const TH =
  'px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em]';
export const CARD = 'rounded-2xl border border-border bg-background shadow-sm';
