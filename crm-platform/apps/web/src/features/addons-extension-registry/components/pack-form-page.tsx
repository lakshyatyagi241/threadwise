'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addonPackSchema,
  type AddonKind,
  type AddonPack,
  type PlanAddonOfferMode,
  type PlanBillingUnit,
  type SetAddonPlanOffersRequest,
} from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Input, Select, Spinner, cn } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import {
  PLANS_QUERY_KEY,
  PLAN_INCLUDABLE_PACKS_QUERY_KEY,
} from '@/features/auth-registration-security/platform/plans/plans-query';
import { KEYS, fetchGrantFields, fetchPack } from '../api';
import { addonErrorKey } from '../lib/errors';
import {
  amountFlagged,
  buildPackRequest,
  buildPlanOffersRequest,
  changedPlanOfferCount,
  newPackDraft,
  packProblemsFromError,
  packToDraft,
  planOfferModes,
  planOffersToDraft,
  setPlanOfferAmount,
  setPackKind,
  setPlanOfferMode,
  type PackDraft,
  type PackField,
  type PlanOfferProblem,
  type PlanOffersDraft,
} from '../lib/pack-draft';
import { OfferModeChoice } from './offer-mode-choice';
import { Accent, ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.packs.editor';
const UNITS: readonly PlanBillingUnit[] = ['days', 'weeks', 'months', 'years'];
const FORM_ID = 'addonForm';
const KINDS: readonly AddonKind[] = ['feature', 'capacity'];

/** `/admin/addons/new` and `/admin/addons/:id/edit`: one page, two modes, as in Reference. */
export function PackFormPage({ packId }: { packId?: string }) {
  const q = useQuery({
    queryKey: KEYS.pack(packId ?? 'new'),
    queryFn: ({ signal }) => fetchPack(packId as string, signal),
    enabled: !!packId,
    refetchOnWindowFocus: false,
  });
  if (!packId) return <PackForm pack={null} />;
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <PackForm pack={q.data} />;
}

function Section({
  n,
  title,
  note,
  hint,
  children,
  first,
}: {
  n: string;
  title: string;
  note?: string;
  hint?: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section className={cn(!first && 'border-t border-border pt-6')}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-primary">
          {n}
        </span>
        <h2 className="flex-1 font-serif text-lg leading-none">{title}</h2>
        {note && <span className="font-mono text-[10px] text-muted-foreground">{note}</span>}
      </div>
      {hint && <p className="-mt-1 mb-3 ps-[33px] text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

const LABEL = 'mb-1.5 block text-xs font-semibold';

function PackForm({ pack }: { pack: AddonPack | null }) {
  const t = useTranslations(NS);
  const tc = useTranslations('addons-extension-registry.common');
  const te = useTranslations('addons-extension-registry.packs.errors');
  const router = useRouter();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [draft, setDraft] = useState<PackDraft>(() => (pack ? packToDraft(pack) : newPackDraft()));
  const [problems, setProblems] = useState<Partial<Record<PackField, true>>>({});
  const fields = useQuery({
    queryKey: KEYS.fields,
    queryFn: ({ signal }) => fetchGrantFields(signal),
    staleTime: 60_000,
  });

  const set = <K extends keyof PackDraft>(k: K, v: PackDraft[K]) => {
    clearServerProblems();
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const chooseKind = (kind: AddonKind) => {
    clearServerProblems();
    setProblems({});
    setDraft((d) => setPackKind(d, kind));
  };

  const save = useMutation({
    mutationFn: (body: object) =>
      pack
        ? operatorFetch(`/addons/${pack.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: pack.rowVersion },
            schema: addonPackSchema,
          })
        : operatorFetch('/addons', { method: 'POST', body, schema: addonPackSchema }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.packs });
      router.push(`/admin/addons?saved=${pack ? 'updated' : 'created'}`);
    },
  });

  // The API refused the features / limits of the pack: shown on those sections like the client check, until the form is edited.
  const serverProblems = save.isError ? packProblemsFromError(save.error) : {};
  function clearServerProblems() {
    if (save.isError && Object.keys(serverProblems).length > 0) save.reset();
  }
  const shown: Partial<Record<PackField, true>> = { ...problems, ...serverProblems };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildPackRequest(draft);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems({});
    save.mutate(r.body);
  };

  const errorKey =
    save.isError && Object.keys(serverProblems).length === 0 ? addonErrorKey(save.error) : null;
  const problemList = (Object.keys(shown) as PackField[]).map((f) => t(`problems.${f}`));
  const toggleFeature = (key: string, on: boolean) =>
    set(
      'features',
      on ? [...new Set([...draft.features, key])] : draft.features.filter((k) => k !== key),
    );
  const isFeature = draft.kind === 'feature';
  const unlocksNothing = !!pack && isFeature && draft.features.length === 0;
  const currencies = fields.data?.currencies ?? [];
  const currencyOptions = currencies.some((c) => c.code === draft.currency)
    ? currencies
    : [{ code: draft.currency, name: '' }, ...currencies];
  const submitLabel = pack ? t('saveChanges') : t('create');
  const inputCls = 'h-auto py-2.5 text-[13px]';

  const actions = (
    <>
      <Link
        href="/admin/addons"
        className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-medium hover:bg-muted"
      >
        {t('cancel')}
      </Link>
      {canEdit && (
        <Button
          type="submit"
          form={FORM_ID}
          size="sm"
          className="rounded-full"
          disabled={save.isPending}
        >
          {save.isPending && <Spinner label={tc('saving')} />}
          {submitLabel}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: t('crumbHere'), href: '/admin/addons' },
          { label: pack ? t('crumbEdit') : t('crumbNew') },
        ]}
        eyebrow={pack ? t('eyebrowEdit') : t('eyebrowNew')}
        title={
          <>
            {pack ? t('titleEditLead') : t('titleNewLead')} <Accent>{t('titleAccent')}</Accent>
          </>
        }
        description={t('intro')}
        actions={actions}
      />

      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}
      {pack && draft.legacy && (
        <Alert tone="info" className="rounded-2xl px-4 py-3" data-testid="legacy-pack-notice">
          <div className="mb-1 font-semibold">{t('legacy.title')}</div>
          <p>{t('legacy.body')}</p>
        </Alert>
      )}
      {unlocksNothing && (
        <Alert tone="warning" className="rounded-2xl px-4 py-3" data-testid="no-features-notice">
          {t('noFeaturesNotice')}
        </Alert>
      )}
      {(errorKey || problemList.length > 0) && (
        <Alert tone="danger" className="rounded-2xl px-4 py-3">
          <div className="mb-1 font-semibold">{t('fixTitle')}</div>
          <ul className="list-disc ps-5">
            {errorKey ? (
              <li>
                {errorKey === 'conflict'
                  ? tc('errors.conflict')
                  : te(errorKey === 'forbidden' || errorKey === 'notFound' ? errorKey : 'generic')}
              </li>
            ) : (
              problemList.map((p) => <li key={p}>{p}</li>)
            )}
          </ul>
        </Alert>
      )}

      <form id={FORM_ID} onSubmit={submit} noValidate>
        <Card className="overflow-hidden rounded-2xl p-0">
          <fieldset disabled={!canEdit} className="space-y-8 p-5">
            <Section first n="01" title={t('type.title')} hint={t('type.hint')}>
              <div
                role="radiogroup"
                aria-label={t('type.title')}
                data-testid="pack-kind"
                data-value={draft.kind}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                {KINDS.map((k) => (
                  <label key={k} className="relative flex min-w-0 cursor-pointer">
                    <input
                      type="radio"
                      name="addon-kind"
                      value={k}
                      checked={draft.kind === k}
                      onChange={() => chooseKind(k)}
                      className="peer sr-only"
                      data-testid={`pack-kind-${k}`}
                    />
                    <span className="flex w-full flex-col gap-1 rounded-xl border border-border px-4 py-3 hover:bg-muted peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
                      <span className="break-words text-[13px] font-semibold">
                        {t(`type.${k}.title`)}
                      </span>
                      <span className="break-words text-xs text-muted-foreground">
                        {t(`type.${k}.body`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            <Section n="02" title={t('basics')} note={tc('required')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="addon-name" className={LABEL}>
                    {t('fields.name')}
                  </label>
                  <Input
                    id="addon-name"
                    className={inputCls}
                    required
                    maxLength={120}
                    placeholder={t('fields.namePlaceholder')}
                    invalid={!!problems.name}
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="addon-subtitle" className={LABEL}>
                    {t('fields.subtitle')}
                  </label>
                  <Input
                    id="addon-subtitle"
                    className={inputCls}
                    maxLength={191}
                    placeholder={t('fields.subtitlePlaceholder')}
                    value={draft.subtitle}
                    onChange={(e) => set('subtitle', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="addon-amount" className={LABEL}>
                    {t('fields.amount')}
                  </label>
                  <Input
                    id="addon-amount"
                    className={cn(inputCls, 'font-mono')}
                    dir="ltr"
                    inputMode="decimal"
                    required
                    invalid={amountFlagged(problems)}
                    value={draft.amount}
                    onChange={(e) => set('amount', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="addon-offer" className={LABEL}>
                    {t('fields.offerAmount')}
                  </label>
                  <Input
                    id="addon-offer"
                    className={cn(inputCls, 'font-mono')}
                    dir="ltr"
                    inputMode="decimal"
                    invalid={!!problems.offerAmount}
                    value={draft.offerAmount}
                    onChange={(e) => set('offerAmount', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="addon-currency" className={LABEL}>
                    {t('fields.currency')}
                  </label>
                  <Select
                    id="addon-currency"
                    className="h-auto py-2.5 text-[13px]"
                    invalid={!!problems.currency}
                    value={draft.currency}
                    onChange={(e) => set('currency', e.target.value)}
                  >
                    {currencyOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name ? `${c.code} — ${c.name}` : c.code}
                      </option>
                    ))}
                  </Select>
                </div>
                {draft.legacy ? (
                  <>
                    {/* A legacy pack keeps selling as it is: its billing is shown, not editable. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="addon-duration" className={LABEL}>
                          {t('fields.billingDuration')}
                        </label>
                        <Input
                          id="addon-duration"
                          className={cn(inputCls, 'font-mono')}
                          value={draft.billingDuration}
                          readOnly
                          disabled
                        />
                      </div>
                      <div>
                        <label htmlFor="addon-unit" className={LABEL}>
                          {t('fields.billingUnit')}
                        </label>
                        <Select
                          id="addon-unit"
                          className="h-auto py-2.5 text-[13px]"
                          value={draft.billingUnit}
                          disabled
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {t(`units.${u}`)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="addon-mode" className={LABEL}>
                        {t('fields.billingMode')}
                      </label>
                      <Select
                        id="addon-mode"
                        className="h-auto py-2.5 text-[13px]"
                        value={draft.isLifetime ? 'one_time' : draft.billingMode}
                        disabled
                      >
                        <option value="one_time">{t('modes.one_time')}</option>
                        <option value="recurring">{t('modes.recurring')}</option>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label htmlFor="addon-period" className={LABEL}>
                      {t('fields.period')}
                    </label>
                    <Select
                      id="addon-period"
                      className="h-auto py-2.5 text-[13px]"
                      value={draft.billingUnit === 'years' ? 'years' : 'months'}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          billingUnit: e.target.value === 'years' ? 'years' : 'months',
                          billingDuration: '1',
                          billingMode: 'recurring',
                          isLifetime: false,
                        }))
                      }
                      aria-describedby="addon-period-hint"
                    >
                      <option value="months">{t('periods.months')}</option>
                      <option value="years">{t('periods.years')}</option>
                    </Select>
                    <p id="addon-period-hint" className="mt-1 text-[11px] text-muted-foreground">
                      {t('periodHint')}
                    </p>
                  </div>
                )}
                <div>
                  <label htmlFor="addon-sort" className={LABEL}>
                    {t('fields.sortOrder')}
                  </label>
                  <Input
                    id="addon-sort"
                    className={cn(inputCls, 'font-mono')}
                    inputMode="numeric"
                    invalid={!!problems.sortOrder}
                    value={draft.sortOrder}
                    onChange={(e) => set('sortOrder', e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-6 pb-1">
                  <Checkbox
                    id="addon-active"
                    label={t('fields.isActive')}
                    checked={draft.isActive}
                    onChange={(e) => set('isActive', e.target.checked)}
                    className="items-center text-[12.5px]"
                  />
                  {draft.legacy && draft.isLifetime && (
                    <Checkbox
                      id="addon-lifetime"
                      label={t('fields.isLifetime')}
                      checked
                      disabled
                      onChange={() => undefined}
                      className="items-center text-[12.5px]"
                    />
                  )}
                </div>
              </div>
            </Section>

            {isFeature && (
              <Section n="03" title={t('features')} hint={t('featuresHint')}>
                {fields.isPending && <Spinner label={tc('loading')} />}
                {fields.isError && <Alert tone="danger">{tc('errors.unexpected')}</Alert>}
                {shown.features && (
                  <p id="addon-features-problem" role="alert" className="mb-2 text-xs text-danger">
                    {t('problems.features')}
                  </p>
                )}
                {fields.data && (
                  <div
                    role="group"
                    aria-label={t('features')}
                    aria-invalid={shown.features || undefined}
                    aria-describedby={shown.features ? 'addon-features-problem' : undefined}
                    className={cn(
                      'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3',
                      shown.features &&
                        'rounded-xl ring-1 ring-danger/60 ring-offset-4 ring-offset-background',
                    )}
                  >
                    {fields.data.features.map((f) => (
                      <Checkbox
                        key={f.key}
                        id={`addon-feature-${f.key}`}
                        label={f.core ? `${f.label} (${t('coreFeature')})` : f.label}
                        checked={draft.features.includes(f.key)}
                        // A core flag is in every plan: it can be unticked from a pack that already holds it, never added.
                        disabled={f.core && !draft.features.includes(f.key)}
                        onChange={(e) => toggleFeature(f.key, e.target.checked)}
                        className="items-center rounded-lg border border-border px-3 py-2 text-[12.5px] hover:bg-muted"
                      />
                    ))}
                  </div>
                )}
              </Section>
            )}

            <Section
              n={isFeature ? '04' : '03'}
              title={t('limits')}
              note={isFeature ? tc('optional') : tc('required')}
              hint={isFeature ? t('limitsHint') : t('limitsHintCapacity')}
            >
              {shown.limitsNeeded && (
                <p id="addon-limits-problem" role="alert" className="mb-2 text-xs text-danger">
                  {t('problems.limitsNeeded')}
                </p>
              )}
              {fields.data && (
                <div
                  role="group"
                  aria-label={t('limits')}
                  aria-invalid={shown.limitsNeeded || shown.limits || undefined}
                  aria-describedby={shown.limitsNeeded ? 'addon-limits-problem' : undefined}
                  className={cn(
                    'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
                    (shown.limitsNeeded || shown.limits) &&
                      'rounded-xl ring-1 ring-danger/60 ring-offset-4 ring-offset-background',
                  )}
                >
                  {fields.data.limits.map((l) => (
                    <div key={l.key}>
                      <label
                        htmlFor={`addon-limit-${l.key}`}
                        className="mb-1 block text-[11px] font-semibold"
                      >
                        {l.label}
                      </label>
                      <Input
                        id={`addon-limit-${l.key}`}
                        className="font-mono text-[13px]"
                        dir="ltr"
                        inputMode="numeric"
                        placeholder="—"
                        value={draft.limits[l.key] ?? ''}
                        onChange={(e) =>
                          set('limits', { ...draft.limits, [l.key]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </fieldset>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-4">
            <Link
              href="/admin/addons"
              className="inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
            >
              {t('cancel')}
            </Link>
            {canEdit && (
              <Button type="submit" className="rounded-full px-5" disabled={save.isPending}>
                {save.isPending && <Spinner label={tc('saving')} />}
                {submitLabel}
              </Button>
            )}
          </div>
        </Card>
      </form>

      {pack && (
        <PlanOffersCard
          pack={pack}
          canEdit={canEdit}
          featureCount={draft.features.length}
          n={isFeature ? '05' : '04'}
        />
      )}
    </div>
  );
}

/**
 * The pack's "Plans" section (existing pack only): how every plan offers it, Included | Paid | Hidden (a capacity pack has no Included),
 * with an optional price of the plan's own when Paid. Saved on its own (`PUT platform/addons/:id/plans`, only the rows that changed), so
 * it never mixes with the pack's own save and its row version. The plan editor's Add-ons tab edits the same rows from the plan's side.
 */
function PlanOffersCard({
  pack,
  canEdit,
  featureCount,
  n,
}: {
  pack: AddonPack;
  canEdit: boolean;
  /** How many features the form currently ticks: with none, a feature add-on has nothing to include. */
  featureCount: number;
  n: string;
}) {
  const t = useTranslations(`${NS}.planOffers`);
  const tc = useTranslations('addons-extension-registry.common');
  const qc = useQueryClient();
  const [current, setCurrent] = useState(pack);
  const [draft, setDraft] = useState<PlanOffersDraft>(() => planOffersToDraft(pack));
  const [problems, setProblems] = useState<Record<string, PlanOfferProblem>>({});
  const [saved, setSaved] = useState(false);
  const modes = planOfferModes(pack.kind, featureCount);
  const isCapacity = pack.kind === 'capacity';
  const needsFeatures = modes.some((m) => m.mode === 'included' && m.disabled);
  const changed = changedPlanOfferCount(current, draft);
  const listPrice = current.offerAmount ?? current.amount;

  const save = useMutation({
    mutationFn: (body: SetAddonPlanOffersRequest) =>
      operatorFetch(`/addons/${current.id}/plans`, {
        method: 'PUT',
        body,
        schema: addonPackSchema,
      }),
    onSuccess: async (next) => {
      setCurrent(next);
      setDraft(planOffersToDraft(next));
      setSaved(true);
      // The list's Plans column, and the plans whose features the offers just set.
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.packs }),
        qc.invalidateQueries({ queryKey: PLANS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: PLAN_INCLUDABLE_PACKS_QUERY_KEY }),
      ]);
    },
  });

  const edit = (next: PlanOffersDraft, planId: string) => {
    setDraft(next);
    setSaved(false);
    save.reset();
    if (problems[planId]) {
      const { [planId]: _drop, ...rest } = problems;
      setProblems(rest);
    }
  };

  const submit = () => {
    const r = buildPlanOffersRequest(current, draft);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems({});
    if (r.body.offers.length === 0) return;
    save.mutate(r.body);
  };

  const errorKey = save.isError ? addonErrorKey(save.error) : null;

  return (
    <Card className="overflow-hidden rounded-2xl p-0" data-testid="pack-plan-offers">
      <div className="space-y-4 p-5">
        <Section first n={n} title={t('title')} hint={t('hint')}>
          {isCapacity && <p className="mb-3 text-xs text-muted-foreground">{t('noIncluded')}</p>}
          {needsFeatures && (
            <p
              id="pack-plan-included-reason"
              className="mb-3 text-xs text-muted-foreground"
              data-testid="pack-plan-needs-features"
            >
              {t('needFeatures')}
            </p>
          )}
          {current.planOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {current.planOffers.map((o) => {
                const row = draft[o.planId] ?? { mode: o.mode, amount: '' };
                const priceId = `pack-plan-${o.planId}-price`;
                const problem = problems[o.planId];
                return (
                  <li
                    key={o.planId}
                    className="space-y-2 px-4 py-3"
                    data-testid={`pack-plan-${o.planId}`}
                    data-mode={row.mode}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="break-words text-[13px] font-semibold">{o.planName}</span>
                        {o.planIsFree && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            {t('freePlan')}
                          </span>
                        )}
                        {!o.planIsActive && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            {t('inactivePlan')}
                          </span>
                        )}
                      </div>
                      <OfferModeChoice
                        name={`pack-plan-${o.planId}`}
                        label={t('modeLabel', { plan: o.planName })}
                        value={row.mode}
                        options={modes.map((m) => ({
                          value: m.mode,
                          label: t(`modes.${m.mode}`),
                          disabled: m.disabled,
                        }))}
                        onChange={(m: PlanAddonOfferMode) =>
                          edit(setPlanOfferMode(draft, o.planId, m), o.planId)
                        }
                        disabled={!canEdit || save.isPending}
                        disabledDescribedBy="pack-plan-included-reason"
                        testId={`pack-plan-${o.planId}-mode`}
                      />
                    </div>
                    {row.mode === 'paid' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={priceId} className="text-[11px] font-semibold">
                          {t('priceLabel')}
                        </label>
                        <Input
                          id={priceId}
                          dir="ltr"
                          inputMode="decimal"
                          className="h-8 w-28 text-start font-mono text-[13px]"
                          placeholder={listPrice}
                          value={row.amount}
                          disabled={!canEdit || save.isPending}
                          invalid={!!problem}
                          aria-describedby={`${priceId}-hint`}
                          onChange={(e) =>
                            edit(setPlanOfferAmount(draft, o.planId, e.target.value), o.planId)
                          }
                        />
                        <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                          {current.currency}
                        </span>
                        <span id={`${priceId}-hint`} className="text-[11px] text-muted-foreground">
                          {t('priceHint')}
                        </span>
                      </div>
                    )}
                    {row.mode === 'paid' && o.planIsFree && (
                      <p className="text-[11px] text-muted-foreground">{t('freePlanNote')}</p>
                    )}
                    {row.mode === 'hidden' && (
                      <p className="text-[11px] text-muted-foreground">{t('hiddenNote')}</p>
                    )}
                    {problem && (
                      <p role="alert" className="text-[11px] text-danger">
                        {t(`problems.${problem}`)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
      {canEdit && current.planOffers.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/40 px-5 py-4">
          <p aria-live="polite" className="me-auto text-xs">
            {save.isError ? (
              <span role="alert" className="text-danger">
                {errorKey === 'forbidden' || errorKey === 'notFound'
                  ? t(`errors.${errorKey}`)
                  : t('errors.generic')}
              </span>
            ) : saved ? (
              <span className="text-success">{t('saved')}</span>
            ) : changed > 0 ? (
              <span className="text-muted-foreground">{t('changed', { count: changed })}</span>
            ) : null}
          </p>
          <Button
            type="button"
            className="rounded-full px-5"
            disabled={save.isPending || changed === 0}
            onClick={submit}
            data-testid="pack-plan-offers-save"
          >
            {save.isPending && <Spinner label={tc('saving')} />}
            {t('save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
