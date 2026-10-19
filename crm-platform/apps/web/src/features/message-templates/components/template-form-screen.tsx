'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  TemplateDetail,
  TemplateSubmitResult,
  TplAiDraft,
  TplLintIssue,
  TplMetaCategory,
  WabaConnection,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { OptOutFooterSuggestion } from '@/features/contact-consent';
import {
  useConnections,
  useCreateTemplate,
  useDebounced,
  useLint,
  useTemplate,
  useTemplateGallery,
  useUpdateTemplate,
} from '../api/hooks';
import { applyAiDraft, canDraftCategory, takeAiDraft } from '../lib/ai-draft';
import { buttonIssues } from '../lib/buttons';
import { galleryToState } from '../lib/gallery-state';
import { counter, toggleSelection } from '../lib/format';
import {
  BODY_MAX,
  EXPIRY_MAX,
  EXPIRY_MIN,
  FOOTER_MAX,
  contractIssues,
  initialState,
  isAuth,
  previewOf,
  stateFromDetail,
  tidyName,
  sanitizeName,
  toCreateInput,
  toLintInput,
  toUpdateInput,
  withBody,
  withHeaderKind,
  withHeaderText,
  type FormState,
} from '../lib/form-model';
import { languageOptions } from '../lib/languages';
import { CATEGORIES, canEdit, isLive } from '../lib/status-model';
import { connectionLabel, usableConnections } from '../lib/sync';
import { tokensOf } from '../lib/variables';
import { ButtonsEditor } from './buttons-editor';
import { ErrorAlert } from './error-line';
import { HeaderSection } from './header-section';
import { IssueList, LintPanel } from './lint-panel';
import { PhonePreview } from './message-bubble';
import { SparkIcon } from './icons';
import { TemplateAiModal } from './template-ai-modal';
import { useErrorText, type ErrorText } from './use-error-text';
import { VariablesPanel } from './variables-panel';

function labelOf(list: WabaConnection[], id: string | null): string | null {
  const c = list.find((x) => x.id === id);
  return c ? connectionLabel(c) : null;
}

const TOOLBAR = [
  { id: 'bold', marker: '*' },
  { id: 'italic', marker: '_' },
  { id: 'strike', marker: '~' },
  { id: 'code', marker: '```' },
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

/** TW-TPL-005/006: `/templates/new` and `/templates/[id]/edit`. Edit loads the saved template first. */
export function TemplateFormScreen({
  id,
  copyFrom,
  connectionId,
  galleryId,
}: {
  id?: string;
  copyFrom?: string;
  /** A new template starts on this number (the guided campaign wizard passes the number it sends from). */
  connectionId?: string;
  /** A default template to start from (`/templates/new?gallery=<id>`). */
  galleryId?: string;
}) {
  const t = useTranslations('message-templates.form');
  const errorText = useErrorText();
  // A copy opens the form of a new template filled in from this one ("Duplicate template" in the inbox's template list).
  const detail = useTemplate(id ?? copyFrom ?? '', { poll: false });
  const mayCreate = useCan('tpl.templates.create');
  const gallery = useTemplateGallery({}, { enabled: galleryId !== undefined });
  const fromGallery = galleryId
    ? gallery.data?.templateList.find((g) => g.id === galleryId)
    : undefined;

  if (!mayCreate) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-7">
        <Alert tone="warning">{t('noPermission')}</Alert>
      </main>
    );
  }
  if (id === undefined && copyFrom === undefined && galleryId !== undefined) {
    if (gallery.isPending)
      return (
        <div className="flex justify-center p-12">
          <Spinner label={t('loading')} />
        </div>
      );
    if (gallery.isError)
      return (
        <main className="mx-auto max-w-3xl space-y-3 px-4 py-7">
          <ErrorAlert error={errorText(gallery.error)} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void gallery.refetch()}>
              {t('retry')}
            </Button>
            <Link
              href="/templates"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              {t('backToLibrary')}
            </Link>
          </div>
        </main>
      );
    // A default template that is not in the answer (an old link) opens the empty form.
    return fromGallery ? (
      <TemplateForm
        key={`gallery:${galleryId}`}
        initial={galleryToState(fromGallery, connectionId)}
      />
    ) : (
      <TemplateForm key="new" initial={initialState()} />
    );
  }
  if (id === undefined && copyFrom === undefined)
    return <TemplateForm key="new" initial={initialState(connectionId)} acceptAiDraft />;
  if (detail.isPending)
    return (
      <div className="flex justify-center p-12">
        <Spinner label={t('loading')} />
      </div>
    );
  if (detail.isError)
    return (
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-7">
        <ErrorAlert error={errorText(detail.error)} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void detail.refetch()}>
            {t('retry')}
          </Button>
          <Link
            href="/templates"
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            {t('backToLibrary')}
          </Link>
        </div>
      </main>
    );
  if (id === undefined)
    return <TemplateForm key={`copy:${copyFrom}`} initial={copyState(detail.data)} />;
  if (!canEdit(detail.data.status)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-7">
        <EmptyState
          title={t('notEditableTitle')}
          message={t('notEditableBody')}
          actions={
            <Link
              href={`/templates/${detail.data.id}`}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              {t('viewTemplate')}
            </Link>
          }
        />
      </main>
    );
  }
  return (
    <TemplateForm
      key={`${detail.data.id}:${detail.data.rowVersion}`}
      detail={detail.data}
      initial={stateFromDetail(detail.data)}
    />
  );
}

/** A new template that starts as a copy of `d`: its own name, and no media sample (a new file is chosen for the copy). */
function copyState(d: TemplateDetail): FormState {
  return {
    ...stateFromDetail(d),
    name: `${d.name}_copy`.slice(0, 512),
    headerSampleUrl: '',
    headerPreviewUrl: '',
  };
}

interface Saved {
  id: string;
  rowVersion: number;
}

function TemplateForm({
  initial,
  detail,
  acceptAiDraft = false,
}: {
  initial: FormState;
  detail?: TemplateDetail;
  /** A new template: a draft the campaign wizard left in this tab (TW-TPL-016) is picked up once on mount. */
  acceptAiDraft?: boolean;
}) {
  const t = useTranslations('message-templates.form');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const base = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [state, setState] = useState<FormState>(initial);
  const [saved, setSaved] = useState<Saved | null>(
    detail ? { id: detail.id, rowVersion: detail.rowVersion } : null,
  );
  const [result, setResult] = useState<{ value: TemplateSubmitResult; submitted: boolean } | null>(
    null,
  );
  const [failure, setFailure] = useState<ErrorText | null>(null);

  const connections = useConnections();
  const usable = useMemo(() => usableConnections(connections.data ?? []), [connections.data]);
  const fallbackConnection = (usable.find((c) => c.isPrimary) ?? usable[0])?.id ?? '';
  // The picker defaults to the primary number until the operator chooses one.
  const stale =
    !detail &&
    usable.length > 0 &&
    state.connectionId !== '' &&
    !usable.some((c) => c.id === state.connectionId);
  const current: FormState = {
    ...state,
    connectionId: (stale ? '' : state.connectionId) || fallbackConnection,
  };
  const set = (p: Partial<FormState>) => setState((s) => ({ ...s, ...p }));

  // "Build with AI" (TW-TPL-016): fills this form's own fields for review; nothing is submitted.
  const [aiOpen, setAiOpen] = useState(false);
  const fillFromAi = (draft: TplAiDraft) => {
    setState((s) => applyAiDraft(s, draft));
    setFailure(null);
    setResult(null);
    toast(t('ai.applied'), 'success');
  };
  useEffect(() => {
    if (!acceptAiDraft) return;
    const stashed = takeAiDraft();
    if (!stashed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read after mount so the server and first paint agree
    setState((s) => ({
      ...applyAiDraft(s, stashed.draft),
      language: stashed.language,
      metaCategory: stashed.metaCategory,
    }));
    toast(t('ai.applied'), 'success');
  }, [acceptAiDraft, toast, t]);

  const create = useCreateTemplate();
  const update = useUpdateTemplate(saved?.id ?? '');
  const busy = create.isPending || update.isPending;

  // Live lint: debounced, keyed by the payload's text so an unchanged form never re-checks.
  const contract = contractIssues(current);
  const hasContractIssues = Object.keys(contract).length > 0;
  const payloadKey = JSON.stringify(toLintInput(current));
  const settledKey = useDebounced(payloadKey, 500);
  const lint = useLint(
    hasContractIssues ? null : (JSON.parse(settledKey) as ReturnType<typeof toLintInput>),
  );
  const issues: TplLintIssue[] = hasContractIssues ? [] : (lint.data?.issues ?? []);
  const lintErrors = issues.filter((i) => i.severity === 'error').length;
  const checking = !hasContractIssues && (settledKey !== payloadKey || lint.isFetching);
  const localButtonIssues = isAuth(current) ? [] : buttonIssues(current.buttons);

  // A template live on Meta is edited in place there: Meta keeps its name and language.
  const live = detail ? isLive(detail.status, detail.metaTemplateId) : false;
  const auth = isAuth(current);
  const nameOk = current.name.trim() !== '';
  const canDraft = nameOk && current.connectionId !== '' && !hasContractIssues && !busy;
  const canSubmit = canDraft && lintErrors === 0 && localButtonIssues.length === 0 && !checking;

  function save(submit: boolean) {
    setFailure(null);
    setResult(null);
    const done = (value: TemplateSubmitResult) => {
      setSaved({ id: value.template.id, rowVersion: value.template.rowVersion });
      const clean = value.metaError === null && value.warnings.length === 0;
      if (clean) {
        toast(submit ? t('toast.submitted') : t('toast.saved'));
        router.push(`/templates/${value.template.id}`);
        return;
      }
      setResult({ value, submitted: submit });
    };
    const fail = (e: unknown) => setFailure(errorText(e));
    if (saved) {
      update.mutate(toUpdateInput(current, saved.rowVersion, submit), {
        onSuccess: done,
        onError: fail,
      });
    } else {
      create.mutate(toCreateInput(current, submit), { onSuccess: done, onError: fail });
    }
  }

  function toggle(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const r = toggleSelection(
      current.body,
      el.selectionStart,
      el.selectionEnd,
      marker,
      t('body.wrapSample'),
    );
    setState((s) => withBody(s, r.value));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  }

  function insertVariable() {
    const el = bodyRef.current;
    const next = tokensOf(current.body).filter((x) => /^\d+$/.test(x)).length + 1;
    const token = `{{${next}}}`;
    const at = el?.selectionStart ?? current.body.length;
    const end = el?.selectionEnd ?? at;
    setState((s) => withBody(s, s.body.slice(0, at) + token + s.body.slice(end)));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  const nameError = contract.name ? t('errors.name') : undefined;
  const nameTaken = failure?.code === 'TPL_NAME_TAKEN';
  const bodyCount = counter(current.body, BODY_MAX);

  return (
    <main className="max-w-none px-4 pb-10 sm:px-6 lg:px-7">
      <div className="sticky top-14 z-30 -mx-4 mb-5 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7">
        <nav aria-label={t('breadcrumb')} className="text-xs text-muted-foreground">
          <Link href="/templates" className="hover:underline">
            {t('breadcrumbLibrary')}
          </Link>{' '}
          / <span>{detail ? t('breadcrumbEdit') : t('breadcrumbNew')}</span>
        </nav>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {detail ? t('titleEdit', { name: detail.name }) : t('titleNew')}
        </h1>
        {!detail && (
          <Button
            variant="secondary"
            className="border-brand/40 text-brand"
            disabled={!canDraftCategory(current.metaCategory) || busy}
            aria-describedby={
              !canDraftCategory(current.metaCategory) ? `${base}-ai-why` : undefined
            }
            onClick={() => setAiOpen(true)}
          >
            <SparkIcon className="size-3.5" />
            {t('ai.open')}
          </Button>
        )}
        <Button variant="secondary" disabled={!canDraft} onClick={() => save(false)}>
          {busy && !create.variables?.submit && !update.variables?.submit && <Spinner />}
          {t('saveDraft')}
        </Button>
        <Button disabled={!canSubmit} onClick={() => save(true)} aria-describedby={`${base}-why`}>
          {busy && (create.variables?.submit || update.variables?.submit) && <Spinner />}
          {t('submit')}
        </Button>
        {!canSubmit && !busy && (
          <span
            id={`${base}-why`}
            className="basis-full text-xs text-muted-foreground sm:basis-auto"
          >
            {!current.connectionId
              ? t('why.connection')
              : !nameOk
                ? t('why.name')
                : hasContractIssues
                  ? t('why.fields')
                  : lintErrors > 0 || localButtonIssues.length > 0
                    ? t('why.errors')
                    : checking
                      ? t('why.checking')
                      : ''}
          </span>
        )}
      </div>

      {!detail && !canDraftCategory(current.metaCategory) && (
        <p id={`${base}-ai-why`} className="mb-3 text-xs text-muted-foreground">
          {t('ai.authHint')}
        </p>
      )}
      {result && <ResultPanel result={result.value} submitted={result.submitted} />}
      {failure && (
        <div className="mb-4 space-y-2">
          <ErrorAlert error={failure} />
          {failure.fieldErrors.length > 0 && (
            <ul className="list-disc ps-5 text-sm text-danger">
              {failure.fieldErrors.map((f, i) => (
                <li key={i}>
                  <span className="font-mono">{f.path}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
          {failure.code === 'ROW_VERSION_CONFLICT' && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {t('reload')}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Section title={t('identity.title')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('identity.connection')}
                htmlFor={`${base}-conn`}
                hint={t('identity.connectionHint')}
              >
                {detail ? (
                  <p id={`${base}-conn`} className="flex h-10 items-center text-sm">
                    {labelOf(connections.data ?? [], detail.connectionId) ??
                      t('identity.connectionUnknown')}
                  </p>
                ) : connections.isPending ? (
                  <Spinner label={t('loading')} />
                ) : connections.isError ? (
                  <div className="space-y-1">
                    <ErrorAlert error={errorText(connections.error)} />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void connections.refetch()}
                    >
                      {t('retry')}
                    </Button>
                  </div>
                ) : usable.length === 0 ? (
                  <Alert tone="warning">
                    {t('identity.noConnection')}{' '}
                    <Link href="/channels/whatsapp" className="font-medium underline">
                      {t('identity.connectNumber')}
                    </Link>
                  </Alert>
                ) : (
                  <Select
                    id={`${base}-conn`}
                    value={current.connectionId}
                    onChange={(e) => set({ connectionId: e.target.value })}
                  >
                    {usable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {connectionLabel(c)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('identity.category')}
                htmlFor={`${base}-cat`}
                hint={t('identity.categoryHint')}
              >
                <Select
                  id={`${base}-cat`}
                  value={current.metaCategory}
                  onChange={(e) => set({ metaCategory: e.target.value as TplMetaCategory })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`identity.categories.${c}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('identity.name')}
                htmlFor={`${base}-name`}
                hint={t('identity.nameHint')}
                error={nameTaken ? t('identity.nameTaken') : nameError}
                className="sm:col-span-1"
              >
                <Input
                  id={`${base}-name`}
                  value={current.name}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  invalid={Boolean(nameError) || nameTaken}
                  disabled={live}
                  onChange={(e) => set({ name: sanitizeName(e.target.value) })}
                  onBlur={() => set({ name: tidyName(current.name) })}
                />
                <IssueList issues={issues} field="name" />
              </Field>
              <Field label={t('identity.language')} htmlFor={`${base}-lang`}>
                <Select
                  id={`${base}-lang`}
                  value={current.language}
                  disabled={live}
                  onChange={(e) => set({ language: e.target.value })}
                >
                  {languageOptions(locale, current.language).map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <IssueList issues={issues} field="language" />
              </Field>
            </div>
          </Section>

          {auth ? (
            <Section title={t('auth.title')} hint={t('auth.hint')}>
              <Field
                label={t('auth.expiry')}
                htmlFor={`${base}-expiry`}
                hint={t('auth.expiryHint', { min: EXPIRY_MIN, max: EXPIRY_MAX })}
                error={
                  contract.codeExpirationMinutes
                    ? t('auth.expiryInvalid', { min: EXPIRY_MIN, max: EXPIRY_MAX })
                    : undefined
                }
              >
                <Input
                  id={`${base}-expiry`}
                  type="number"
                  inputMode="numeric"
                  min={EXPIRY_MIN}
                  max={EXPIRY_MAX}
                  className="max-w-40"
                  value={current.otpExpiry}
                  invalid={Boolean(contract.codeExpirationMinutes)}
                  onChange={(e) => set({ otpExpiry: e.target.value })}
                />
              </Field>
              <p className="text-sm text-muted-foreground">{t('auth.fixedBody')}</p>
            </Section>
          ) : (
            <>
              <Section title={t('header.title')} hint={t('header.hint')}>
                <HeaderSection
                  state={current}
                  headerError={contract.header ? t('errors.header') : undefined}
                  onKind={(k) => setState((s) => withHeaderKind(s, k))}
                  onText={(v) => setState((s) => withHeaderText(s, v))}
                  onUploaded={(r) =>
                    set({
                      headerHandle: r.handle,
                      headerFileName: r.fileName,
                      headerMediaKey: r.mediaKey,
                      headerPreviewUrl: r.previewUrl,
                    })
                  }
                />
                <IssueList issues={issues} field="header" />
              </Section>

              <Section title={t('body.title')} hint={t('body.hint')}>
                <div role="toolbar" aria-label={t('body.toolbar')} className="flex flex-wrap gap-1">
                  {TOOLBAR.map((b) => (
                    <Button key={b.id} size="sm" variant="secondary" onClick={() => toggle(b.marker)}>
                      {t(`body.format.${b.id}`)}
                    </Button>
                  ))}
                  <Button size="sm" variant="secondary" onClick={insertVariable}>
                    {t('body.variable')}
                  </Button>
                </div>
                <Field
                  label={t('body.label')}
                  htmlFor={`${base}-body`}
                  error={contract.body ? t('errors.body', { max: BODY_MAX }) : undefined}
                >
                  <Textarea
                    id={`${base}-body`}
                    ref={bodyRef}
                    rows={7}
                    value={current.body}
                    invalid={Boolean(contract.body)}
                    onChange={(e) => setState((s) => withBody(s, e.target.value))}
                  />
                  <p
                    className={
                      bodyCount.over ? 'text-xs text-danger' : 'text-xs text-muted-foreground'
                    }
                    aria-live="polite"
                  >
                    {t('body.counter', { used: bodyCount.used, max: bodyCount.max })}
                  </p>
                  <IssueList issues={issues} field="body" />
                </Field>
              </Section>

              <Section title={t('variables.title')}>
                <VariablesPanel
                  headerText={current.headerKind === 'text' ? current.headerText : ''}
                  headerSlots={current.headerSlots}
                  body={current.body}
                  bodySlots={current.bodySlots}
                  onHeader={(headerSlots) => set({ headerSlots })}
                  onBody={(bodySlots) => set({ bodySlots })}
                />
              </Section>

              <Section title={t('footer.title')}>
                <Field
                  label={t('footer.label')}
                  htmlFor={`${base}-footer`}
                  hint={t('footer.hint', { used: current.footer.length, max: FOOTER_MAX })}
                  error={contract.footer ? t('errors.footer') : undefined}
                >
                  <Input
                    id={`${base}-footer`}
                    value={current.footer}
                    maxLength={FOOTER_MAX + 20}
                    invalid={Boolean(contract.footer)}
                    onChange={(e) => set({ footer: e.target.value })}
                  />
                  <OptOutFooterSuggestion
                    footer={current.footer}
                    max={FOOTER_MAX}
                    onUse={(line) => set({ footer: line })}
                  />
                  <IssueList issues={issues} field="footer" />
                </Field>
              </Section>

              <Section title={t('buttons.title')} hint={t('buttons.hint')}>
                <ButtonsEditor rows={current.buttons} onChange={(buttons) => set({ buttons })} />
                <IssueList issues={issues} field="buttons" />
              </Section>
            </>
          )}
          <IssueList issues={issues} field="template" />
        </div>

        <aside
          className="space-y-4 lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100dvh-9.5rem)] lg:self-start lg:overflow-y-auto"
          aria-label={t('aside')}
        >
          <PhonePreview model={previewOf(current)} />
          <LintPanel
            issues={issues}
            checking={checking}
            failed={lint.isError && !hasContractIssues}
          />
        </aside>
      </div>
      {!detail && canDraftCategory(current.metaCategory) && (
        <TemplateAiModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          language={current.language}
          metaCategory={current.metaCategory}
          onDraft={fillFromAi}
        />
      )}
    </main>
  );
}

/** What came back from a save: Meta's own refusal and the advice, with the form still in place underneath. */
function ResultPanel({ result, submitted }: { result: TemplateSubmitResult; submitted: boolean }) {
  const t = useTranslations('message-templates.form.result');
  return (
    <div className="mb-4 space-y-2" data-testid="save-result">
      {result.metaError ? (
        <Alert tone="danger">
          <p className="font-medium">{t('metaRefused')}</p>
          <p className="mt-1 whitespace-pre-line break-words">{result.metaError}</p>
          <p className="mt-1 text-xs">{t('metaRefusedHelp')}</p>
        </Alert>
      ) : (
        <Alert tone="success">{submitted ? t('submitted') : t('saved')}</Alert>
      )}
      {result.warnings.length > 0 && (
        <Alert tone="warning">
          <p className="font-medium">{t('warnings')}</p>
          <ul className="mt-1 list-disc ps-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Link
        href={`/templates/${result.template.id}`}
        className="inline-flex text-sm font-medium underline"
      >
        {t('open')}
      </Link>
    </div>
  );
}
