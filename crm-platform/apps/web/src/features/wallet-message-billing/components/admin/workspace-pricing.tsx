'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WALLET_CATEGORIES,
  WALLET_LIMITS,
  bpsToPercent,
  type MarginsResponse,
  type PricePreview,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Select, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import {
  EMPTY_MARGIN_DRAFT,
  addMarginRow,
  afterMarginSave,
  canSaveOverrides,
  editMarginField,
  reasonProblem,
  removeNewMarginRow,
  stageRemoval,
  undoRemoval,
  type MarginCategory,
  type MarginDraft,
} from '../../lib/margin-grid';
import { currencySymbol, formatMinor } from '../../lib/money';
import { ErrorState, LoadingBlock } from '../state';
import { CountrySelect } from './country-select';
import { MarginGrid, useMarginRows } from './margin-grid';
import { PricingModeNote } from './pricing-mode-note';

/**
 * "Pricing for this workspace": its plan, the margin overrides that beat the plan's, a mandatory reason for any change, and a
 * price preview that shows which layer set the price. Only super admins can write.
 */
export function WorkspacePricing({
  workspaceId,
  canWrite,
}: {
  workspaceId: string;
  canWrite: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.detail.pricing');
  const margins = useQuery({
    queryKey: KEYS.workspaceMargins(workspaceId),
    queryFn: ({ signal }) => operatorApi.workspaceMargins(workspaceId, signal),
    refetchOnWindowFocus: false,
  });
  const rates = useQuery({
    queryKey: KEYS.rates,
    queryFn: ({ signal }) => operatorApi.rates(signal),
    refetchOnWindowFocus: false,
  });
  const plan = useQuery({
    queryKey: KEYS.workspacePlan(workspaceId),
    queryFn: ({ signal }) =>
      operatorApi.preview({ workspaceId, country: '', category: '' }, signal),
    refetchOnWindowFocus: false,
  });
  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {margins.isPending ? (
        <LoadingBlock />
      ) : margins.isError ? (
        <ErrorState error={margins.error} onRetry={() => void margins.refetch()} />
      ) : (
        <>
          <PricingModeNote mode={margins.data.pricingMode} />
          <PlanLine
            planSlug={plan.data?.planSlug ?? null}
            known={plan.isSuccess}
            pending={plan.isPending}
            plans={margins.data.plans}
          />
          <Overrides
            workspaceId={workspaceId}
            data={margins.data}
            rates={rates.data}
            canWrite={canWrite}
          />
          <PreviewTool workspaceId={workspaceId} data={margins.data} />
        </>
      )}
    </Card>
  );
}

function PlanLine({
  planSlug,
  known,
  pending,
  plans,
}: {
  planSlug: string | null;
  known: boolean;
  pending: boolean;
  plans: MarginsResponse['plans'];
}) {
  const t = useTranslations('wallet-message-billing.admin.detail.pricing');
  const name = planSlug ? (plans.find((p) => p.slug === planSlug)?.name ?? planSlug) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('plan')}</span>
      {pending ? (
        <Spinner label={t('planLoading')} />
      ) : !known ? (
        <span className="text-muted-foreground">{t('planUnknown')}</span>
      ) : name ? (
        <Badge>{name}</Badge>
      ) : (
        <span>{t('noPlan')}</span>
      )}
    </div>
  );
}

function Overrides({
  workspaceId,
  data,
  rates,
  canWrite,
}: {
  workspaceId: string;
  data: MarginsResponse;
  rates: Parameters<typeof useMarginRows>[1];
  canWrite: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.detail.pricing');
  const tg = useTranslations('wallet-message-billing.admin.margins.grid');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<MarginDraft>(EMPTY_MARGIN_DRAFT);
  const [note, setNote] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const rows = useMarginRows(data, rates, draft);
  const { ok, plan } = canSaveOverrides(rows, note);
  const changed = rows.some((r) => r.dirty || r.removed);
  const reason = reasonProblem(note);
  const reasonShown = changed && (showProblems || note.trim() !== '') && reason !== null;

  const save = useMutation({
    mutationFn: () =>
      operatorApi.saveWorkspaceMargins(workspaceId, {
        rows: plan.rows,
        removeIds: plan.removeIds,
        note: note.trim(),
      }),
    onSuccess: (result) => {
      setDraft((d) => afterMarginSave(d, plan, result));
      setShowProblems(false);
      if (result.skipped.length === 0) setNote('');
      void qc.invalidateQueries({ queryKey: KEYS.workspaceMargins(workspaceId) });
      void qc.invalidateQueries({ queryKey: ['wallet', 'platform', 'preview'] });
      if (result.skipped.length > 0)
        toast.error(t('savedSome', { saved: result.saved, skipped: result.skipped.length }));
      else toast.success(t('saved', { saved: result.saved, removed: result.removed }));
    },
    onError: (err) => toast.error(te(errorKind(err))),
  });

  const onSave = () => {
    setShowProblems(true);
    if (ok) save.mutate();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t('overrides')}</h3>
      <p className="text-sm text-muted-foreground">{t('overridesHint')}</p>
      {rows.length === 0 ? (
        <Alert tone="info">{t('empty')}</Alert>
      ) : (
        <MarginGrid
          rows={rows}
          countries={data.countries}
          currency={data.currency}
          canEdit={canWrite}
          audit
          showProblems={showProblems}
          skipped={draft.skipped}
          labelKey={t('overrides')}
          onChange={(key, field, value) => setDraft((d) => editMarginField(d, key, field, value))}
          onRemove={(r) =>
            setDraft((d) => (r.existing ? stageRemoval(d, r.key) : removeNewMarginRow(d, r.key)))
          }
          onUndo={(r) => setDraft((d) => undoRemoval(d, r.key))}
        />
      )}
      {plan.tooMany && <Alert tone="danger">{tg('tooMany')}</Alert>}
      {canWrite ? (
        <div className="space-y-3">
          <Button variant="secondary" onClick={() => setDraft((d) => addMarginRow(d))}>
            {tg('addRow')}
          </Button>
          <Field
            label={t('reason.label')}
            htmlFor="override-reason"
            hint={t('reason.hint')}
            error={reasonShown ? t(`reason.problems.${reason}`) : undefined}
          >
            <Textarea
              id="override-reason"
              rows={3}
              maxLength={WALLET_LIMITS.noteMax + 100}
              value={note}
              invalid={reasonShown}
              aria-describedby="override-reason-count"
              onChange={(e) => setNote(e.target.value)}
            />
            <p
              id="override-reason-count"
              className="text-end text-xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {t('reason.counter', { count: note.trim().length, max: WALLET_LIMITS.noteMax })}
            </p>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} disabled={!changed || !ok || save.isPending}>
              {save.isPending && <Spinner label={t('saving')} />}
              {t('save')}
            </Button>
            {changed && !ok && (
              <span className="text-xs text-muted-foreground">{t('saveHint')}</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewTool({ workspaceId, data }: { workspaceId: string; data: MarginsResponse }) {
  const t = useTranslations('wallet-message-billing.admin.detail.pricing.preview');
  const tc = useTranslations('wallet-message-billing.categories');
  const tg = useTranslations('wallet-message-billing.admin.margins.grid');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState<MarginCategory>('');
  const [asked, setAsked] = useState<{ country: string; category: MarginCategory } | null>(null);
  const q = useQuery({
    queryKey: KEYS.preview({
      workspaceId,
      country: asked?.country ?? '',
      category: asked?.category ?? '',
    }),
    queryFn: ({ signal }) =>
      operatorApi.preview(
        { workspaceId, country: asked?.country ?? '', category: asked?.category ?? '' },
        signal,
      ),
    enabled: asked !== null,
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked({ country, category });
        }}
      >
        <Field label={t('country')} className="w-56">
          <CountrySelect
            value={country}
            onChange={setCountry}
            countries={data.countries}
            label={t('country')}
            searchLabel={tg('searchCountry')}
            anyLabel={tg('anyCountry')}
          />
        </Field>
        <Field label={t('category')} htmlFor="preview-category" className="w-48">
          <Select
            id="preview-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as MarginCategory)}
          >
            <option value="">{tg('anyCategory')}</option>
            {WALLET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={q.isFetching}>
          {q.isFetching && <Spinner label={t('running')} />}
          {t('run')}
        </Button>
      </form>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <PreviewResult preview={q.data} />
      ) : null}
    </div>
  );
}

/** One message priced: Meta's cost, the margin and the layer that set it, the price, and whether a margin or a typed price made it. */
export function PreviewResult({ preview }: { preview: PricePreview }) {
  const t = useTranslations('wallet-message-billing.admin.detail.pricing.preview.result');
  const locale = useLocale();
  const symbol = currencySymbol(preview.currency, locale);
  const cells: Array<[string, React.ReactNode]> = [
    [t('metaCost'), preview.metaCost === null ? t('unknownCost') : `${symbol}${preview.metaCost}`],
    [
      t('margin'),
      preview.marginBps === null ? t('noMargin') : `${bpsToPercent(preview.marginBps)}%`,
    ],
    [
      t('layer'),
      preview.marginSource === null ? t('noLayer') : t(`layers.${preview.marginSource}`),
    ],
    [t('price'), formatMinor(preview.priceMinor, preview.currency, locale)],
    [t('basis'), t(`bases.${preview.basis}`)],
  ];
  return (
    <dl
      className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2 lg:grid-cols-5"
      aria-label={t('label')}
    >
      {cells.map(([label, value]) => (
        <div key={label} className="space-y-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
