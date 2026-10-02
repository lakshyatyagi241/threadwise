'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import type { PaygwGatewayItem } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { saveGateway, setGatewayActive } from '../api';
import { buildUpdate, draftFrom, isDirty, type GatewayDraft } from '../lib/gateway-draft';

const NS = 'platform-payment-gateways.admin.card';

interface Props {
  gateway: PaygwGatewayItem;
  currencyChoices: readonly string[];
  canEdit: boolean;
  /** Called after any change so the list reloads (the new rowVersion remounts the card with a clean draft). */
  onChanged: () => void;
}

/** One gateway: header (status, badges, activate) and, when opened, its credential form. Collapsed by default. */
export function GatewayCard({ gateway: g, currencyChoices, canEdit, onChanged }: Props) {
  const t = useTranslations(NS);
  const te = useTranslations('platform-payment-gateways.admin.errors');
  const tr = useTranslations('platform-payment-gateways.admin.regions');
  const toast = useToast();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GatewayDraft>(() => draftFrom(g));
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = isDirty(g, draft);

  const explain = (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.isRowVersionConflict || e.status === 409) return te('conflict');
      if (e.code === 'PAYGW_GATEWAY_NOT_CONFIGURED') {
        return te('notConfigured', { fields: e.fieldErrors.map((f) => f.path).join(', ') });
      }
      if (e.code === 'PAYGW_GATEWAY_UNAVAILABLE') return te('noDriver');
      if (e.status === 403) return te('forbidden');
    }
    return te('generic');
  };

  const save = useMutation({
    mutationFn: () => saveGateway(g.id, buildUpdate(g, draft)),
    onSuccess: () => {
      toast.success(t('saved', { name: g.name }));
      setProblem(null);
      onChanged();
    },
    onError: (e) => {
      setProblem(explain(e));
      if (e instanceof ApiError && e.status === 409) onChanged();
    },
  });

  const toggle = useMutation({
    mutationFn: () => setGatewayActive(g.id, { isActive: !g.isActive, rowVersion: g.rowVersion }),
    onSuccess: (next) => {
      toast.success(t(next.isActive ? 'activated' : 'deactivated', { name: g.name }));
      setProblem(null);
      onChanged();
    },
    onError: (e) => {
      const message = explain(e);
      setProblem(message);
      toast.error(message);
      if (e instanceof ApiError && e.status === 409) onChanged();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canEdit && dirty) save.mutate();
  };

  const setValue = (key: string, value: string) =>
    setDraft((d) => ({
      ...d,
      values: { ...d.values, [key]: value },
      cleared: d.cleared.filter((k) => k !== key),
    }));
  const toggleClear = (key: string) =>
    setDraft((d) => ({
      ...d,
      values: { ...d.values, [key]: '' },
      cleared: d.cleared.includes(key) ? d.cleared.filter((k) => k !== key) : [...d.cleared, key],
    }));
  const toggleCurrency = (code: string) =>
    setDraft((d) => ({
      ...d,
      currencies: d.currencies.includes(code)
        ? d.currencies.filter((c) => c !== code)
        : [...d.currencies, code],
    }));

  return (
    <Card className="overflow-hidden p-0" data-testid={`gateway-${g.slug}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <span
            aria-hidden
            className={`inline-block text-muted-foreground transition-transform ${open ? 'rotate-90' : 'rtl:rotate-180'}`}
          >
            ›
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{g.name}</span>
              <Badge tone={g.isActive ? 'success' : 'neutral'}>
                {t(g.isActive ? 'active' : 'disabled')}
              </Badge>
              <Badge tone={g.mode === 'live' ? 'danger' : 'warning'}>{t(`mode.${g.mode}`)}</Badge>
              {g.keysSaved && <Badge tone="success">{t('keysSaved')}</Badge>}
              {!g.driverAvailable && <Badge>{t('noDriverBadge')}</Badge>}
              {g.regions.slice(0, 3).map((r) => (
                <Badge key={r}>{tr(r)}</Badge>
              ))}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {g.slug} · {g.description}
            </span>
          </span>
        </button>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant={g.isActive ? 'secondary' : 'primary'}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {t(g.isActive ? 'disable' : 'activate')}
          </Button>
        )}
      </div>

      {open && (
        <form
          id={panelId}
          onSubmit={onSubmit}
          className="space-y-4 border-t border-border bg-muted/30 px-4 py-4"
        >
          {problem && <Alert tone="danger">{problem}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            {g.fields.map((f) => {
              const id = `${g.slug}-${f.key}`;
              const cleared = draft.cleared.includes(f.key);
              const placeholder = f.hasValue && !cleared ? t('savedPlaceholder') : '';
              const common = {
                id,
                value: draft.values[f.key] ?? '',
                placeholder,
                disabled: !canEdit || cleared,
                autoComplete: 'off',
                onChange: (e: { target: { value: string } }) => setValue(f.key, e.target.value),
              };
              return (
                <Field
                  key={f.key}
                  htmlFor={id}
                  className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}
                  label={
                    <span>
                      {f.label}
                      {f.required && <span className="text-danger"> *</span>}
                    </span>
                  }
                  hint={f.hint ?? undefined}
                >
                  {f.type === 'textarea' ? (
                    <Textarea rows={3} {...common} />
                  ) : f.type === 'select' ? (
                    <Select {...common}>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input type={f.type === 'password' ? 'password' : 'text'} {...common} />
                  )}
                  {canEdit && f.hasValue && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-danger underline"
                      onClick={() => toggleClear(f.key)}
                    >
                      {t(cleared ? 'undoClear' : 'clear')}
                    </button>
                  )}
                </Field>
              );
            })}
            <Field label={t('modeLabel')} htmlFor={`${g.slug}-mode`}>
              <Select
                id={`${g.slug}-mode`}
                value={draft.mode}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, mode: e.target.value as 'sandbox' | 'live' }))
                }
              >
                <option value="sandbox">{t('mode.sandbox')}</option>
                <option value="live">{t('mode.live')}</option>
              </Select>
            </Field>
            <Field label={t('sortOrder')} htmlFor={`${g.slug}-sort`}>
              <Input
                id={`${g.slug}-sort`}
                type="number"
                min={0}
                value={draft.sortOrder}
                disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              />
            </Field>
          </div>

          <fieldset className="space-y-2" disabled={!canEdit}>
            <legend className="text-sm font-medium">
              {t('currencies')}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {draft.currencies.length === 0
                  ? t('currenciesAll')
                  : t('currenciesSelected', { count: draft.currencies.length })}
              </span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...currencyChoices, ...draft.currencies])].sort().map((c) => {
                const on = draft.currencies.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCurrency(c)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t('currenciesHint')}</p>
          </fieldset>

          <Field label={t('webhookUrl')} htmlFor={`${g.slug}-hook`} hint={t('webhookHint')}>
            <Input
              id={`${g.slug}-hook`}
              readOnly
              value={g.webhookUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? t('saving') : t('save')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
          )}
        </form>
      )}
    </Card>
  );
}
