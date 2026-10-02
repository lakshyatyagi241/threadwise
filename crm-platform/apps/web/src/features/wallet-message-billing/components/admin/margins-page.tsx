'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarginsResponse, RatesResponse } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Field, Select, Spinner } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import {
  EMPTY_MARGIN_DRAFT,
  addMarginRow,
  afterMarginSave,
  editMarginField,
  forgetRow,
  planMarginSave,
  removeNewMarginRow,
  type MarginDraft,
  type MarginGridRow,
  type MarginSavePlan,
} from '../../lib/margin-grid';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb, ReadOnlyBanner, useCanWrite } from './admin-parts';
import { MarginGrid, countryLabel, useMarginRows } from './margin-grid';
import { PricingModeNote } from './pricing-mode-note';

/** "Margins": what customers pay over Meta's cost, set once for the platform, per plan. */
export function MarginsPage() {
  const t = useTranslations('wallet-message-billing.admin.margins');
  const tb = useTranslations('wallet-message-billing.admin');
  const canEdit = useCanWrite();
  const [plan, setPlan] = useState('');
  const margins = useQuery({
    queryKey: KEYS.margins(plan),
    queryFn: ({ signal }) => operatorApi.margins(plan, signal),
    refetchOnWindowFocus: false,
  });
  const rates = useQuery({
    queryKey: KEYS.rates,
    queryFn: ({ signal }) => operatorApi.rates(signal),
    refetchOnWindowFocus: false,
  });
  // Edits are kept per scope, so switching the plan and back loses nothing.
  const [drafts, setDrafts] = useState<Record<string, MarginDraft>>({});
  const draft = drafts[plan] ?? EMPTY_MARGIN_DRAFT;
  const setDraft = (fn: (d: MarginDraft) => MarginDraft) =>
    setDrafts((all) => ({ ...all, [plan]: fn(all[plan] ?? EMPTY_MARGIN_DRAFT) }));

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet'), href: '/admin/wallet' }, { label: t('crumb') }]} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      {!canEdit && <ReadOnlyBanner />}
      {margins.isPending ? (
        <LoadingBlock />
      ) : margins.isError ? (
        <ErrorState error={margins.error} onRetry={() => void margins.refetch()} />
      ) : (
        <>
          <PricingModeNote mode={margins.data.pricingMode} />
          <Card className="space-y-4">
            <div className="max-w-md">
              <Field label={t('scope.label')} htmlFor="margin-scope" hint={t('scope.hint')}>
                <Select
                  id="margin-scope"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                >
                  <option value="">{t('scope.platform')}</option>
                  {margins.data.plans.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {rates.isError && (
              <Alert tone="warning">
                {t('ratesFailed')}{' '}
                <button type="button" className="underline" onClick={() => void rates.refetch()}>
                  {t('retry')}
                </button>
              </Alert>
            )}
            <PlanEditor
              key={plan}
              plan={plan}
              data={margins.data}
              rates={rates.data}
              ratesPending={rates.isPending}
              canEdit={canEdit}
              draft={draft}
              setDraft={setDraft}
            />
          </Card>
        </>
      )}
      <Help />
    </div>
  );
}

type PlanEditorProps = {
  plan: string;
  data: MarginsResponse;
  rates: RatesResponse | undefined;
  ratesPending: boolean;
  canEdit: boolean;
  draft: MarginDraft;
  setDraft: (fn: (d: MarginDraft) => MarginDraft) => void;
};

function PlanEditor({ plan, data, rates, ratesPending, canEdit, draft, setDraft }: PlanEditorProps) {
  const t = useTranslations('wallet-message-billing.admin.margins');
  const tg = useTranslations('wallet-message-billing.admin.margins.grid');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [showProblems, setShowProblems] = useState(false);
  const [removing, setRemoving] = useState<MarginGridRow | null>(null);
  const [sendPlan, setSendPlan] = useState<MarginSavePlan | null>(null);
  const rows = useMarginRows(data, rates, draft);
  const dirtyCount = rows.filter((r) => r.dirty).length;
  const names = new Map(data.countries.map((c) => [c.code, c.name] as const));

  const save = useMutation({
    mutationFn: (p: MarginSavePlan) => operatorApi.saveMargins({ planSlug: plan, rows: p.rows }),
    onSuccess: (result, p) => {
      setDraft((d) => afterMarginSave(d, p, result));
      setShowProblems(false);
      void qc.invalidateQueries({ queryKey: KEYS.margins(plan) });
      if (result.skipped.length > 0)
        toast.error(tg('savedSome', { saved: result.saved, skipped: result.skipped.length }));
      else toast.success(tg('saved', { count: result.saved }));
    },
    onError: (err) => toast.error(te(errorKind(err))),
  });

  const remove = useMutation({
    mutationFn: (id: string) => operatorApi.deleteMargin(id),
    onSuccess: (_r, id) => {
      setRemoving(null);
      setDraft((d) => forgetRow(d, id));
      void qc.invalidateQueries({ queryKey: KEYS.margins(plan) });
      toast.success(tg('removed'));
    },
    onError: (err) => {
      setRemoving(null);
      toast.error(te(errorKind(err)));
    },
  });

  const onSave = () => {
    const p = planMarginSave(rows);
    setShowProblems(true);
    setSendPlan(p);
    if (p.invalid.length === 0 && !p.tooMany && p.rows.length > 0) save.mutate(p);
  };

  return (
    <div className="space-y-4">
      {ratesPending && <LoadingBlock className="flex items-center gap-2 text-xs text-muted-foreground" />}
      {rows.length === 0 ? (
        <Alert tone="info">{tg('empty')}</Alert>
      ) : (
        <MarginGrid
          rows={rows}
          countries={data.countries}
          currency={data.currency}
          canEdit={canEdit}
          audit={false}
          showProblems={showProblems}
          skipped={draft.skipped}
          labelKey={t('title')}
          onChange={(key, field, value) => setDraft((d) => editMarginField(d, key, field, value))}
          onRemove={(r) =>
            r.existing ? setRemoving(r) : setDraft((d) => removeNewMarginRow(d, r.key))
          }
          onUndo={() => undefined}
        />
      )}
      {sendPlan?.tooMany && <Alert tone="danger">{tg('tooMany')}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setDraft((d) => addMarginRow(d))}>
            {tg('addRow')}
          </Button>
          <Button onClick={onSave} disabled={dirtyCount === 0 || save.isPending}>
            {save.isPending && <Spinner label={tg('saving')} />}
            {tg('save')}
          </Button>
          {dirtyCount > 0 && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {tg('unsaved', { count: dirtyCount })}
            </span>
          )}
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={tg('removeTitle')}
        message={tg('removeBody', {
          country: removing
            ? countryLabel(removing.countryCode, names.get(removing.countryCode), tg('anyCountry'))
            : '',
        })}
        confirmLabel={tg('remove')}
        cancelLabel={tg('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.key)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function Help() {
  const t = useTranslations('wallet-message-billing.admin.margins.help');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(['layers', 'specific', 'unknown'] as const).map((k) => (
        <Card key={k} className="space-y-1.5">
          <h2 className="text-sm font-semibold">{t(`${k}.title`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`${k}.body`)}</p>
        </Card>
      ))}
    </div>
  );
}
