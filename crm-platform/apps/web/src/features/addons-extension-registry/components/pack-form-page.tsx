'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addonPackSchema, type AddonPack, type PlanBillingUnit } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Input, Select, Spinner, cn } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchGrantFields, fetchPack } from '../api';
import { addonErrorKey } from '../lib/errors';
import {
  buildPackRequest,
  newPackDraft,
  packToDraft,
  type PackDraft,
  type PackField,
} from '../lib/pack-draft';
import { Accent, ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.packs.editor';
const UNITS: readonly PlanBillingUnit[] = ['days', 'weeks', 'months', 'years'];
const FORM_ID = 'addonForm';

/** `/admin/addons/new` and `/admin/addons/:id/edit`: one page, two modes, as in WaDesk. */
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

  const set = <K extends keyof PackDraft>(k: K, v: PackDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

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

  const errorKey = save.isError ? addonErrorKey(save.error) : null;
  const problemList = (Object.keys(problems) as PackField[]).map((f) => t(`problems.${f}`));
  const toggleFeature = (key: string, on: boolean) =>
    set(
      'features',
      on ? [...new Set([...draft.features, key])] : draft.features.filter((k) => k !== key),
    );
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
            <Section first n="01" title={t('basics')} note={tc('required')}>
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
                    invalid={!!problems.amount}
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="addon-duration" className={LABEL}>
                      {t('fields.billingDuration')}
                    </label>
                    <Input
                      id="addon-duration"
                      className={cn(inputCls, 'font-mono')}
                      inputMode="numeric"
                      required
                      invalid={!!problems.billingDuration}
                      value={draft.billingDuration}
                      onChange={(e) => set('billingDuration', e.target.value)}
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
                      onChange={(e) => set('billingUnit', e.target.value as PlanBillingUnit)}
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
                  <Checkbox
                    id="addon-lifetime"
                    label={t('fields.isLifetime')}
                    checked={draft.isLifetime}
                    onChange={(e) => set('isLifetime', e.target.checked)}
                    className="items-center text-[12.5px]"
                  />
                </div>
              </div>
            </Section>

            <Section n="02" title={t('features')} hint={t('featuresHint')}>
              {fields.isPending && <Spinner label={tc('loading')} />}
              {fields.isError && <Alert tone="danger">{tc('errors.unexpected')}</Alert>}
              {fields.data && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {fields.data.features.map((f) => (
                    <Checkbox
                      key={f.key}
                      id={`addon-feature-${f.key}`}
                      label={f.label}
                      checked={draft.features.includes(f.key)}
                      onChange={(e) => toggleFeature(f.key, e.target.checked)}
                      className="items-center rounded-lg border border-border px-3 py-2 text-[12.5px] hover:bg-muted"
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section n="03" title={t('limits')} note={tc('optional')} hint={t('limitsHint')}>
              {fields.data && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
