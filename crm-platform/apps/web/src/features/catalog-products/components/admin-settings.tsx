'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogSettingsResponseSchema, type CatalogSettingsResponse } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, PasswordInput, Spinner, Switch } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import {
  APP_ID_MAX,
  APP_SECRET_MAX,
  adminSettingsProblems,
  buildSettingsUpdate,
  formFromSettings,
  type AdminSettingsForm,
} from '../lib/admin-settings';
import { errorKind } from '../lib/errors';
import { KICKER } from './parts';

const NS = 'catalogProducts.admin';
const QUERY_KEY = ['operator', 'catalog-settings'] as const;
const STEPS = ['waba', 'catalog', 'link', 'token', 'paste'] as const;
const DOCS = ['sell', 'messages', 'batch', 'changelog', 'policies'] as const;
const DOC_URL: Record<(typeof DOCS)[number], string> = {
  sell: 'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/sell-products-and-services',
  messages: 'https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages',
  batch: 'https://developers.facebook.com/docs/commerce-platform/catalog/batch-api',
  changelog: 'https://developers.facebook.com/docs/graph-api/changelog',
  policies: 'https://www.facebook.com/commerce/policies',
};

/** What a failed call says: a kind of problem, chosen by status and code, never by the server's wording. */
function failureKey(
  error: unknown,
): 'conflict' | 'forbidden' | 'validation' | 'network' | 'unexpected' {
  if (error instanceof ApiError) {
    if (error.isRowVersionConflict) return 'conflict';
    if (error.status === 403) return 'forbidden';
    if (error.status === 422 || error.status === 400) return 'validation';
  }
  const kind = errorKind(error);
  return kind === 'network' ? 'network' : 'unexpected';
}

function Tile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-[28px] leading-none tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function Section({
  kicker,
  title,
  intro,
  children,
}: {
  kicker: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-4">
        <div className={KICKER}>{kicker}</div>
        <h2 className="mt-1 font-serif text-[22px] font-normal leading-tight">{title}</h2>
        {intro && <p className="mt-1 text-[11.5px] text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </Card>
  );
}

function SettingsForm({ data, canEdit }: { data: CatalogSettingsResponse; canEdit: boolean }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [form, setForm] = useState<AdminSettingsForm>(() => formFromSettings(data));
  const [problems, setProblems] = useState<ReturnType<typeof adminSettingsProblems>>([]);
  const patch = (p: Partial<AdminSettingsForm>) => setForm((f) => ({ ...f, ...p }));

  const save = useMutation({
    mutationFn: () =>
      operatorFetch('/settings/catalog', {
        method: 'PATCH',
        body: buildSettingsUpdate(form, data.rowVersion),
        schema: catalogSettingsResponseSchema,
      }),
    onSuccess: async () => {
      toast.success(t('saved'));
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: async (e) => {
      const key = failureKey(e);
      toast.error(t(`errors.${key}`));
      if (key === 'conflict') await qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = adminSettingsProblems(form);
    setProblems(found);
    if (found.length === 0) save.mutate();
  };
  const reset = () => {
    setForm(formFromSettings(data));
    setProblems([]);
  };
  const lock = !canEdit;

  return (
    <form
      onSubmit={submit}
      onReset={(e) => {
        e.preventDefault();
        reset();
      }}
      noValidate
      className="space-y-5"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className={`${KICKER} mb-2`}>{t('eyebrow')}</div>
          <h1 className="font-serif text-[28px] font-normal leading-none tracking-tight sm:text-[34px] lg:text-[40px]">
            {t('titleLead')}{' '}
            <span className="italic text-brand dark:text-primary">{t('titleAccent')}</span>.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
            {t.rich('intro', {
              link: (c) => (
                <Link href="/catalog" className="text-brand underline dark:text-primary">
                  {c}
                </Link>
              ),
            })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">
          <Link
            href="/admin/settings"
            className="rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
          >
            {t('allSettings')}
          </Link>
          <Link
            href="/catalog"
            className="rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
          >
            {t('openCatalog')}
          </Link>
          <Button
            type="reset"
            variant="secondary"
            className="rounded-full text-[12px]"
            disabled={lock}
          >
            {t('reset')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            className="rounded-full text-[12px]"
            disabled={lock || save.isPending}
          >
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </div>
      </div>

      {lock && <Alert tone="info">{t('superOnly')}</Alert>}
      {problems.length > 0 && (
        <Alert tone="danger" role="alert">
          <div className="mb-1 font-semibold">{t('fix')}</div>
          <ul className="list-disc ps-5">
            {problems.map((p) => (
              <li key={p}>{t(`problems.${p}`)}</li>
            ))}
          </ul>
        </Alert>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="catalog-admin-usage">
        <Tile
          label={t('usage.connected')}
          value={data.usage.workspacesConnected}
          hint={t('usage.connectedHint')}
        />
        <Tile
          label={t('usage.products')}
          value={data.usage.productsSynced}
          hint={t('usage.productsHint')}
        />
        <Tile
          label={t('usage.sends')}
          value={data.usage.messagesSent}
          hint={t('usage.sendsHint')}
        />
      </section>

      <section className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className={KICKER}>{t('gate.kicker')}</div>
                <h2 className="mt-1 font-serif text-[25px] font-normal leading-tight">
                  {t('gate.title')}
                </h2>
              </div>
              <label className="flex items-center gap-2">
                <span className="text-[12px]">{t('gate.enabled')}</span>
                <Switch
                  checked={form.catalogEnabled}
                  onCheckedChange={(v) => patch({ catalogEnabled: v })}
                  label={t('gate.enabled')}
                  disabled={lock}
                />
              </label>
            </div>
            <div className="space-y-3 p-5 text-[12.5px] leading-relaxed">
              <p>
                {t.rich('gate.body', {
                  link: (c) => (
                    <Link
                      href="/catalog"
                      className="font-medium text-brand underline dark:text-primary"
                    >
                      {c}
                    </Link>
                  ),
                })}
              </p>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="text-[12.5px] font-semibold">{t('gate.commerce')}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t('gate.commerceHint')}
                  </div>
                </div>
                <Switch
                  checked={form.commerceEnabled}
                  onCheckedChange={(v) => patch({ commerceEnabled: v })}
                  label={t('gate.commerce')}
                  disabled={lock}
                />
              </div>
            </div>
          </Card>

          <Section kicker={t('api.kicker')} title={t('api.title')} intro={t('api.intro')}>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Field
                label={t('api.version')}
                htmlFor={`${id}-version`}
                hint={t('api.versionHint')}
                error={problems.includes('graphVersion') ? t('problems.graphVersion') : undefined}
              >
                <Input
                  id={`${id}-version`}
                  dir="ltr"
                  className="font-mono"
                  value={form.graphApiVersion}
                  placeholder="v23.0"
                  invalid={problems.includes('graphVersion')}
                  disabled={lock}
                  onChange={(e) => patch({ graphApiVersion: e.target.value })}
                />
              </Field>
              <Field
                label={t('api.currency')}
                htmlFor={`${id}-currency`}
                hint={t('api.currencyHint')}
                error={problems.includes('currency') ? t('problems.currency') : undefined}
              >
                <Input
                  id={`${id}-currency`}
                  dir="ltr"
                  className="font-mono uppercase"
                  maxLength={3}
                  value={form.defaultCurrency}
                  placeholder="USD"
                  invalid={problems.includes('currency')}
                  disabled={lock}
                  onChange={(e) => patch({ defaultCurrency: e.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section kicker={t('app.kicker')} title={t('app.title')} intro={t('app.intro')}>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Field label={t('app.id')} htmlFor={`${id}-appid`} hint={t('app.idHint')}>
                <Input
                  id={`${id}-appid`}
                  dir="ltr"
                  className="font-mono"
                  maxLength={APP_ID_MAX}
                  value={form.metaAppId}
                  placeholder="123456789012345"
                  disabled={lock}
                  onChange={(e) => patch({ metaAppId: e.target.value })}
                />
              </Field>
              <Field label={t('app.secret')} htmlFor={`${id}-secret`} hint={t('app.secretHint')}>
                <PasswordInput
                  id={`${id}-secret`}
                  dir="ltr"
                  className="font-mono"
                  autoComplete="new-password"
                  maxLength={APP_SECRET_MAX}
                  value={form.metaAppSecret}
                  placeholder={
                    data.metaAppSecretSet ? t('app.secretSaved') : t('app.secretPlaceholder')
                  }
                  disabled={lock}
                  onChange={(e) => patch({ metaAppSecret: e.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section kicker={t('walk.kicker')} title={t('walk.title')} intro={t('walk.intro')}>
            <ol className="divide-y divide-border">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-start gap-4 px-5 py-4">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-[12px] font-semibold text-brand dark:text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{t(`walk.${s}.title`)}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                      {t(`walk.${s}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[88px]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3">
              <div className={KICKER}>{t('side.archKicker')}</div>
              <h3 className="mt-0.5 font-serif text-[18px] font-normal leading-tight">
                {t('side.archTitle')}
              </h3>
            </div>
            <div className="space-y-2.5 p-4 text-[12px]">
              <div>
                <div className="text-[12.5px] font-semibold">{t('side.here')}</div>
                <p className="mt-0.5 text-muted-foreground">{t('side.hereBody')}</p>
              </div>
              <div>
                <div className="text-[12.5px] font-semibold">{t('side.merchant')}</div>
                <p className="mt-0.5 text-muted-foreground">{t('side.merchantBody')}</p>
              </div>
            </div>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3">
              <div className={KICKER}>{t('side.payloadsKicker')}</div>
              <h3 className="mt-0.5 font-serif text-[16px] font-normal leading-tight">
                {t('side.payloadsTitle')}
              </h3>
            </div>
            <div className="space-y-3 p-4 text-[11.5px]">
              {(['spm', 'mpm', 'cta'] as const).map((k) => (
                <div key={k}>
                  <div className="text-[12px] font-semibold">{t(`side.payload.${k}.title`)}</div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground" dir="ltr">
                    {t(`side.payload.${k}.code`)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3">
              <div className={KICKER}>{t('side.docsKicker')}</div>
              <h3 className="mt-0.5 font-serif text-[16px] font-normal leading-tight">
                {t('side.docsTitle')}
              </h3>
            </div>
            <div className="space-y-1.5 p-4 text-[11.5px]">
              {DOCS.map((d) => (
                <a
                  key={d}
                  href={DOC_URL[d]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-brand hover:underline dark:text-primary"
                >
                  {t(`side.docs.${d}`)}
                </a>
              ))}
            </div>
          </Card>
          <div className="rounded-2xl border border-success/40 bg-success/10 p-4">
            <div className="text-[12.5px] font-semibold">{t('side.constraintsTitle')}</div>
            <ul className="mt-1 list-disc space-y-1 ps-4 text-[11.5px] text-muted-foreground">
              {(['public', 'currency', 'images', 'goods', 'verification'] as const).map((c) => (
                <li key={c}>{t(`side.constraints.${c}`)}</li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </form>
  );
}

/** The operator console's "WhatsApp Catalog" settings (WD-CAT-030): the feature switches, the Graph version and the usage tiles. */
export function CatalogAdminSettings() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/catalog', { schema: catalogSettingsResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert">
        <p>{t(`errors.${failureKey(q.error)}`)}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  // Remounted on every new version so a save or a conflict leaves the form showing what the server holds.
  return (
    <div className="mx-auto max-w-6xl">
      <SettingsForm key={q.data.rowVersion} data={q.data} canEdit={canEdit} />
    </div>
  );
}
