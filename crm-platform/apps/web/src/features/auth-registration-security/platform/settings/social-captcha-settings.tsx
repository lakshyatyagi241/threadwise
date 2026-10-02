'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  socialCaptchaSettingsResponseSchema,
  type SocialCaptchaSettingsResponse,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PasswordInput,
  Select,
  Spinner,
  Switch,
  cn,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  SOCIAL_FIELD_MAX,
  buildSocialPatch,
  clearSecretPatch,
  redirectUri,
  socialPatchSize,
  socialToDraft,
  type Provider,
  type SecretTarget,
  type SocialDraft,
  type SocialProblem,
} from '../lib/social-draft';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { OFFICIAL_DOCS } from '../lib/social-docs';
import { CheckIcon } from '../ui/icons';
import { CopyButton } from '../ui/copy-button';
import { RemoveSecret } from './remove-secret';
import { PageHeader } from '../ui/page-header';
import { ReadOnlyNotice } from '../ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { useOrigin } from '../ui/use-browser';
import { useUnsavedGuard } from '../ui/use-unsaved-guard';

const NS = 'auth-registration-security.platform.social';
const KEY = ['operator', 'settings', 'social-captcha'] as const;
type Errors = Record<string, string | undefined>;

export function SocialCaptchaSettingsPage() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/social-captcha', {
        schema: socialCaptchaSettingsResponseSchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending)
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <SocialCaptchaForm settings={q.data} />;
}

function ProviderCard({
  mark,
  kicker,
  title,
  enable,
  children,
}: {
  mark: ReactNode;
  kicker: string;
  title: string;
  enable: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold"
          >
            {mark}
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {kicker}
            </p>
            <h2 className="truncate text-lg font-semibold leading-tight">{title}</h2>
          </div>
        </div>
        {enable}
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">{children}</div>
    </Card>
  );
}

function SocialCaptchaForm({ settings }: { settings: SocialCaptchaSettingsResponse }) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('social');
  const [draft, setDraft] = useState<SocialDraft>(() => socialToDraft(settings));
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ count: number; items: string[] } | null>(null);
  const [saveError, setSaveError] = useState<{ requestId?: string } | null>(null);
  const origin = useOrigin();

  const { patch, problems: draftProblems } = buildSocialPatch(settings, draft);
  const changed = socialPatchSize(patch) + Object.keys(draftProblems).length;
  useUnsavedGuard(changed > 0);
  const dis = !canEdit;

  const edit = (mutate: (d: SocialDraft) => SocialDraft, path?: string) => {
    setDraft(mutate);
    if (path) setErrors((e) => (e[path] ? { ...e, [path]: undefined } : e));
  };
  const setProvider = (
    name: Provider,
    field: 'enabled' | 'clientId' | 'clientSecret',
    value: boolean | string,
  ) => edit((d) => ({ ...d, [name]: { ...d[name], [field]: value } }), `${name}.${field}`);
  const setCaptcha = (field: keyof SocialDraft['recaptcha'], value: boolean | string) =>
    edit(
      (d) => ({ ...d, recaptcha: { ...d.recaptcha, [field]: value } }),
      `recaptcha.${field === 'secret' ? 'secret' : field}`,
    );

  const problemText = (p: SocialProblem) =>
    p.code === 'tooLong' ? tp('tooLong', { max: p.max }) : tp('threshold');
  const labelOf = (path: string) => (t.has(`labels.${path}`) ? t(`labels.${path}`) : path);
  const focusPath = (path: string | undefined) => {
    if (!path) return;
    setTimeout(() => {
      const el = document.getElementById(`social-${path.replace('.', '-')}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  const save = useMutation({
    mutationFn: (body: typeof patch) =>
      operatorFetch('/settings/social-captcha', {
        method: 'PATCH',
        body,
        schema: socialCaptchaSettingsResponseSchema,
      }),
    onSuccess: (data, body) => {
      qc.setQueryData(KEY, data);
      setDraft(socialToDraft(data));
      setErrors({});
      setBanner(null);
      setSaveError(null);
      toast.success(t('saved', { count: socialPatchSize(body) }));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const next: Errors = {};
        const items: string[] = [];
        for (const fe of err.fieldErrors) {
          items.push(`${labelOf(fe.path)}: ${fe.message}`);
          if (!next[fe.path]) next[fe.path] = fe.message;
        }
        setErrors(next);
        setSaveError(null);
        setBanner({ count: Math.max(1, err.fieldErrors.length), items });
        focusPath(Object.keys(next)[0]);
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        /* operatorFetch is sending the person to sign in */
      } else {
        setSaveError({ requestId: err instanceof ApiError ? err.requestId : undefined });
      }
    },
  });

  /** Deletes one saved secret on the server. The form's own edits are left exactly as they are. */
  const removeSecret = async (target: SecretTarget) => {
    const data = await operatorFetch('/settings/social-captcha', {
      method: 'PATCH',
      body: clearSecretPatch(target),
      schema: socialCaptchaSettingsResponseSchema,
    });
    // Trust the response, not the status: a secret that is still reported as saved was not removed.
    const stillSaved = target === 'recaptcha' ? data.recaptcha.hasSecret : data[target].hasSecret;
    if (stillSaved) throw new ApiError(500, 'INTERNAL', 'The saved secret is still there');
    qc.setQueryData(KEY, data);
    // A secret typed for the same target would silently save a new one: drop it.
    setDraft((d) =>
      target === 'recaptcha'
        ? { ...d, recaptcha: { ...d.recaptcha, secret: '' } }
        : { ...d, [target]: { ...d[target], clientSecret: '' } },
    );
    toast.success(t('removeSecret.done', { name: t(`removeSecret.names.${target}`) }));
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const { patch: body, problems } = buildSocialPatch(settings, draft);
    const paths = Object.keys(problems);
    if (paths.length > 0) {
      const next: Errors = {};
      for (const p of paths) next[p] = problemText(problems[p]!);
      setErrors(next);
      setSaveError(null);
      setBanner({ count: paths.length, items: paths.map((p) => `${labelOf(p)}: ${next[p]}`) });
      focusPath(paths[0]);
      return;
    }
    if (socialPatchSize(body) === 0) return;
    setErrors({});
    setBanner(null);
    save.mutate(body);
  }

  const secretPlaceholder = (hasSecret: boolean, empty: string) =>
    hasSecret ? t('secretSaved') : empty;

  const providerFields = (name: Provider, hasSecret: boolean) => (
    <>
      <Field
        label={t(`${name}.idLabel`)}
        htmlFor={`social-${name}-clientId`}
        hint={t(`${name}.idHint`)}
        error={errors[`${name}.clientId`]}
        className="sm:col-span-2"
      >
        <Input
          id={`social-${name}-clientId`}
          value={draft[name].clientId}
          onChange={(e) => setProvider(name, 'clientId', e.target.value)}
          placeholder={t(`${name}.idPlaceholder`)}
          invalid={Boolean(errors[`${name}.clientId`])}
          readOnly={dis}
          autoComplete="off"
          spellCheck={false}
          maxLength={SOCIAL_FIELD_MAX + 20}
          dir="ltr"
          className="font-mono"
        />
      </Field>
      <Field
        label={t(`${name}.secretLabel`)}
        htmlFor={`social-${name}-clientSecret`}
        hint={t('secretHint')}
        error={errors[`${name}.clientSecret`]}
        className="sm:col-span-2"
      >
        <PasswordInput
          id={`social-${name}-clientSecret`}
          value={draft[name].clientSecret}
          onChange={(e) => setProvider(name, 'clientSecret', e.target.value)}
          placeholder={secretPlaceholder(hasSecret, t(`${name}.secretPlaceholder`))}
          invalid={Boolean(errors[`${name}.clientSecret`])}
          readOnly={dis}
          autoComplete="new-password"
          showLabel={t('showSecret')}
          hideLabel={t('hideSecret')}
          dir="ltr"
          className="font-mono"
        />
        {hasSecret && canEdit && (
          <RemoveSecret target={name} live={settings[name].live} onRemove={removeSecret} />
        )}
      </Field>
      <div className="space-y-1.5 text-sm sm:col-span-2">
        <label htmlFor={`social-${name}-redirect`} className="block font-medium">
          {t(`${name}.redirectLabel`)}
        </label>
        <div className="flex gap-2">
          <Input
            id={`social-${name}-redirect`}
            value={origin ? redirectUri(origin, name) : ''}
            readOnly
            dir="ltr"
            className="min-w-0 flex-1 bg-muted font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton text={origin ? redirectUri(origin, name) : ''} disabled={!origin} />
        </div>
        <p className="text-xs text-muted-foreground">{t(`${name}.redirectHint`)}</p>
      </div>
    </>
  );

  const live = [
    { id: 'google', on: settings.google.live },
    { id: 'facebook', on: settings.facebook.live },
    { id: 'recaptcha', on: settings.recaptcha.live },
  ] as const;

  const enableSwitch = (id: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex shrink-0 cursor-pointer items-center gap-2.5 text-sm" htmlFor={id}>
      <span className="text-muted-foreground">{t('enable')}</span>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        label={t('enable')}
        disabled={dis}
      />
    </label>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <Button type="submit" disabled={!canEdit || changed === 0 || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {save.isPending ? t('saving') : t('save')}
          </Button>
        }
      />

      {!canEdit && <ReadOnlyNotice section="social" />}
      {banner && (
        <Alert tone="danger" className="space-y-2">
          <p className="font-semibold">{t('rejected', { count: banner.count })}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-xs">
            {banner.items.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {saveError && (
        <Alert tone="danger" className="space-y-1">
          <p>{t('errors.unexpected')}</p>
          {saveError.requestId && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{saveError.requestId}</span>
            </p>
          )}
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <ProviderCard
            mark="G"
            kicker={t('google.kicker')}
            title={t('google.title')}
            enable={enableSwitch('social-google-enabled', draft.google.enabled, (v) =>
              setProvider('google', 'enabled', v),
            )}
          >
            {providerFields('google', settings.google.hasSecret)}
          </ProviderCard>

          <ProviderCard
            mark="f"
            kicker={t('facebook.kicker')}
            title={t('facebook.title')}
            enable={enableSwitch('social-facebook-enabled', draft.facebook.enabled, (v) =>
              setProvider('facebook', 'enabled', v),
            )}
          >
            {providerFields('facebook', settings.facebook.hasSecret)}
          </ProviderCard>

          <ProviderCard
            mark={<CheckIcon />}
            kicker={t('recaptcha.kicker')}
            title={t('recaptcha.title')}
            enable={enableSwitch('social-recaptcha-enabled', draft.recaptcha.enabled, (v) =>
              setCaptcha('enabled', v),
            )}
          >
            <Field
              label={t('recaptcha.versionLabel')}
              htmlFor="social-recaptcha-version"
              hint={t('recaptcha.versionHint')}
            >
              <Select
                id="social-recaptcha-version"
                value={draft.recaptcha.version}
                onChange={(e) => setCaptcha('version', e.target.value)}
                disabled={dis}
              >
                <option value="v2">{t('recaptcha.versions.v2')}</option>
                <option value="v3">{t('recaptcha.versions.v3')}</option>
              </Select>
            </Field>
            <Field
              label={t('recaptcha.thresholdLabel')}
              htmlFor="social-recaptcha-v3Threshold"
              hint={t('recaptcha.thresholdHint')}
              error={errors['recaptcha.v3Threshold']}
            >
              <Input
                id="social-recaptcha-v3Threshold"
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.1}
                value={draft.recaptcha.v3Threshold}
                placeholder="0.5"
                onChange={(e) => setCaptcha('v3Threshold', e.target.value)}
                invalid={Boolean(errors['recaptcha.v3Threshold'])}
                readOnly={dis}
                className="font-mono"
              />
            </Field>
            <Field
              label={t('recaptcha.siteKeyLabel')}
              htmlFor="social-recaptcha-siteKey"
              hint={t('recaptcha.siteKeyHint')}
              error={errors['recaptcha.siteKey']}
              className="sm:col-span-2"
            >
              <Input
                id="social-recaptcha-siteKey"
                value={draft.recaptcha.siteKey}
                onChange={(e) => setCaptcha('siteKey', e.target.value)}
                placeholder="6L…"
                invalid={Boolean(errors['recaptcha.siteKey'])}
                readOnly={dis}
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="font-mono"
              />
            </Field>
            <Field
              label={t('recaptcha.secretLabel')}
              htmlFor="social-recaptcha-secret"
              hint={t('secretHint')}
              error={errors['recaptcha.secret']}
              className="sm:col-span-2"
            >
              <PasswordInput
                id="social-recaptcha-secret"
                value={draft.recaptcha.secret}
                onChange={(e) => setCaptcha('secret', e.target.value)}
                placeholder={secretPlaceholder(settings.recaptcha.hasSecret, '6L…')}
                invalid={Boolean(errors['recaptcha.secret'])}
                readOnly={dis}
                autoComplete="new-password"
                showLabel={t('showSecret')}
                hideLabel={t('hideSecret')}
                dir="ltr"
                className="font-mono"
              />
              {settings.recaptcha.hasSecret && canEdit && (
                <RemoveSecret
                  target="recaptcha"
                  live={settings.recaptcha.live}
                  onRemove={removeSecret}
                />
              )}
            </Field>
          </ProviderCard>

          <Card className="space-y-3">
            <header>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t('live.kicker')}
              </p>
              <h2 className="text-lg font-semibold leading-tight">{t('live.title')}</h2>
            </header>
            <ul className="grid gap-2 sm:grid-cols-3">
              {live.map((l) => (
                <li
                  key={l.id}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-center text-xs font-medium',
                    l.on
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  {l.on ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full border border-current"
                    />
                  )}
                  {t(`live.${l.id}`)}
                  <span className="sr-only">: {l.on ? t('live.yes') : t('live.no')}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('live.note')}</p>
          </Card>
        </div>

        <aside className="space-y-4">
          {(['google', 'facebook'] as const).map((p) => (
            <Card key={p} className="space-y-3">
              <header>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t('guide.kicker')}
                </p>
                <h3 className="text-base font-semibold leading-tight">{t(`guide.${p}.title`)}</h3>
              </header>
              <ol className="list-decimal space-y-1.5 ps-5 text-sm text-muted-foreground">
                <li>{t(`guide.${p}.step1`)}</li>
                <li>{t(`guide.${p}.step2`)}</li>
                <li>{t(`guide.${p}.step3`)}</li>
                <li>{t(`guide.${p}.step4`)}</li>
              </ol>
              <a
                href={
                  p === 'google'
                    ? 'https://console.cloud.google.com/apis/credentials'
                    : 'https://developers.facebook.com/apps'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                {t(`guide.${p}.link`)}
              </a>
            </Card>
          ))}
          <Card className="space-y-2">
            <h3 className="text-base font-semibold leading-tight">{t('guide.recaptcha.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('guide.recaptcha.body')}</p>
            <a
              href="https://www.google.com/recaptcha/admin"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              {t('guide.recaptcha.link')}
            </a>
          </Card>
          <Card className="space-y-2">
            <header>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t('docs.kicker')}
              </p>
              <h3 className="text-base font-semibold leading-tight">{t('docs.title')}</h3>
            </header>
            <ul className="space-y-1.5 text-sm">
              {OFFICIAL_DOCS.map((d) => (
                <li key={d.id}>
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t(`docs.links.${d.id}`)}
                    <span className="sr-only"> {t('docs.opensNewTab')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <div className="rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
            <Badge tone="neutral" className="mb-2">
              {t('guide.noSdk.badge')}
            </Badge>
            <p className="text-muted-foreground">{t('guide.noSdk.body')}</p>
          </div>
        </aside>
      </div>

      <div
        className={cn(
          'sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-2.5 shadow-lg',
          changed === 0 && 'hidden',
        )}
        aria-live="polite"
      >
        <span className="text-sm">{t('unsaved', { count: changed })}</span>
        <span className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(socialToDraft(settings));
              setErrors({});
              setBanner(null);
            }}
            disabled={save.isPending}
          >
            {t('discard')}
          </Button>
          <Button type="submit" size="sm" disabled={!canEdit || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {t('save')}
          </Button>
        </span>
      </div>
    </form>
  );
}
