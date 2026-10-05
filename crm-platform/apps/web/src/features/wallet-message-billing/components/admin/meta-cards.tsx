'use client';

import { useState, type ChangeEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImportMetaCardResult,
  MetaCardFreshness,
  MetaCardSummary,
  MetaCardsResponse,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Modal, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import {
  CARD_COLUMNS,
  MAX_CARD_BYTES,
  fileToBase64,
  formatCardCost,
  isCardFileName,
} from '../../lib/meta-cards';
import { ErrorState, LoadingBlock } from '../state';

/** Where Meta publishes the files, for the operator who needs to download the new quarter's cards. */
const META_PRICING_URL = 'https://developers.facebook.com/docs/whatsapp/pricing';

/**
 * Meta's rate cards, one per billing currency: which are stored, how old, the quarterly reminder to renew them, the card market by
 * market, and the import of the file Meta publishes. A workspace billed in INR is priced against Meta's INR card, not the USD one.
 */
export function MetaCardsSection({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards');
  const [importing, setImporting] = useState(false);
  const cards = useQuery({
    queryKey: KEYS.metaCards,
    queryFn: ({ signal }) => operatorApi.metaCards(signal),
    refetchOnWindowFocus: false,
  });

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
            {t('import.button')}
          </Button>
        )}
      </div>
      {cards.isPending ? (
        <LoadingBlock />
      ) : cards.isError ? (
        <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
      ) : (
        <CardsBody data={cards.data} />
      )}
      {importing && <ImportCardDialog onClose={() => setImporting(false)} />}
    </Card>
  );
}

export function ReminderBanner({ data }: { data: MetaCardsResponse }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards.reminder');
  const locale = useLocale();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const { reminder, missing } = data;
  const link = (
    <a href={META_PRICING_URL} target="_blank" rel="noreferrer" className="font-medium underline">
      {t('link')}
    </a>
  );
  if (missing.length > 0) {
    return (
      <Alert tone="warning">
        <p className="font-medium">{t('missingTitle', { currencies: missing.join(', ') })}</p>
        <p>
          {t('missingBody')} {link}
        </p>
      </Alert>
    );
  }
  if (reminder.state === 'due') {
    return (
      <Alert tone="warning">
        <p className="font-medium">{t('dueTitle', { date: date(reminder.quarterStart) })}</p>
        <p>
          {t('dueBody')} {link}
        </p>
      </Alert>
    );
  }
  if (reminder.state === 'upcoming') {
    return (
      <Alert tone="info">
        <p className="font-medium">
          {t('upcomingTitle', {
            date: date(reminder.nextQuarterStart),
            days: reminder.daysUntilNext,
          })}
        </p>
        <p>
          {t('upcomingBody')} {link}
        </p>
      </Alert>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {t('current', { date: date(reminder.nextQuarterStart) })}
    </p>
  );
}

function FreshnessBadge({ freshness }: { freshness: MetaCardFreshness }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards.freshness');
  const tone =
    freshness.state === 'due' ? 'warning' : freshness.state === 'upcoming' ? 'neutral' : 'success';
  return <Badge tone={tone}>{t(freshness.state)}</Badge>;
}

function CardsBody({ data }: { data: MetaCardsResponse }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards');
  const locale = useLocale();
  const [viewing, setViewing] = useState<string | null>(data.cards[0]?.currency ?? null);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  return (
    <div className="space-y-4">
      <ReminderBanner data={data} />
      {data.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {(
                  ['currency', 'effective', 'checked', 'markets', 'usedFor', 'status'] as const
                ).map((c) => (
                  <th key={c} scope="col" className="px-2 py-2 text-start font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">{t('columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c: MetaCardSummary) => (
                <tr key={c.currency} className="border-b border-border last:border-0">
                  <th scope="row" className="px-2 py-2 text-start font-semibold">
                    {c.currency}
                  </th>
                  <td className="px-2 py-2">{day(c.effectiveOn)}</td>
                  <td className="px-2 py-2">{day(c.checkedOn)}</td>
                  <td className="px-2 py-2 tabular-nums">{c.markets}</td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {c.isPlatformCurrency
                      ? t('usedPricing')
                      : t('usedWorkspaces', { currency: c.currency })}
                  </td>
                  <td className="px-2 py-2">
                    <FreshnessBadge freshness={c.freshness} />
                  </td>
                  <td className="px-2 py-2 text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={viewing === c.currency}
                      onClick={() => setViewing(viewing === c.currency ? null : c.currency)}
                    >
                      {viewing === c.currency ? t('hide') : t('view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewing && <CardTable currency={viewing} />}
    </div>
  );
}

/** One currency's card, market by market, in that currency. */
function CardTable({ currency }: { currency: string }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards.table');
  const locale = useLocale();
  const detail = useQuery({
    queryKey: KEYS.metaCard(currency),
    queryFn: ({ signal }) => operatorApi.metaCard(currency, signal),
    refetchOnWindowFocus: false,
  });
  if (detail.isPending) return <LoadingBlock />;
  if (detail.isError)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('heading', { currency })}</p>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[46rem] text-sm" aria-label={t('heading', { currency })}>
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t('market')}
              </th>
              {CARD_COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-2 py-2 text-end font-medium">
                  {t(`categories.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.data.markets.map((m) => (
              <tr key={m.market} className="border-b border-border last:border-0">
                <th scope="row" className="px-2 py-1.5 text-start font-medium">
                  <span>{m.market}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {m.countries.length === 0
                      ? t('everyOther')
                      : m.countries.length === 1
                        ? m.countries[0]
                        : m.countries.join(', ')}
                  </span>
                </th>
                {CARD_COLUMNS.map((c) => (
                  <td key={c} className="px-2 py-1.5 text-end tabular-nums">
                    {formatCardCost(m.costs[c] ?? null, currency, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportCardDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.metaCards.import');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<{ b64: string; name: string } | null>(null);
  const [fileProblem, setFileProblem] = useState<'wrongType' | 'tooBig' | 'unreadable' | null>(
    null,
  );
  const [preview, setPreview] = useState<ImportMetaCardResult | null>(null);
  const [failed, setFailed] = useState<{ kind: string; reason: string | null } | null>(null);

  const run = useMutation({
    mutationFn: ({ b64, name, dryRun }: { b64: string; name: string; dryRun: boolean }) =>
      operatorApi.importMetaCard(b64, name, dryRun),
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        return;
      }
      void qc.invalidateQueries({ queryKey: KEYS.metaCards });
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      toast.success(t('done', { currency: r.currency }));
      onClose();
    },
    onError: (err) => {
      setPreview(null);
      setFailed({
        kind: te(errorKind(err)),
        // The server says exactly what is wrong with the file (no date, mixed currencies); show it under the general message.
        reason: err instanceof ApiError && errorKind(err) === 'importFailed' ? err.message : null,
      });
    },
  });

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPicked(null);
    setPreview(null);
    setFailed(null);
    setFileProblem(null);
    if (!file) return;
    if (!isCardFileName(file.name)) return setFileProblem('wrongType');
    if (file.size > MAX_CARD_BYTES) return setFileProblem('tooBig');
    try {
      const b64 = await fileToBase64(file);
      setPicked({ b64, name: file.name });
      run.mutate({ b64, name: file.name, dryRun: true });
    } catch {
      setFileProblem('unreadable');
    }
  };

  const money = (v: string | null) =>
    v === null || !preview ? '—' : formatCardCost(v, preview.currency, locale);

  return (
    <Modal
      open
      size="md"
      onClose={() => !run.isPending && onClose()}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => picked && run.mutate({ ...picked, dryRun: false })}
            disabled={!picked || !preview || run.isPending}
          >
            {run.isPending && preview && <Spinner label={t('applying')} />}
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('intro')}</p>
        <div className="space-y-1.5">
          <label htmlFor="meta-card-file" className="block font-medium">
            {t('file')}
          </label>
          <input
            id="meta-card-file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => void pick(e)}
            className="block w-full text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <div aria-live="polite" className="space-y-3">
          {fileProblem && <Alert tone="danger">{t(`fileProblems.${fileProblem}`)}</Alert>}
          {failed && (
            <Alert tone="danger">
              <p>{failed.kind}</p>
              {failed.reason && <p className="mt-1 text-xs">{failed.reason}</p>}
            </Alert>
          )}
          {run.isPending && !preview && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner label={t('reading')} />
              {t('reading')}
            </p>
          )}
          {preview && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {(
                  [
                    ['currency', preview.currency],
                    ['effective', preview.effectiveOn],
                    ['added', preview.added],
                    ['changed', preview.changed],
                    ['unchanged', preview.unchanged],
                    ['removed', preview.removed],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{t(`summary.${k}`)}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {preview.replaces && (
                <p className="text-xs text-muted-foreground">
                  {t('replaces', { date: preview.replaces })}
                </p>
              )}
              <Alert tone={preview.appliedToPricing ? 'warning' : 'info'}>
                {preview.appliedToPricing
                  ? t('appliesToPricing', {
                      currency: preview.currency,
                      added: preview.pricing?.added ?? 0,
                      updated: preview.pricing?.updated ?? 0,
                    })
                  : t('storedOnly', { currency: preview.currency })}
              </Alert>
              {preview.biggestChanges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">{t('biggest')}</p>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-2 text-xs">
                    {preview.biggestChanges.map((c) => (
                      <li key={`${c.market}-${c.category}`}>
                        <span className="font-medium">{c.market}</span> ·{' '}
                        {t(`categories.${c.category}`)}: {money(c.before)} → {money(c.after)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.problems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">{t('problems')}</p>
                  <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto rounded-md border border-border p-2 ps-6 text-xs">
                    {preview.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
