'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authPagesResponseSchema,
  registrationConfigResponseSchema,
  type AuthPageName,
  type AuthPagesResponse,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea, cn } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { AuthShell } from '../../guest/auth-shell';
import {
  EXTRA_LIMIT,
  MEDIA_TYPES,
  MEDIA_URL_LIMIT,
  PAGES,
  REAL_PAGE_PATHS,
  SHOWCASE_GROUPS,
  SHOWCASE_GROUPS_BY_PAGE,
  SHOWCASE_PAGES,
  TEXT_LIMITS,
  authPagesFieldForPath,
  authPagesPatchSize,
  authPagesToDraft,
  buildAuthPagesPatch,
  guessMediaType,
  isHexColour,
  resolvePreviewContent,
  resolvePreviewExtra,
  type AuthPagesDraft,
  type AuthPagesProblem,
  type PageDefaults,
  type MediaType,
  type PageDraft,
  type ShowcasePage,
  type TextField as TextFieldName,
} from '../lib/auth-pages-draft';
import { REGISTRATION_SETTINGS_HREF } from '../lib/links';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { PageHeader } from '../ui/page-header';
import { ReadOnlyNotice } from '../ui/read-only-notice';
import { TabBar } from '../ui/tab-bar';
import { ErrorBlock, LoadingBlock } from '../ui/state';
import { useToast } from '../ui/toast';
import { useUnsavedGuard } from '../ui/use-unsaved-guard';
import { DesignPicker } from './design-picker';
import { PreviewForm } from './preview-form';
import { PreviewFonts } from './preview-fonts';
import { PreviewFrame, type PreviewDevice } from './preview-frame';

const NS = 'auth-registration-security.platform.authPages';
const KEY = ['operator', 'settings', 'auth-pages'] as const;
type Errors = Record<string, string | undefined>;

export function AuthPagesEditorPage({ fontClass }: { fontClass?: string } = {}) {
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/auth-pages', { schema: authPagesResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending)
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <AuthPagesForm data={q.data} fontClass={fontClass} />;
}

function AuthPagesForm({ data, fontClass }: { data: AuthPagesResponse; fontClass?: string }) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit('authPages');
  const [draft, setDraft] = useState<AuthPagesDraft>(() => authPagesToDraft(data));
  const [page, setPage] = useState<AuthPageName>('login');
  // This component only mounts once the settings have loaded in the browser, so reading the window here is safe.
  const [device, setDevice] = useState<PreviewDevice>(() =>
    window.innerWidth < 768 ? 'mobile' : 'desktop',
  );
  const [wide, setWide] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ count: number; items: string[] } | null>(null);
  const [saveError, setSaveError] = useState<{ requestId?: string } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const config = useQuery({
    queryKey: ['public', 'registration-config'],
    queryFn: ({ signal }) =>
      apiFetch('/auth/registration-config', { schema: registrationConfigResponseSchema, signal }),
    // The preview shows which providers and captcha are live, which another screen can change: look again on return.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const { patch, problems: draftProblems } = useMemo(
    () => buildAuthPagesPatch(data, draft),
    [data, draft],
  );
  const changed = authPagesPatchSize(patch) + Object.keys(draftProblems).length;
  useUnsavedGuard(changed > 0);
  const dis = !canEdit;

  const clearError = (control: string) =>
    setErrors((e) => (e[control] ? { ...e, [control]: undefined } : e));
  const setPageField = <K extends keyof PageDraft>(
    p: AuthPageName,
    key: K,
    value: PageDraft[K],
  ) => {
    setDraft((d) => ({ ...d, pages: { ...d.pages, [p]: { ...d.pages[p], [key]: value } } }));
    clearError(`${p}-${key}`);
  };
  const setExtra = (p: ShowcasePage, key: string, value: string) => {
    setDraft((d) => ({ ...d, extra: { ...d.extra, [p]: { ...d.extra[p], [key]: value } } }));
    clearError(`extra-${p}-${key}`);
  };

  // Focus the first rejected control once its page tab is showing.
  useEffect(() => {
    const control = pendingFocus.current;
    if (!control) return;
    const el = document.getElementById(`ap-${control}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [focusTick, page]);

  const reveal = (control: string, target: AuthPageName | null) => {
    if (target) setPage(target);
    pendingFocus.current = control;
    setFocusTick((n) => n + 1);
  };

  const problemText = (p: AuthPagesProblem) => (p === 'accent' ? tp('accent') : tp('mediaUrl'));
  const labelOf = (path: string) => {
    const m = /^(login|register|forgot)\.(\w+)$/.exec(path);
    if (m) return `${t(`pages.${m[1]}`)} / ${t.has(`fields.${m[2]}`) ? t(`fields.${m[2]}`) : m[2]}`;
    return path;
  };

  const save = useMutation({
    mutationFn: (body: typeof patch) =>
      operatorFetch('/settings/auth-pages', {
        method: 'PATCH',
        body,
        schema: authPagesResponseSchema,
      }),
    onSuccess: (next, body) => {
      qc.setQueryData(KEY, next);
      setDraft(authPagesToDraft(next));
      setErrors({});
      setBanner(null);
      setSaveError(null);
      toast.success(t('saved', { count: authPagesPatchSize(body) }));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const next: Errors = {};
        const items: string[] = [];
        let first: { control: string; page: AuthPageName | null } | null = null;
        for (const fe of err.fieldErrors) {
          const target = authPagesFieldForPath(fe.path);
          items.push(`${labelOf(fe.path)}: ${fe.message}`);
          if (target) {
            if (!next[target.control]) next[target.control] = fe.message;
            first ??= target;
          }
        }
        setErrors(next);
        setSaveError(null);
        setBanner({ count: Math.max(1, err.fieldErrors.length), items });
        if (first) reveal(first.control, first.page);
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        /* operatorFetch is sending the person to sign in */
      } else {
        setSaveError({ requestId: err instanceof ApiError ? err.requestId : undefined });
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const { patch: body, problems } = buildAuthPagesPatch(data, draft);
    const paths = Object.keys(problems);
    if (paths.length > 0) {
      const next: Errors = {};
      for (const p of paths) next[p.replace('.', '-')] = problemText(problems[p]!);
      setErrors(next);
      setSaveError(null);
      setBanner({
        count: paths.length,
        items: paths.map((p) => `${labelOf(p)}: ${next[p.replace('.', '-')]}`),
      });
      reveal(paths[0]!.replace('.', '-'), paths[0]!.split('.')[0] as AuthPageName);
      return;
    }
    if (authPagesPatchSize(body) === 0) return;
    setErrors({});
    setBanner(null);
    save.mutate(body);
  }

  const pageTabs = PAGES.map((p) => ({ id: p, label: t(`pages.${p}`) }));

  const showcaseNote = draft.variant !== 1;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t.rich('description', {
          link: (chunks) => (
            <Link
              href={REGISTRATION_SETTINGS_HREF}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
        actions={
          <Button type="submit" disabled={!canEdit || changed === 0 || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {save.isPending ? t('saving') : t('save')}
          </Button>
        }
      />

      {!canEdit && <ReadOnlyNotice section="authPages" />}
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
        </Alert>
      )}

      <Card>
        <DesignPicker
          value={draft.variant}
          onChange={(v) => {
            setDraft((d) => ({ ...d, variant: v }));
            clearError('variant');
          }}
          disabled={dis}
          error={errors.variant}
        />
      </Card>

      <div
        className={cn(
          'grid items-start gap-5',
          !wide && 'xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]',
        )}
      >
        <Card className={cn('min-w-0 space-y-4', wide && 'order-2')}>
          <TabBar
            items={pageTabs}
            value={page}
            onChange={setPage}
            label={t('pagesLabel')}
            idPrefix="ap"
          />
          <div
            role="tabpanel"
            id="ap-panel"
            aria-labelledby={`ap-tab-${page}`}
            tabIndex={-1}
            className="outline-none"
          >
            <PageFields
              page={page}
              draft={draft}
              defaults={data.defaults}
              errors={errors}
              disabled={dis}
              setField={(key, value) => setPageField(page, key, value)}
              setExtra={(key, value) => setExtra(page, key, value)}
            />
          </div>
        </Card>

        <section
          aria-labelledby="ap-preview-title"
          className={cn('min-w-0 space-y-3', !wide && 'xl:sticky xl:top-20')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="ap-preview-title" className="text-lg font-semibold leading-tight">
                {t('preview.title')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('preview.note', { page: t(`pages.${page}`) })}
                {showcaseNote ? ` ${t('preview.showcaseNote')}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={REAL_PAGE_PATHS[page]}
                target="_blank"
                rel="noopener noreferrer"
                title={t('preview.openRealNote')}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('preview.openReal')}
                <span className="sr-only"> {t('preview.opensNewTab')}</span>
              </a>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setWide((v) => !v)}
                aria-pressed={wide}
              >
                {wide ? t('preview.shrink') : t('preview.enlarge')}
              </Button>
              <div
                role="group"
                aria-label={t('preview.device')}
                className="inline-flex rounded-md border border-border p-0.5"
              >
                {(['desktop', 'mobile'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={device === d}
                    onClick={() => setDevice(d)}
                    className={cn(
                      'rounded px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary',
                      device === d
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {t(`preview.devices.${d}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <PreviewFrame
            device={device}
            title={t('preview.frameTitle', { page: t(`pages.${page}`) })}
          >
            {/*
              The guest type is defined by class names on the guest layout's wrapper; the console has no such wrapper,
              so the preview brings its own (display: contents draws nothing and keeps the shell's height rules).
            */}
            <PreviewFonts fontClass={fontClass}>
              <AuthShell
                variant={draft.variant}
                page={page}
                content={resolvePreviewContent(page, draft.pages[page], data.defaults)}
                extra={resolvePreviewExtra(draft.extra[page])}
                appName={config.data?.appName}
                countryIso={config.data?.defaultCountryIso}
                preview
              >
                <PreviewForm page={page} config={config.data} />
              </AuthShell>
            </PreviewFonts>
          </PreviewFrame>
        </section>
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
              setDraft(authPagesToDraft(data));
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

/** The fields of one page tab. Exported for the render tests. */
export function PageFields({
  page,
  draft,
  defaults: allDefaults,
  errors,
  disabled,
  setField,
  setExtra,
}: {
  page: AuthPageName;
  draft: AuthPagesDraft;
  defaults: PageDefaults;
  errors: Errors;
  disabled: boolean;
  setField: <K extends keyof PageDraft>(key: K, value: PageDraft[K]) => void;
  setExtra: (key: string, value: string) => void;
}) {
  const t = useTranslations(NS);
  const tg = useTranslations('auth-registration-security.guest.shell');
  const d = draft.pages[page];
  const defaults = allDefaults[page];
  const shippedAccent = defaults.accent ?? '#000000';
  const pickerValue = isHexColour(d.accent) ? d.accent : shippedAccent;

  const text = (field: TextFieldName, multiline = false) => {
    const id = `ap-${page}-${field}`;
    const props = {
      id,
      value: d[field],
      onChange: (e: { target: { value: string } }) => setField(field, e.target.value),
      placeholder: defaults[field] ?? '',
      maxLength: TEXT_LIMITS[field],
      readOnly: disabled,
      invalid: Boolean(errors[`${page}-${field}`]),
    };
    return (
      <Field
        label={t(`fields.${field}`)}
        htmlFor={id}
        hint={t('fields.emptyHint', { max: TEXT_LIMITS[field] })}
        error={errors[`${page}-${field}`]}
      >
        {multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
      </Field>
    );
  };

  const extraField = (key: string, opts?: { long?: boolean; label?: string }) => {
    const control = `extra-${page}-${key}`;
    const placeholder = tg.has(`defaults.${page}.${key}`) ? tg(`defaults.${page}.${key}`) : '';
    const props = {
      id: `ap-${control}`,
      value: draft.extra[page]?.[key] ?? '',
      onChange: (e: { target: { value: string } }) => setExtra(key, e.target.value),
      placeholder,
      maxLength: EXTRA_LIMIT,
      readOnly: disabled,
      invalid: Boolean(errors[control]),
    };
    return (
      <Field
        label={opts?.label ?? t(`showcase.keys.${key}`)}
        htmlFor={props.id}
        error={errors[control]}
      >
        {opts?.long ? <Textarea rows={2} {...props} /> : <Input {...props} />}
      </Field>
    );
  };

  const hasShowcase = (SHOWCASE_PAGES as readonly string[]).includes(page);
  const groups = SHOWCASE_GROUPS_BY_PAGE[page];

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-4 border-0 p-0 [&_input:disabled]:opacity-60 [&_select:disabled]:opacity-60 [&_textarea:disabled]:opacity-60"
    >
      <Field
        label={t('fields.accent')}
        htmlFor={`ap-${page}-accent`}
        hint={t('fields.accentHint')}
        error={errors[`${page}-accent`]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`ap-${page}-accent`}
            type="color"
            value={pickerValue}
            onChange={(e) => setField('accent', e.target.value)}
            aria-label={t('fields.accentPicker')}
            className="h-10 w-14 cursor-pointer rounded-md border border-border bg-background p-1"
          />
          <Input
            value={d.accent}
            onChange={(e) => setField('accent', e.target.value)}
            placeholder={shippedAccent}
            maxLength={9}
            dir="ltr"
            aria-label={t('fields.accentHex')}
            invalid={Boolean(errors[`${page}-accent`])}
            className="max-w-32 font-mono"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setField('accent', '')}
            disabled={!d.accent}
          >
            {t('fields.accentReset')}
          </Button>
        </div>
      </Field>

      {text('eyebrow')}
      {text('heading')}
      {text('headingAccent')}
      {text('subheading', true)}

      <div className="space-y-3 rounded-md border border-border p-3">
        <div>
          <h3 className="text-sm font-semibold">{t('media.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('media.description')}</p>
        </div>
        <Field
          label={t('media.url')}
          htmlFor={`ap-${page}-mediaUrl`}
          hint={t('media.urlHint')}
          error={errors[`${page}-mediaUrl`]}
        >
          <Input
            id={`ap-${page}-mediaUrl`}
            type="url"
            inputMode="url"
            value={d.mediaUrl}
            onChange={(e) => {
              setField('mediaUrl', e.target.value);
              if (e.target.value.trim()) setField('mediaType', guessMediaType(e.target.value));
            }}
            placeholder="https://"
            maxLength={MEDIA_URL_LIMIT}
            readOnly={disabled}
            invalid={Boolean(errors[`${page}-mediaUrl`])}
            dir="ltr"
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('media.type')} htmlFor={`ap-${page}-mediaType`} className="min-w-40">
            <Select
              id={`ap-${page}-mediaType`}
              value={d.mediaType}
              onChange={(e) => setField('mediaType', e.target.value as MediaType)}
            >
              {MEDIA_TYPES.map((m) => (
                <option key={m} value={m}>
                  {t(`media.types.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            onClick={() => setField('mediaUrl', '')}
            disabled={!d.mediaUrl}
          >
            {t('media.clear')}
          </Button>
        </div>
      </div>

      {hasShowcase && (
        <details className="group rounded-md border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-primary">
            <span>
              {t('showcase.title')}
              <span className="block text-xs font-normal text-muted-foreground">
                {t('showcase.description')}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-muted-foreground transition group-open:rotate-90 rtl:group-open:-rotate-90"
            >
              ›
            </span>
          </summary>
          <div className="space-y-5 border-t border-border p-3">
            {groups.includes('hero') && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('showcase.groups.hero')}
                </h4>
                {extraField('hero_title')}
                {extraField('hero_desc', { long: true })}
              </div>
            )}
            {groups.includes('stats') && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('showcase.groups.stats')}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SHOWCASE_GROUPS.stats.map((k) => (
                    <div key={k}>{extraField(k)}</div>
                  ))}
                </div>
              </div>
            )}
            {groups.includes('features') && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('showcase.groups.features')}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SHOWCASE_GROUPS.features.map((k) => (
                    <div key={k}>{extraField(k)}</div>
                  ))}
                </div>
              </div>
            )}
            {groups.includes('chips') && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('showcase.groups.chips')}
                </h4>
                {extraField('inside_heading')}
                <div className="grid gap-3 sm:grid-cols-2">
                  {SHOWCASE_GROUPS.chips
                    .filter((k) => k !== 'inside_heading')
                    .map((k) => (
                      <div key={k}>{extraField(k)}</div>
                    ))}
                </div>
              </div>
            )}
            {groups.includes('footer') && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('showcase.groups.footer')}
                </h4>
                {extraField('footer')}
              </div>
            )}
          </div>
        </details>
      )}
    </fieldset>
  );
}
