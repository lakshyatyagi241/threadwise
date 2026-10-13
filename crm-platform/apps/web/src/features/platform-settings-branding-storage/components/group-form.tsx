'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activeLanguagesResponseSchema,
  publicSiteConfigSchema,
  setGroupResponseSchema,
  setTestResultSchema,
  type SetGroupResponse,
  type SetTestResult,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  PasswordInput,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import {
  countryOptions,
  timeZoneOptions,
} from '@/features/auth-registration-security/platform/lib/zones-countries';
import {
  ToggleRow,
  Section,
} from '@/features/auth-registration-security/platform/settings/section-parts';
import { allFields, type FieldSpec, type GroupSpec, type SectionSpec } from '../fields';
import { buildPatch, fieldForPath, patchSize, toDraft, type Draft } from '../lib/draft';
import { groupKey, hubKey } from '../lib/query-keys';
import { downloadSitemap } from '../lib/sitemap-download';
import { AppearancePreview, PALETTE_DEFAULTS, ResetColours } from './appearance-preview';
import { BrandAssets } from './brand-assets';
import { ConnectionTest } from './connection-test';
import { GoogleCallback } from './google-callback';
import { Counter, GuideCard, SetHeader, TipCard } from './page-parts';
import { SeoPreview } from './seo-preview';
import { TeamInboxApp } from './team-inbox-app';
import { WabaCallback } from './waba-callback';

const NS = 'platform-settings-branding-storage';

/** One settings page: loads the group, edits it as a draft, saves only what changed under the rowVersion. */
export function GroupSettingsPage({ spec }: { spec: GroupSpec }) {
  const q = useQuery({
    queryKey: groupKey(spec.group),
    queryFn: ({ signal }) =>
      operatorFetch(`/settings/groups/${spec.group}`, { schema: setGroupResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  // `key` restarts the draft whenever the server copy is replaced (after a save or a reload).
  return <GroupForm key={q.data.rowVersion} spec={spec} data={q.data} />;
}

function safeDial(code: string): string {
  try {
    return String(getCountryCallingCode(code as CountryCode));
  } catch {
    return '';
  }
}

function GroupForm({ spec, data }: { spec: GroupSpec; data: SetGroupResponse }) {
  const t = useTranslations(NS);
  const tg = useTranslations(`${NS}.groups.${spec.group}`);
  const tp = useTranslations(`${NS}.pages.${spec.id}`);
  const format = useFormatter();
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';

  const [draft, setDraft] = useState<Draft>(() => toDraft(data.values, spec));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const [fatal, setFatal] = useState<{ requestId?: string } | null>(null);
  const [tested, setTested] = useState<SetTestResult | null>(null);

  const built = useMemo(() => buildPatch(data.values, draft, spec), [data.values, draft, spec]);
  const dirty = patchSize(built) + Object.keys(built.problems).length > 0;
  useUnsavedGuard(dirty);
  const zones = useMemo(
    () => timeZoneOptions(String(data.values.defaultTimezone ?? 'UTC')),
    [data.values.defaultTimezone],
  );
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const languages = useQuery({
    queryKey: ['public', 'i18n', 'languages'],
    enabled: allFields(spec).some((f) => f.kind === 'language'),
    queryFn: async () => {
      const res = await fetch('/api/v2/i18n/languages', {
        headers: { Accept: 'application/json' },
      });
      return activeLanguagesResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
  });
  // The SEO preview and the sitemap need the saved brand name and site address.
  const siteConfig = useQuery({
    queryKey: ['public', 'site-config'],
    enabled: spec.sections.some((s) => s.custom === 'seoPreview'),
    queryFn: async () => {
      const res = await fetch('/api/v2/public/site-config', {
        headers: { Accept: 'application/json' },
      });
      return publicSiteConfigSchema.parse(await res.json());
    },
    staleTime: 30_000,
  });

  const setField = (key: string, value: string | boolean) => {
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };
  const setSecret = (key: string, value: string) =>
    setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: value } }));
  const setClear = (key: string, value: boolean) =>
    setDraft((d) => ({ ...d, clear: { ...d.clear, [key]: value } }));

  const label = (f: FieldSpec) => tg(`fields.${f.key}.label`);
  const hint = (f: FieldSpec) =>
    tg.has(`fields.${f.key}.hint`) ? tg(`fields.${f.key}.hint`) : undefined;
  const optionLabel = (f: FieldSpec, o: string) =>
    tg.has(`options.${f.key}.${o || 'none'}`)
      ? tg(`options.${f.key}.${o || 'none'}`)
      : o === ''
        ? '-'
        : o;

  const save = useMutation({
    mutationFn: (body: { rowVersion: number; values: unknown; secrets: unknown }) =>
      operatorFetch(`/settings/groups/${spec.group}`, {
        method: 'PATCH',
        body,
        schema: setGroupResponseSchema,
      }),
    onSuccess: (next, body) => {
      qc.setQueryData(groupKey(spec.group), next);
      void qc.invalidateQueries({ queryKey: hubKey });
      void qc.invalidateQueries({ queryKey: ['public', 'site-config'] });
      setErrors({});
      setBanner(null);
      setFatal(null);
      setConflict(false);
      toast.success(
        t('common.saved', {
          count:
            Object.keys(body.values as object).length + Object.keys(body.secrets as object).length,
        }),
      );
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ROW_VERSION_CONFLICT') {
        setConflict(true);
        setFatal(null);
      } else if (err instanceof ApiError && err.status === 422) {
        const next: Record<string, string> = {};
        const items: string[] = [];
        for (const fe of err.fieldErrors) {
          const key = fieldForPath(fe.path, spec);
          const f = key ? allFields(spec).find((x) => x.key === key) : undefined;
          items.push(f ? `${label(f)}: ${fe.message}` : fe.message);
          if (key && !next[key]) next[key] = fe.message;
        }
        setErrors(next);
        setBanner(items);
        setFatal(null);
      } else if (!(err instanceof ApiError && err.code === 'UNAUTHENTICATED')) {
        setFatal({ requestId: err instanceof ApiError ? err.requestId : undefined });
      }
    },
  });

  /** The request body when the draft is valid and has something to send, else null (and shows why). */
  function prepare(): { rowVersion: number; values: unknown; secrets: unknown } | null {
    const problemKeys = Object.keys(built.problems);
    if (problemKeys.length > 0) {
      const next: Record<string, string> = {};
      for (const k of problemKeys) {
        next[k] = t(
          built.problems[k] === 'required' ? 'common.numberRequired' : 'common.numberInteger',
        );
      }
      setErrors(next);
      setBanner(
        problemKeys.map((k) => {
          const f = allFields(spec).find((x) => x.key === k)!;
          return `${label(f)}: ${next[k]}`;
        }),
      );
      return null;
    }
    if (patchSize(built) === 0) return null;
    setBanner(null);
    return { rowVersion: data.rowVersion, values: built.values, secrets: built.secrets };
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const body = prepare();
    if (body) save.mutate(body);
  }

  /** "Save & test connection" (storage, real-time): save what changed, then check the saved credentials. */
  const saveAndTest = useMutation({
    mutationFn: async () => {
      if (dirty) {
        const body = prepare();
        if (!body) throw new Error('invalid');
        await save.mutateAsync(body);
      }
      return operatorFetch(`/settings/${spec.test}/test`, {
        method: 'POST',
        schema: setTestResultSchema,
      });
    },
    onSuccess: (r) => {
      setTested(r);
      void qc.invalidateQueries({ queryKey: hubKey });
      void qc.invalidateQueries({ queryKey: groupKey(spec.group) });
    },
  });

  const reset = () => {
    setDraft(toDraft(data.values, spec));
    setErrors({});
    setBanner(null);
  };

  const resetColours = () =>
    setDraft((d) => ({
      ...d,
      fields: Object.fromEntries(
        Object.entries(d.fields).map(([k, v]) => [k, k.startsWith('colors.') ? '' : v]),
      ),
    }));

  const control = (f: FieldSpec) => {
    const id = `set-${spec.id}-${f.key}`;
    const err = errors[f.key] || undefined;
    const value = draft.fields[f.key];
    if (f.kind === 'toggle') {
      return (
        <ToggleRow
          key={f.key}
          id={id}
          label={
            spec.id === 'storage' && f.key === 'enabled'
              ? tp(value === true ? 'status.enabled' : 'status.disabled')
              : label(f)
          }
          hint={hint(f)}
          checked={value === true}
          onChange={(v) => setField(f.key, v)}
          disabled={!canEdit}
          error={err}
        />
      );
    }
    let input: ReactNode;
    if (f.kind === 'secret') {
      const isSet = data.secrets[f.key]?.isSet === true;
      input = (
        <div className="space-y-2">
          <PasswordInput
            id={id}
            value={draft.secrets[f.key] ?? ''}
            onChange={(e) => setSecret(f.key, e.target.value)}
            readOnly={!canEdit}
            disabled={draft.clear[f.key] === true}
            autoComplete="new-password"
            placeholder={
              isSet
                ? '••••••••'
                : tg.has(`fields.${f.key}.placeholder`)
                  ? tg(`fields.${f.key}.placeholder`)
                  : ''
            }
            showLabel={t('common.secretShow')}
            hideLabel={t('common.secretHide')}
          />
          <p className="text-xs text-muted-foreground">
            {isSet ? t('common.secretSet') : t('common.secretUnset')}
          </p>
          {isSet && canEdit && (
            <Checkbox
              id={`${id}-clear`}
              checked={draft.clear[f.key] === true}
              onChange={(e) => setClear(f.key, e.target.checked)}
              label={t('common.secretClear')}
            />
          )}
        </div>
      );
    } else if (f.kind === 'language') {
      const current = String(value ?? '');
      const list = languages.data?.data ?? [];
      const known = list.some((l) => l.code === current);
      input = (
        <div className="space-y-1">
          <Select
            id={id}
            value={current}
            onChange={(e) => setField(f.key, e.target.value)}
            disabled={!canEdit}
            invalid={Boolean(err)}
          >
            {list.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.code})
              </option>
            ))}
            {!known && current && (
              <option value={current}>
                {current} ({t('common.custom')})
              </option>
            )}
          </Select>
          <Link
            href="/admin/i18n/languages"
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {t('common.manageLanguages')}
          </Link>
        </div>
      );
    } else if (f.kind === 'country') {
      const current = String(value ?? '').toUpperCase();
      input = (
        <Select
          id={id}
          value={current}
          onChange={(e) => {
            const iso = e.target.value;
            setField(f.key, iso.toLowerCase());
            const dial = safeDial(iso);
            if (dial) setField('defaultCountryCode', `+${dial}`);
          }}
          disabled={!canEdit}
          invalid={Boolean(err)}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} (+{safeDial(c.code)})
            </option>
          ))}
        </Select>
      );
    } else if (f.kind === 'select' || f.kind === 'timezone') {
      const current = String(value ?? '');
      const base = f.kind === 'timezone' ? zones : [...(f.options ?? [])];
      const options = base.includes(current) ? base : [...base, current];
      input = (
        <Select
          id={id}
          value={current}
          onChange={(e) => setField(f.key, e.target.value)}
          disabled={!canEdit}
          invalid={Boolean(err)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {f.kind === 'timezone' ? o : optionLabel(f, o)}
            </option>
          ))}
        </Select>
      );
    } else if (f.kind === 'range') {
      input = (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={f.min}
            max={f.max}
            value={Number(value) || f.min}
            onChange={(e) => setField(f.key, e.target.value)}
            disabled={!canEdit}
            className="h-2 flex-1 cursor-pointer accent-primary"
          />
          <span className="w-12 text-end font-mono text-xs tabular-nums">{String(value)}%</span>
        </div>
      );
    } else if (f.kind === 'cards') {
      input = (
        <div role="radiogroup" aria-label={label(f)} className="grid gap-3 sm:grid-cols-2">
          {(f.options ?? []).map((o) => {
            const on = String(value) === o;
            return (
              <label
                key={o}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm',
                  on ? 'border-primary bg-primary/5' : 'border-border',
                  !canEdit && 'cursor-not-allowed opacity-70',
                )}
              >
                <span className="flex items-center justify-between font-semibold">
                  {optionLabel(f, o)}
                  <input
                    type="radio"
                    name={id}
                    value={o}
                    checked={on}
                    disabled={!canEdit}
                    onChange={() => setField(f.key, o)}
                    className="accent-primary"
                  />
                </span>
                {tg.has(`optionNotes.${f.key}.${o}`) && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {tg(`optionNotes.${f.key}.${o}`)}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      );
    } else if (f.kind === 'textarea') {
      input = (
        <Textarea
          id={id}
          value={String(value ?? '')}
          onChange={(e) => setField(f.key, e.target.value)}
          readOnly={!canEdit}
          invalid={Boolean(err)}
          rows={f.mono ? 14 : 3}
          spellCheck={false}
          className={cn(f.mono && 'font-mono')}
        />
      );
    } else if (f.kind === 'color') {
      const hex = String(value ?? '');
      // A blank colour shows the shipped one in the swatch and the placeholder (Reference shows its default the same way).
      const shipped = f.key.startsWith('colors.')
        ? (PALETTE_DEFAULTS[f.key.slice(7)] ?? '')
        : f.key === 'sidebarColor'
          ? '#06100E'
          : f.key === 'sidebarTextColor'
            ? '#FFFFFF'
            : f.key === 'sidebarAccentColor'
              ? '#A7E8C0'
              : '';
      // Reference labels the two derived sidebar colours instead of showing a hex.
      const hint =
        f.key === 'sidebarTextColor'
          ? 'Auto (contrast)'
          : f.key === 'sidebarAccentColor'
            ? 'Default green'
            : shipped || '#RRGGBB';
      input = (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label(f)}
            value={
              /^#[0-9A-Fa-f]{6}$/.test(hex)
                ? hex
                : /^#[0-9A-Fa-f]{6}$/.test(shipped)
                  ? shipped
                  : '#000000'
            }
            onChange={(e) => setField(f.key, e.target.value.toUpperCase())}
            disabled={!canEdit}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-background p-1"
          />
          <Input
            id={id}
            value={hex}
            onChange={(e) => setField(f.key, e.target.value)}
            readOnly={!canEdit}
            invalid={Boolean(err)}
            placeholder={hint}
            spellCheck={false}
            className="font-mono"
          />
        </div>
      );
    } else {
      input = (
        <Input
          id={id}
          type={f.kind === 'number' ? 'number' : f.kind === 'email' ? 'email' : 'text'}
          inputMode={f.kind === 'number' ? 'numeric' : undefined}
          min={f.min}
          max={f.max}
          value={String(value ?? '')}
          onChange={(e) => setField(f.key, e.target.value)}
          readOnly={!canEdit}
          invalid={Boolean(err)}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            tg.has(`fields.${f.key}.placeholder`) ? tg(`fields.${f.key}.placeholder`) : undefined
          }
          className={cn((f.mono || f.kind === 'url') && 'font-mono')}
        />
      );
    }
    const counter =
      f.counter !== undefined ? (
        <Counter length={String(value ?? '').length} range={f.counter} />
      ) : null;
    return (
      <Field
        key={f.key}
        label={label(f)}
        htmlFor={id}
        hint={
          counter ? (
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{hint(f)}</span>
              {counter}
            </span>
          ) : (
            hint(f)
          )
        }
        error={err}
      >
        {input}
      </Field>
    );
  };

  const fieldsGrid = (s: SectionSpec) => {
    const toggles = s.fields.filter((f) => f.kind === 'toggle');
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {s.fields
          .filter((f) => !f.hidden)
          .map((f) => (
            <div
              key={f.key}
              className={cn(
                !(f.half || (f.kind === 'toggle' && toggles.length > 1)) && 'sm:col-span-2',
              )}
            >
              {control(f)}
            </div>
          ))}
      </div>
    );
  };

  const renderSection = (s: SectionSpec) => {
    const title = tp(`sections.${s.id}.title`);
    let description = tp.has(`sections.${s.id}.description`)
      ? tp(`sections.${s.id}.description`)
      : undefined;
    if (spec.id === 'storage' && s.id === 'provider') {
      const on = draft.fields.enabled === true;
      const provider = String(draft.fields.provider ?? '');
      const hasConfig =
        Boolean(draft.fields.bucket || draft.fields.accessKeyId || draft.fields.storageZone) ||
        data.secrets.secret?.isSet === true;
      const name = tg.has(`options.provider.${provider}`)
        ? tg(`options.provider.${provider}`)
        : provider;
      description = on
        ? tp('status.active', { provider: name })
        : hasConfig
          ? tp('status.configured')
          : tp('status.local');
    }
    let body: ReactNode;
    if (s.custom === 'brandAssets') body = <BrandAssets canEdit={canEdit} />;
    else if (s.custom === 'teamInboxApp') body = <TeamInboxApp canEdit={canEdit} />;
    else if (s.custom === 'wabaCallback')
      body = (
        <div className="space-y-4">
          <WabaCallback />
          {fieldsGrid(s)}
        </div>
      );
    else if (s.custom === 'googleCallback')
      body = (
        <div className="space-y-4">
          <GoogleCallback uri={String(data.extra?.redirectUri ?? '')} />
          {fieldsGrid(s)}
        </div>
      );
    else if (s.custom === 'microsoftCallback')
      body = (
        <div className="space-y-4">
          <GoogleCallback
            uri={String(data.extra?.redirectUri ?? '')}
            ns="platform-settings-branding-storage.microsoftCallback"
          />
          {fieldsGrid(s)}
        </div>
      );
    else if (s.custom === 'signupLink') {
      body = (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t('signup.body')}</p>
          <Link
            href="/admin/settings/registration"
            className="inline-block text-primary underline-offset-2 hover:underline"
          >
            {t('signup.link')}
          </Link>
        </div>
      );
    } else if (s.custom === 'seoPreview') {
      body = (
        <SeoPreview
          brand={siteConfig.data?.brand.name ?? ''}
          baseUrl={siteConfig.data?.brand.url ?? ''}
          fields={draft.fields}
        />
      );
    } else {
      body = fieldsGrid(s);
    }
    return (
      <Section
        key={s.id}
        kicker={s.eyebrow?.replace(/-/g, ' ') ?? tp('title')}
        title={title}
        description={description}
      >
        {body}
      </Section>
    );
  };

  const guideItems = spec.guide.map((g) => ({
    title: tp(`guide.items.${g}.title`),
    body: tp(`guide.items.${g}.body`),
  }));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <SetHeader
        eyebrow={tp.has('eyebrow') ? tp('eyebrow') : t('common.eyebrow')}
        title={tp('title')}
        description={tp('description')}
        actions={
          <>
            <Link
              href="/admin/settings"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              {t('common.back')}
            </Link>
            {spec.test && spec.test !== 'mail' && canEdit && (
              <Button
                type="button"
                variant="secondary"
                disabled={saveAndTest.isPending || save.isPending}
                onClick={() => saveAndTest.mutate()}
              >
                {saveAndTest.isPending && <Spinner label={t('test.running')} />}
                {t('common.saveAndTest')}
              </Button>
            )}
            {dirty && canEdit && (
              <Button type="button" variant="secondary" onClick={reset}>
                {t('common.resetDraft')}
              </Button>
            )}
            <Button type="submit" disabled={!canEdit || !dirty || save.isPending}>
              {save.isPending && <Spinner label={t('common.saving')} />}
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      />
      <p className="text-xs text-muted-foreground">
        {data.updatedAt
          ? t('common.updated', {
              when: format.dateTime(new Date(data.updatedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('common.neverSaved')}
      </p>

      {!canEdit && <Alert tone="info">{t('common.readOnly')}</Alert>}
      {conflict && (
        <Alert tone="danger" className="space-y-2">
          <p>{t('common.conflict')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: groupKey(spec.group) });
              setConflict(false);
            }}
          >
            {t('common.reload')}
          </Button>
        </Alert>
      )}
      {banner && (
        <Alert tone="danger" className="space-y-2">
          <p className="font-semibold">
            {t('common.rejected', { count: Math.max(1, banner.length) })}
          </p>
          <ul className="list-disc space-y-0.5 ps-5 text-xs">
            {banner.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {fatal && (
        <Alert tone="danger" className="space-y-1">
          <p>{t('common.unexpected')}</p>
          {fatal.requestId && (
            <p className="text-xs opacity-80">
              {t('common.requestId')}: <span className="font-mono">{fatal.requestId}</span>
            </p>
          )}
        </Alert>
      )}
      {tested && (
        <Alert tone={tested.ok ? 'success' : 'danger'}>
          <span className="font-semibold">{tested.ok ? t('test.ok') : t('test.failed')}</span>
          {tested.message ? `: ${tested.message}` : ''}
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {spec.sections.map(renderSection)}
          {spec.test === 'mail' && canEdit && (
            <ConnectionTest test="mail" saved={data} unsaved={dirty} />
          )}
        </div>
        <div className="space-y-4">
          {spec.appearanceAside && <AppearancePreview fields={draft.fields} />}
          <GuideCard kicker={t('common.guide')} title={tp('guide.title')} items={guideItems} />
          {spec.appearanceAside && <ResetColours disabled={!canEdit} onReset={resetColours} />}
          {spec.id === 'seo' && (
            <GuideCard
              kicker={t('seoPreview.sitemapKicker')}
              title={t('seoPreview.sitemapTitle')}
              items={[
                {
                  title: t('seoPreview.sitemapFile'),
                  body: (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => void downloadSitemap(siteConfig.data?.brand.url ?? '')}
                      >
                        {t('seoPreview.download')}
                      </button>
                      <a
                        href="/sitemap.xml"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        /sitemap.xml
                      </a>
                      <a
                        href="/robots.txt"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        /robots.txt
                      </a>
                    </span>
                  ),
                },
              ]}
            />
          )}
          {tp.has('tip.title') && <TipCard title={tp('tip.title')} body={tp('tip.body')} />}
        </div>
      </div>

      {dirty && canEdit && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-sm text-muted-foreground">{t('common.applyAfterSave')}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={reset}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
