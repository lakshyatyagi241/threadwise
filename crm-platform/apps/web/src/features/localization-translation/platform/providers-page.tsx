'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  translationProviderListResponseSchema,
  type TranslationProviderItem,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Input, Spinner, Switch } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { errorKey } from '../lib';

const KEY = ['i18n', 'providers'] as const;
const NS = 'localization-translation.providers';

/** TW-I18N-014..018: the provider catalogue. Stored secrets are never shown; a blank field keeps the stored value. */
export function ProvidersPage() {
  const t = useTranslations(NS);
  const te = useTranslations('localization-translation.errors');
  const qc = useQueryClient();
  const { canRunDanger } = useOperator();
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/translation-providers', {
        schema: translationProviderListResponseSchema,
        signal,
      }),
  });
  const run = useMutation({
    mutationFn: (req: { path: string; method: 'POST' | 'PATCH'; body: unknown }) =>
      operatorFetch(`/i18n/translation-providers${req.path}`, {
        method: req.method,
        body: req.body,
      }),
    onSuccess: () => setError(null),
    onError: (e) => setError(te(errorKey(e))),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{te('unexpected')}</Alert>;
  const { data, lockdown } = q.data;
  const disabled = !canRunDanger || run.isPending;
  const post = (p: TranslationProviderItem, action: 'toggle' | 'default') =>
    run.mutate({
      path: `/${p.id}/${action}`,
      method: 'POST',
      body: { rowVersion: p.rowVersion },
    });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('kicker')} title={t('title')} description={t('description')} />
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="flex items-start justify-between gap-4 p-4">
        <div>
          <p className="font-medium">{t('lockdown.title')}</p>
          <p className="text-sm text-muted-foreground">{t('lockdown.description')}</p>
        </div>
        <Switch
          checked={lockdown.enabled}
          label={t('lockdown.title')}
          disabled={disabled}
          onCheckedChange={(enabled) =>
            run.mutate({ path: '/lockdown', method: 'POST', body: { enabled } })
          }
        />
      </Card>
      <div className="space-y-4">
        {data.map((p) => (
          <ProviderCard
            // A saved row has a new version: remounting clears the typed secrets.
            key={`${p.id}:${p.rowVersion}`}
            provider={p}
            disabled={disabled}
            onSave={(body) => run.mutate({ path: `/${p.id}`, method: 'PATCH', body })}
            onToggle={() => post(p, 'toggle')}
            onDefault={() => post(p, 'default')}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider: p,
  disabled,
  onSave,
  onToggle,
  onDefault,
}: {
  provider: TranslationProviderItem;
  disabled: boolean;
  onSave: (body: unknown) => void;
  onToggle: () => void;
  onDefault: () => void;
}) {
  const t = useTranslations(NS);
  const [values, setValues] = useState<Record<string, string>>({});
  const [order, setOrder] = useState(String(p.sortOrder));

  function submit(e: FormEvent) {
    e.preventDefault();
    const credentials = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim() !== ''),
    );
    onSave({ credentials, sortOrder: Number(order), rowVersion: p.rowVersion });
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{p.name}</h2>
            {p.isDefault && <Badge tone="success">{t('defaultBadge')}</Badge>}
            {!p.official && <Badge tone="warning">{t('unofficial')}</Badge>}
            {p.skippedByLockdown && <Badge tone="danger">{t('skipped')}</Badge>}
          </div>
          {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={p.isActive}
            label={t('activeLabel', { name: p.name })}
            disabled={disabled}
            onCheckedChange={onToggle}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !p.isActive || p.isDefault}
            onClick={onDefault}
          >
            {t('makeDefault')}
          </Button>
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {p.credentialFields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            htmlFor={`${p.slug}-${f.key}`}
            hint={f.hint ?? (f.hasValue && f.type === 'password' ? t('secretStored') : undefined)}
          >
            <Input
              id={`${p.slug}-${f.key}`}
              type={f.type}
              autoComplete="off"
              spellCheck={false}
              placeholder={f.placeholder ?? undefined}
              defaultValue={f.type === 'password' ? '' : (f.value ?? '')}
              readOnly={disabled}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
        <Field label={t('sortOrder')} htmlFor={`${p.slug}-order`}>
          <Input
            id={`${p.slug}-order`}
            type="number"
            min={0}
            value={order}
            readOnly={disabled}
            onChange={(e) => setOrder(e.target.value)}
          />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" size="sm" disabled={disabled}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
