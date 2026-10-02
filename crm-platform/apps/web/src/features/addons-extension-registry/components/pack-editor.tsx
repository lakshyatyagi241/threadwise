'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { addonPackSchema, type AddonPack, type PlanBillingUnit } from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchGrantFields } from '../api';
import { addonErrorKey } from '../lib/errors';
import {
  buildPackRequest,
  isDraftDirty,
  newPackDraft,
  packToDraft,
  type PackDraft,
  type PackField,
} from '../lib/pack-draft';

const NS = 'addons-extension-registry.packs.editor';
const UNITS: readonly PlanBillingUnit[] = ['days', 'weeks', 'months', 'years'];
const FORM_ID = 'addon-pack-form';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="space-y-0.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** Create or edit one add-on. The form validates with the API's own schema; the server stays the authority. */
export function PackEditor({
  pack,
  onClose,
  onSaved,
}: {
  pack: AddonPack | null;
  onClose: () => void;
  onSaved: (saved: AddonPack, created: boolean) => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('addons-extension-registry.common');
  const te = useTranslations('addons-extension-registry.packs.errors');
  const initial = pack ? packToDraft(pack) : newPackDraft();
  const [draft, setDraft] = useState<PackDraft>(initial);
  const [problems, setProblems] = useState<Partial<Record<PackField, true>>>({});
  const fields = useQuery({
    queryKey: KEYS.fields,
    queryFn: ({ signal }) => fetchGrantFields(signal),
    staleTime: 60_000,
  });

  const set = <K extends keyof PackDraft>(k: K, v: PackDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const err = (f: PackField) => (problems[f] ? t(`problems.${f}`) : undefined);

  const save = useMutation({
    mutationFn: (body: object) =>
      pack
        ? operatorFetch(`/addons/${pack.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: pack.rowVersion },
            schema: addonPackSchema,
          })
        : operatorFetch('/addons', { method: 'POST', body, schema: addonPackSchema }),
    onSuccess: (saved) => onSaved(saved, !pack),
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

  const dirty = isDraftDirty(draft, initial);
  const close = () => {
    if (!save.isPending) onClose();
  };
  const errorKey = save.isError ? addonErrorKey(save.error) : null;
  const toggleFeature = (key: string, on: boolean) =>
    set(
      'features',
      on ? [...new Set([...draft.features, key])] : draft.features.filter((k) => k !== key),
    );

  return (
    <Modal
      open
      size="lg"
      onClose={close}
      closeLabel={tc('close')}
      title={pack ? t('titleEdit', { name: pack.name }) : t('titleNew')}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={save.isPending || (!!pack && !dirty)}>
            {save.isPending && <Spinner label={tc('saving')} />}
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
        {(errorKey || problems.form) && (
          <Alert tone="danger">
            {errorKey === 'conflict'
              ? tc('errors.conflict')
              : errorKey
                ? te(errorKey === 'forbidden' || errorKey === 'notFound' ? errorKey : 'generic')
                : t('problems.form')}
          </Alert>
        )}

        <Section title={t('basics')}>
          <Field label={t('fields.name')} htmlFor="addon-name" error={err('name')}>
            <Input
              id="addon-name"
              value={draft.name}
              maxLength={120}
              invalid={!!problems.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={t('fields.subtitle')} htmlFor="addon-subtitle">
            <Input
              id="addon-subtitle"
              value={draft.subtitle}
              maxLength={191}
              onChange={(e) => set('subtitle', e.target.value)}
            />
          </Field>
          <Field label={t('fields.detail')} htmlFor="addon-detail">
            <Textarea
              id="addon-detail"
              rows={3}
              value={draft.detail}
              maxLength={2000}
              onChange={(e) => set('detail', e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.isActive}
                label={t('fields.isActive')}
                onCheckedChange={(v) => set('isActive', v)}
              />
              {t('fields.isActive')}
            </label>
            <Field
              label={t('fields.sortOrder')}
              htmlFor="addon-sort"
              error={err('sortOrder')}
              className="w-32"
            >
              <Input
                id="addon-sort"
                inputMode="numeric"
                value={draft.sortOrder}
                invalid={!!problems.sortOrder}
                onChange={(e) => set('sortOrder', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('pricing')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('fields.amount')} htmlFor="addon-amount" error={err('amount')}>
              <Input
                id="addon-amount"
                inputMode="decimal"
                dir="ltr"
                value={draft.amount}
                invalid={!!problems.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </Field>
            <Field
              label={t('fields.offerAmount')}
              htmlFor="addon-offer"
              hint={t('fields.offerHint')}
              error={err('offerAmount')}
            >
              <Input
                id="addon-offer"
                inputMode="decimal"
                dir="ltr"
                value={draft.offerAmount}
                invalid={!!problems.offerAmount}
                onChange={(e) => set('offerAmount', e.target.value)}
              />
            </Field>
            <Field label={t('fields.currency')} htmlFor="addon-currency" error={err('currency')}>
              <Input
                id="addon-currency"
                dir="ltr"
                maxLength={3}
                value={draft.currency}
                invalid={!!problems.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <Checkbox
            id="addon-lifetime"
            checked={draft.isLifetime}
            label={t('fields.isLifetime')}
            onChange={(e) => set('isLifetime', e.target.checked)}
          />
          {!draft.isLifetime && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('fields.billingDuration')}
                htmlFor="addon-duration"
                error={err('billingDuration')}
              >
                <Input
                  id="addon-duration"
                  inputMode="numeric"
                  value={draft.billingDuration}
                  invalid={!!problems.billingDuration}
                  onChange={(e) => set('billingDuration', e.target.value)}
                />
              </Field>
              <Field label={t('fields.billingUnit')} htmlFor="addon-unit">
                <Select
                  id="addon-unit"
                  value={draft.billingUnit}
                  onChange={(e) => set('billingUnit', e.target.value as PlanBillingUnit)}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(`units.${u}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Section>

        <Section title={t('grants')} hint={t('grantsHint')}>
          {fields.isPending && <Spinner label={tc('loading')} />}
          {fields.isError && <Alert tone="danger">{tc('errors.unexpected')}</Alert>}
          {fields.data && (
            <>
              <h4 className="text-sm font-medium">{t('features')}</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.data.features.map((f) => (
                  <Checkbox
                    key={f.key}
                    id={`addon-feature-${f.key}`}
                    checked={draft.features.includes(f.key)}
                    label={f.label}
                    onChange={(e) => toggleFeature(f.key, e.target.checked)}
                  />
                ))}
              </div>
              <h4 className="pt-2 text-sm font-medium">{t('limits')}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.data.limits.map((l) => (
                  <Field
                    key={l.key}
                    label={l.label}
                    htmlFor={`addon-limit-${l.key}`}
                    hint={l.hint || undefined}
                  >
                    <Input
                      id={`addon-limit-${l.key}`}
                      inputMode="numeric"
                      dir="ltr"
                      value={draft.limits[l.key] ?? ''}
                      onChange={(e) => set('limits', { ...draft.limits, [l.key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
              {problems.limits && (
                <p role="alert" className="text-xs text-danger">
                  {t('problems.limits')}
                </p>
              )}
            </>
          )}
        </Section>
      </form>
    </Modal>
  );
}
