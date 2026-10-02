'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UNOFFICIAL_PROVIDER_SLUGS,
  translationProviderListResponseSchema,
  type TranslationProviderItem,
} from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Field, Input, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { errorKey } from '../lib';

const KEY = ['i18n', 'providers'] as const;
const NS = 'localization-translation.providers';

const PILL = 'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase';

/**
 * TW-I18N-014..018, laid out like Reference's "Translation providers" page: the compliance lockdown panel with its
 * On/Off pill and Enable/Disable button, then one card per provider (status pills, slug and description, Make default
 * and Activate/Disable, the credential form, fallback order, "Save <name>"). Stored secrets are never shown; a blank
 * field keeps the stored value.
 */
export function ProvidersPage() {
  const t = useTranslations(NS);
  const te = useTranslations('localization-translation.errors');
  const qc = useQueryClient();
  const { canRunDanger } = useOperator();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLockdown, setConfirmLockdown] = useState(false);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/i18n/translation-providers', {
        schema: translationProviderListResponseSchema,
        signal,
      }),
  });
  const run = useMutation({
    mutationFn: (req: { path: string; method: 'POST' | 'PATCH'; body: unknown; ok: string }) =>
      operatorFetch(`/i18n/translation-providers${req.path}`, {
        method: req.method,
        body: req.body,
      }),
    onSuccess: (_d, req) => {
      setError(null);
      setNotice(req.ok);
    },
    onError: (e) => {
      setNotice(null);
      setError(te(errorKey(e)));
    },
    onSettled: () => {
      setConfirmLockdown(false);
      return qc.invalidateQueries({ queryKey: KEY });
    },
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
      ok:
        action === 'default'
          ? t('flash.nowDefault', { name: p.name })
          : t(p.isActive ? 'flash.disabled' : 'flash.activated', { name: p.name }),
    });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('kicker')} title={t('title')} description={t('description')} />
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Card
        className={
          'flex flex-wrap items-center justify-between gap-4 p-5 ' +
          (lockdown.enabled ? 'border-brand/40 bg-success/10' : '')
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{t('lockdown.title')}</h2>
            <span
              className={
                PILL + (lockdown.enabled ? ' bg-brand text-brand-foreground' : ' bg-muted')
              }
            >
              {lockdown.enabled ? t('on') : t('off')}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {t.rich('lockdown.description', {
              slugs: UNOFFICIAL_PROVIDER_SLUGS.join(', '),
              mono: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </p>
        </div>
        <Button
          variant={lockdown.enabled ? 'secondary' : 'brand'}
          disabled={disabled}
          onClick={() => setConfirmLockdown(true)}
        >
          {lockdown.enabled ? t('lockdown.disable') : t('lockdown.enable')}
        </Button>
      </Card>
      {data.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-lg font-semibold text-muted-foreground">{t('empty.title')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('empty.body')}</p>
        </Card>
      )}
      {data.map((p) => (
        <ProviderCard
          // A saved row has a new version: remounting clears the typed secrets.
          key={`${p.id}:${p.rowVersion}`}
          provider={p}
          disabled={disabled}
          onSave={(body) =>
            run.mutate({
              path: `/${p.id}`,
              method: 'PATCH',
              body,
              ok: t('flash.saved', { name: p.name }),
            })
          }
          onToggle={() => post(p, 'toggle')}
          onDefault={() => post(p, 'default')}
        />
      ))}
      <ConfirmDialog
        open={confirmLockdown}
        title={lockdown.enabled ? t('lockdown.disable') : t('lockdown.enable')}
        message={lockdown.enabled ? t('lockdown.confirmOff') : t('lockdown.confirmOn')}
        confirmLabel={lockdown.enabled ? t('lockdown.disable') : t('lockdown.enable')}
        cancelLabel={t('cancel')}
        busy={run.isPending}
        onClose={() => setConfirmLockdown(false)}
        onConfirm={() =>
          run.mutate({
            path: '/lockdown',
            method: 'POST',
            body: { enabled: !lockdown.enabled },
            ok: lockdown.enabled ? t('flash.lockdownOff') : t('flash.lockdownOn'),
          })
        }
      />
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
    <Card className={'overflow-hidden p-0 ' + (p.skippedByLockdown ? 'opacity-60' : '')}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
            <span className={PILL + (p.isActive ? ' bg-success/15 text-success' : ' bg-muted')}>
              {p.isActive ? t('active') : t('disabled')}
            </span>
            {p.isDefault && (
              <span className={PILL + ' border border-warning/40 bg-warning/15 text-warning'}>
                {t('defaultBadge')}
              </span>
            )}
            {p.skippedByLockdown && (
              <span
                className={PILL + ' border border-danger/40 bg-danger/10 text-danger'}
                title={t('skippedTitle')}
              >
                {t('skipped')}
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
            {t('slug', { slug: p.slug })}
            {p.description ? ` · ${p.description}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!p.isDefault && p.isActive && (
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onDefault}>
              {t('makeDefault')}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onToggle}>
            {p.isActive ? t('disable') : t('activate')}
          </Button>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        {p.credentialFields.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {p.credentialFields.map((f) => (
              <Field
                key={f.key}
                label={
                  <>
                    {f.label}
                    {f.required && <span className="ms-1 text-danger">*</span>}
                  </>
                }
                htmlFor={`${p.slug}-${f.key}`}
                hint={f.hint ?? undefined}
              >
                <Input
                  id={`${p.slug}-${f.key}`}
                  type={f.type}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder={
                    f.type === 'password'
                      ? f.hasValue
                        ? t('keepSecret')
                        : undefined
                      : (f.placeholder ?? undefined)
                  }
                  defaultValue={f.type === 'password' ? '' : (f.value ?? '')}
                  readOnly={disabled}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
            {t('noCredentials')}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <Field label={t('sortOrder')} htmlFor={`${p.slug}-order`} hint={t('sortOrderHint')}>
            <Input
              id={`${p.slug}-order`}
              type="number"
              min={0}
              className="font-mono"
              value={order}
              readOnly={disabled}
              onChange={(e) => setOrder(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="brand" disabled={disabled}>
            {t('save', { name: p.name })}
          </Button>
        </div>
      </form>
    </Card>
  );
}
