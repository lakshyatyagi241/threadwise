'use client';

import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  WHATSAPP_AUTH_SCHEMES,
  WHATSAPP_BILLING_MODES,
  WHATSAPP_CREDENTIAL_MODES,
  WHATSAPP_ONBOARDING_METHODS,
  WHATSAPP_PARTNER_PROGRAMS,
  type WhatsappPartnerProgram,
  WHATSAPP_SIGNATURE_SCHEMES,
  WHATSAPP_WEBHOOK_MODES,
  type WhatsappProvider,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { createProvider, updateProvider, wapKeys } from '../api';
import { checkBaseUrl } from '../lib/base-url';
import {
  WIZARD_STEPS,
  buildCreateRequest,
  buildUpdateRequest,
  contractIssues,
  draftFromProvider,
  draftReadinessGaps,
  emptyDraft,
  firstStepWithProblem,
  isDirty,
  stepOfField,
  validateDraft,
  withAuthScheme,
  withPartnerProgram,
  type FieldProblem,
  type ProviderDraft,
  type WizardStep,
} from '../lib/draft';
import { CONSOLE_WHATSAPP_SETTINGS_PATH } from '../lib/provider-view';
import { templatesFromRows } from '../lib/header-templates';
import { wapError, type WapError } from '../lib/errors';
import { HeaderTemplatesEditor, RequestPreview } from './header-templates-editor';
import { ErrorLine, SecretField, Section } from './ui';

const NS = 'whatsapp-providers.form';
export const PROVIDERS_PATH = '/admin/whatsapp-providers';

type Props = { mode: 'create' } | { mode: 'edit'; provider: WhatsappProvider };

/**
 * Add a provider (a step by step wizard, ending in a review) or change one (every section on one page). Secrets are write only:
 * a stored one reads "Set, ends in 1234" and typing replaces it. The wizard never activates a provider; a new one starts
 * disabled, and the detail page it lands on tests and activates it.
 */
export function ProviderForm(props: Props) {
  const provider = props.mode === 'edit' ? props.provider : undefined;
  const builtin = !!provider?.builtin;
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const te = useTranslations('whatsapp-providers.errors');
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<ProviderDraft>(() =>
    provider ? draftFromProvider(provider) : emptyDraft(),
  );
  const [step, setStep] = useState<WizardStep>('basics');
  const [showAll, setShowAll] = useState(false);
  const [server, setServer] = useState<WapError | null>(null);

  const set = (patch: Partial<ProviderDraft>) => {
    setServer(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const validation = useMemo(
    () => validateDraft(draft, { mode: props.mode, builtin }),
    [draft, props.mode, builtin],
  );
  const dirty = provider ? isDirty(provider, draft) : draft.key !== '' || draft.baseUrl !== '';
  useUnsavedGuard(dirty);

  /** The message under a field: the form's own check (once the operator tried to go on), else the server's refusal. */
  const problemText = (p: FieldProblem | undefined): string | undefined =>
    p ? tp(p.key, p.values) : undefined;
  const fieldError = (field: string, live = false): string | undefined => {
    const own = validation.fields[field];
    if (own && (showAll || live)) return problemText(own);
    if (server?.kind === 'field' && server.field === field) {
      return te(server.key, server.values);
    }
    return undefined;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (provider) {
        const body = buildUpdateRequest(provider, draft);
        if (!body) return provider;
        return updateProvider(provider.id, body);
      }
      return createProvider(buildCreateRequest(draft));
    },
    onSuccess: async (saved) => {
      setServer(null);
      await qc.invalidateQueries({ queryKey: wapKeys.all });
      if (provider) {
        toast.success(t('saved', { name: saved.label }));
      } else {
        toast.success(t('created', { name: saved.label }));
        router.push(`${PROVIDERS_PATH}/${saved.id}`);
      }
    },
    onError: (e) => {
      const info = wapError(e);
      setServer(info);
      if (!provider && info.field) setStep(stepOfField(info.field));
      if (info.kind === 'conflict') void qc.invalidateQueries({ queryKey: wapKeys.all });
    },
  });

  const submit = () => {
    setShowAll(true);
    if (!validation.ok) {
      const bad = firstStepWithProblem(validation.fields);
      if (!provider && bad) setStep(bad);
      return;
    }
    if (!provider) {
      const issues = contractIssues(buildCreateRequest(draft));
      const first = issues[0];
      if (first) {
        setServer({
          kind: 'field',
          key: 'validationField',
          field: first.path.split('.').slice(0, 2).join('.'),
          values: { message: first.message },
        });
        setStep(stepOfField(first.path));
        return;
      }
    }
    mutation.mutate();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (provider || step === 'review') submit();
    else next();
  };

  const stepIndex = WIZARD_STEPS.indexOf(step);
  const next = () => {
    const stepFields = validation.fields;
    const bad = firstStepWithProblem(stepFields);
    // Only the steps up to and including this one block going on; a later step's problem waits for its turn.
    if (bad && WIZARD_STEPS.indexOf(bad) <= stepIndex) {
      setShowAll(true);
      setStep(bad);
      return;
    }
    setShowAll(false);
    setStep(WIZARD_STEPS[Math.min(stepIndex + 1, WIZARD_STEPS.length - 1)]!);
  };

  const shared = { draft, set, fieldError, builtin, provider };

  const sections: Record<Exclude<WizardStep, 'review'>, ReactNode> = {
    basics: <BasicsFields {...shared} mode={props.mode} />,
    connection: (
      <ConnectionFields
        {...shared}
        headerProblems={validation.headers}
        setDraft={(fn) => {
          setServer(null);
          setDraft(fn);
        }}
      />
    ),
    credentials: <CredentialFields {...shared} />,
    webhooks: <WebhookFields {...shared} />,
    billing: <BillingFields {...shared} />,
  };

  const conflict = server?.kind === 'conflict';
  const generalError = server && server.kind !== 'field' ? server : null;
  const fieldlessServerError =
    server?.kind === 'field' && server.field && !validation.fields[server.field] ? server : null;

  const errorBlock = (
    <>
      {conflict && (
        <Alert tone="warning" className="space-y-2">
          <p>{te('conflict')}</p>
          <p className="text-xs">{t('conflictHint')}</p>
        </Alert>
      )}
      {generalError && !conflict && <ErrorLine error={generalError} />}
      {showAll && !validation.ok && (
        <Alert tone="danger">
          <p>{t('fixProblems', { count: Object.keys(validation.fields).length })}</p>
        </Alert>
      )}
      {fieldlessServerError && !showAll && (
        <Alert tone="danger">{te(fieldlessServerError.key, fieldlessServerError.values)}</Alert>
      )}
    </>
  );

  if (provider) {
    return (
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('editLabel')}>
        {builtin && (
          <Alert>
            <p>{t('builtinNotice')}</p>
            <Link
              href={CONSOLE_WHATSAPP_SETTINGS_PATH}
              className="mt-1 inline-block text-sm font-medium underline"
            >
              {t('openConsoleSettings')}
            </Link>
          </Alert>
        )}
        <Section id="basics" title={t('steps.basics')}>
          {sections.basics}
        </Section>
        {!builtin && (
          <>
            <Section id="connection" title={t('steps.connection')}>
              {sections.connection}
            </Section>
            <Section id="credentials" title={t('steps.credentials')}>
              {sections.credentials}
            </Section>
            <Section id="webhooks" title={t('steps.webhooks')}>
              {sections.webhooks}
            </Section>
          </>
        )}
        <Section id="billing" title={t('steps.billing')}>
          {sections.billing}
        </Section>
        {errorBlock}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={mutation.isPending || !dirty}>
            {mutation.isPending && <Spinner />}
            {t('save')}
          </Button>
          {!dirty && <span className="text-xs text-muted-foreground">{t('nothingToSave')}</span>}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('wizardLabel')}>
      <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
        {WIZARD_STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              s === step
                ? 'border-primary bg-primary/10 text-primary'
                : i < stepIndex
                  ? 'border-border text-foreground'
                  : 'border-border text-muted-foreground'
            }`}
          >
            <span className="tabular-nums">{i + 1}</span>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      <Section id={`step-${step}`} title={t(`steps.${step}`)} description={t(`stepHelp.${step}`)}>
        {step === 'review' ? (
          <ReviewStep draft={draft} problems={validation.fields} />
        ) : (
          sections[step]
        )}
      </Section>

      {errorBlock}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={stepIndex === 0 || mutation.isPending}
          onClick={() => setStep(WIZARD_STEPS[Math.max(stepIndex - 1, 0)]!)}
        >
          {t('back')}
        </Button>
        <div className="flex items-center gap-2">
          <Link
            href={PROVIDERS_PATH}
            className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('cancel')}
          </Link>
          {step === 'review' ? (
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {t('create')}
            </Button>
          ) : (
            <Button type="submit">{t('next')}</Button>
          )}
        </div>
      </div>
    </form>
  );
}

// --- shared bits -----------------------------------------------------------------------------------------------------------

interface SectionProps {
  draft: ProviderDraft;
  set: (patch: Partial<ProviderDraft>) => void;
  fieldError: (field: string, live?: boolean) => string | undefined;
  builtin: boolean;
  provider?: WhatsappProvider;
}

/** A group of radio cards: the choice and one line of help under each option. */
function ChoiceGroup<T extends string>({
  legend,
  hint,
  value,
  onChange,
  options,
  disabled,
}: {
  legend: string;
  hint?: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; help?: string }>;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
              value === o.value ? 'border-primary bg-primary/5' : 'border-border'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">{o.label}</span>
              {o.help && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.help}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The options of one enum, labelled and explained from the `enums` messages. */
function useOptions<T extends string>(group: string, values: readonly T[]) {
  const t = useTranslations('whatsapp-providers.enums') as unknown as (key: string) => string;
  return values.map((v) => ({
    value: v,
    label: t(`${group}.${v}.label`),
    help: t(`${group}.${v}.help`),
  }));
}

// --- sections --------------------------------------------------------------------------------------------------------------

function BasicsFields({
  draft,
  set,
  fieldError,
  mode,
}: SectionProps & { mode: 'create' | 'edit' }) {
  const t = useTranslations(NS);
  const keyId = useId();
  const labelId = useId();
  const notesId = useId();
  return (
    <div className="space-y-4">
      <Field
        label={t('fields.key')}
        htmlFor={keyId}
        hint={mode === 'create' ? t('hints.key') : t('hints.keyFixed')}
        error={fieldError('key')}
      >
        <Input
          id={keyId}
          value={draft.key}
          onChange={(e) => set({ key: e.target.value })}
          readOnly={mode === 'edit'}
          disabled={mode === 'edit'}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="pinnacle"
          invalid={!!fieldError('key')}
        />
      </Field>
      <Field label={t('fields.label')} htmlFor={labelId} error={fieldError('label')}>
        <Input
          id={labelId}
          value={draft.label}
          onChange={(e) => set({ label: e.target.value })}
          autoComplete="off"
          placeholder="Pinnacle BSP"
          invalid={!!fieldError('label')}
        />
      </Field>
      <Field
        label={t('fields.notes')}
        htmlFor={notesId}
        hint={t('hints.notes')}
        error={fieldError('notes')}
      >
        <Textarea
          id={notesId}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={3}
          invalid={!!fieldError('notes')}
        />
      </Field>
    </div>
  );
}

function ConnectionFields({
  draft,
  set,
  fieldError,
  headerProblems,
  setDraft,
}: SectionProps & {
  headerProblems: ReturnType<typeof validateDraft>['headers'];
  setDraft: (fn: (d: ProviderDraft) => ProviderDraft) => void;
}) {
  const t = useTranslations(NS);
  const baseId = useId();
  const versionId = useId();
  const authOptions = useOptions('authScheme', WHATSAPP_AUTH_SCHEMES);
  const urlCheck = checkBaseUrl(draft.baseUrl);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field
          label={t('fields.baseUrl')}
          htmlFor={baseId}
          hint={t('hints.baseUrl')}
          error={fieldError('baseUrl', draft.baseUrl.trim() !== '')}
        >
          <Input
            id={baseId}
            dir="ltr"
            inputMode="url"
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.example-bsp.com/wa"
            invalid={!!fieldError('baseUrl', draft.baseUrl.trim() !== '')}
          />
        </Field>
        <Field
          label={t('fields.apiVersion')}
          htmlFor={versionId}
          error={fieldError('apiVersion', draft.apiVersion.trim() !== '')}
        >
          <Input
            id={versionId}
            dir="ltr"
            value={draft.apiVersion}
            onChange={(e) => set({ apiVersion: e.target.value })}
            className="font-mono text-xs"
            autoComplete="off"
            placeholder="v25.0"
            invalid={!!fieldError('apiVersion', draft.apiVersion.trim() !== '')}
          />
        </Field>
      </div>
      {urlCheck.devLoopback && <Alert tone="warning">{t('devLoopback')}</Alert>}
      <p className="text-xs text-muted-foreground">{t('ssrfNote')}</p>

      <ChoiceGroup
        legend={t('fields.authScheme')}
        value={draft.authScheme}
        onChange={(authScheme) => setDraft((d) => withAuthScheme(d, authScheme))}
        options={authOptions}
      />

      {draft.authScheme === 'custom_headers' && (
        <div className="space-y-2">
          <HeaderTemplatesEditor
            rows={draft.headers}
            onChange={(headers) => set({ headers })}
            problems={headerProblems}
            credentialMode={draft.credentialMode}
          />
          {fieldError('headerTemplates') && (
            <p role="alert" className="text-xs text-danger">
              {fieldError('headerTemplates')}
            </p>
          )}
        </div>
      )}

      <RequestPreview
        baseUrl={draft.baseUrl}
        apiVersion={draft.apiVersion}
        authScheme={draft.authScheme}
        rows={draft.headers}
        credentialMode={draft.credentialMode}
      />
    </div>
  );
}

function CredentialFields({ draft, set, fieldError, provider }: SectionProps) {
  const t = useTranslations(NS);
  const modeOptions = useOptions('credentialMode', WHATSAPP_CREDENTIAL_MODES);
  const inUse = (provider?.numberCount ?? 0) > 0;
  return (
    <div className="space-y-4">
      <ChoiceGroup
        legend={t('fields.credentialMode')}
        hint={
          inUse ? t('hints.credentialModeLocked', { count: provider?.numberCount ?? 0 }) : undefined
        }
        value={draft.credentialMode}
        onChange={(credentialMode) => set({ credentialMode })}
        options={modeOptions}
        disabled={inUse}
      />
      {fieldError('credentialMode', draft.partnerProgram !== null) && (
        <p role="alert" className="text-xs text-danger">
          {fieldError('credentialMode', draft.partnerProgram !== null)}
        </p>
      )}
      <SecretField
        label={t('fields.providerToken')}
        hint={
          draft.credentialMode === 'platform_token'
            ? t('hints.providerTokenNeeded')
            : t('hints.providerTokenOptional')
        }
        state={provider?.credentials.providerToken ?? null}
        edit={draft.secrets.providerToken}
        onChange={(v) => set({ secrets: { ...draft.secrets, providerToken: v } })}
        error={fieldError('credentials.providerToken')}
      />
      <p className="text-xs text-muted-foreground">{t('secretsNote')}</p>
    </div>
  );
}

function WebhookFields({ draft, set, fieldError, provider }: SectionProps) {
  const t = useTranslations(NS);
  const headerId = useId();
  const webhookModes = useOptions('webhookMode', WHATSAPP_WEBHOOK_MODES);
  const signatureOptions = useOptions('signatureScheme', WHATSAPP_SIGNATURE_SCHEMES);
  const setSecret =
    (k: 'appSecret' | 'webhookSecret' | 'verifyToken') => (v: ProviderDraft['secrets'][typeof k]) =>
      set({ secrets: { ...draft.secrets, [k]: v } });
  return (
    <div className="space-y-5">
      <ChoiceGroup
        legend={t('fields.webhookMode')}
        value={draft.webhookMode}
        onChange={(webhookMode) => set({ webhookMode })}
        options={webhookModes}
      />
      <ChoiceGroup
        legend={t('fields.signatureScheme')}
        value={draft.signatureScheme}
        onChange={(signatureScheme) => set({ signatureScheme })}
        options={signatureOptions}
      />
      {draft.signatureScheme === 'meta_app_secret_sha256' && (
        <SecretField
          label={t('fields.appSecret')}
          hint={t('hints.appSecret')}
          state={provider?.credentials.appSecret ?? null}
          edit={draft.secrets.appSecret}
          onChange={setSecret('appSecret')}
          error={fieldError('credentials.appSecret')}
        />
      )}
      {draft.signatureScheme === 'shared_secret_header' && (
        <>
          <Field
            label={t('fields.signatureHeaderName')}
            htmlFor={headerId}
            hint={t('hints.signatureHeaderName')}
            error={fieldError('signatureHeaderName')}
          >
            <Input
              id={headerId}
              dir="ltr"
              value={draft.signatureHeaderName}
              onChange={(e) => set({ signatureHeaderName: e.target.value })}
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              placeholder="x-bsp-secret"
              invalid={!!fieldError('signatureHeaderName')}
            />
          </Field>
          <SecretField
            label={t('fields.webhookSecret')}
            hint={t('hints.webhookSecret')}
            state={provider?.credentials.webhookSecret ?? null}
            edit={draft.secrets.webhookSecret}
            onChange={setSecret('webhookSecret')}
            error={fieldError('credentials.webhookSecret')}
          />
        </>
      )}
      {draft.signatureScheme === 'none' && <Alert tone="warning">{t('signatureNoneNote')}</Alert>}
      <SecretField
        label={t('fields.verifyToken')}
        hint={t('hints.verifyToken')}
        state={provider?.credentials.verifyToken ?? null}
        edit={draft.secrets.verifyToken}
        onChange={setSecret('verifyToken')}
        error={fieldError('credentials.verifyToken')}
      />
    </div>
  );
}

function BillingFields({ draft, set, fieldError, builtin }: SectionProps) {
  const t = useTranslations(NS);
  const appId = useId();
  const configId = useId();
  const programId = useId();
  const solutionId = useId();
  const te = useTranslations('whatsapp-providers.enums');
  const billingOptions = useOptions('billingMode', WHATSAPP_BILLING_MODES);
  const onboardingOptions = useOptions('onboarding', WHATSAPP_ONBOARDING_METHODS);
  return (
    <div className="space-y-5">
      <ChoiceGroup
        legend={t('fields.billingMode')}
        hint={t('hints.billingMode')}
        value={draft.billingMode}
        onChange={(billingMode) => set({ billingMode })}
        options={billingOptions}
      />
      <Checkbox
        id="media-upload"
        checked={draft.mediaUpload}
        onChange={(e) => set({ mediaUpload: e.target.checked })}
        label={
          <span>
            <span className="font-medium">{t('fields.mediaUpload')}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t('hints.mediaUpload')}
            </span>
          </span>
        }
      />
      <ChoiceGroup
        legend={t('fields.onboarding')}
        value={draft.onboarding}
        onChange={(onboarding) => set({ onboarding })}
        options={onboardingOptions}
      />
      {draft.onboarding === 'embedded_signup' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fields.onboardingAppId')}
            htmlFor={appId}
            hint={t('hints.onboardingIds')}
            error={fieldError('onboardingAppId', draft.onboardingAppId.trim() !== '')}
          >
            <Input
              id={appId}
              dir="ltr"
              inputMode="numeric"
              value={draft.onboardingAppId}
              onChange={(e) => set({ onboardingAppId: e.target.value })}
              className="font-mono text-xs"
              autoComplete="off"
              invalid={!!fieldError('onboardingAppId', draft.onboardingAppId.trim() !== '')}
            />
          </Field>
          <Field
            label={t('fields.onboardingConfigId')}
            htmlFor={configId}
            error={fieldError('onboardingConfigId', draft.onboardingConfigId.trim() !== '')}
          >
            <Input
              id={configId}
              dir="ltr"
              inputMode="numeric"
              value={draft.onboardingConfigId}
              onChange={(e) => set({ onboardingConfigId: e.target.value })}
              className="font-mono text-xs"
              autoComplete="off"
              invalid={!!fieldError('onboardingConfigId', draft.onboardingConfigId.trim() !== '')}
            />
          </Field>
        </div>
      )}
      {!builtin && (
        <div className="space-y-4">
          <Field label={t('fields.partnerProgram')} htmlFor={programId}>
            <Select
              id={programId}
              value={draft.partnerProgram ?? ''}
              onChange={(e) => {
                const v = e.target.value as WhatsappPartnerProgram | '';
                set(withPartnerProgram(draft, v === '' ? null : v));
              }}
            >
              <option value="">{te('partnerProgram.none.label')}</option>
              {WHATSAPP_PARTNER_PROGRAMS.map((v) => (
                <option key={v} value={v}>
                  {te(`partnerProgram.${v}.label`)}
                </option>
              ))}
            </Select>
          </Field>
          {draft.partnerProgram === 'pinnacle' && (
            <>
              <Alert>{t('hints.partnerPinnacle')}</Alert>
              <Field
                label={t('fields.partnerSolutionId')}
                htmlFor={solutionId}
                hint={t('hints.partnerSolutionId')}
                error={fieldError('partnerSolutionId', draft.partnerSolutionId.trim() !== '')}
              >
                <Input
                  id={solutionId}
                  dir="ltr"
                  inputMode="numeric"
                  value={draft.partnerSolutionId}
                  onChange={(e) => set({ partnerSolutionId: e.target.value })}
                  className="font-mono text-xs"
                  autoComplete="off"
                  invalid={!!fieldError('partnerSolutionId', draft.partnerSolutionId.trim() !== '')}
                />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The last step of the wizard: everything typed, with secrets reduced to "will be saved", and what the provider still lacks. */
function ReviewStep({
  draft,
  problems,
}: {
  draft: ProviderDraft;
  problems: Partial<Record<string, FieldProblem>>;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('whatsapp-providers.enums');
  const tg = useTranslations(`${NS}.gaps`);
  const gaps = draftReadinessGaps(draft);
  const headers = templatesFromRows(draft.headers);
  const rows: Array<[string, ReactNode]> = [
    [t('fields.key'), <code key="k">{draft.key.trim().toLowerCase()}</code>],
    [t('fields.label'), draft.label.trim()],
    [
      t('fields.baseUrl'),
      <code key="u" dir="ltr">
        {checkBaseUrl(draft.baseUrl).url ?? draft.baseUrl}
      </code>,
    ],
    [t('fields.apiVersion'), draft.apiVersion.trim()],
    [t('fields.authScheme'), te(`authScheme.${draft.authScheme}.label`)],
    ...(draft.authScheme === 'custom_headers'
      ? ([[t('review.headers'), Object.keys(headers).join(', ')]] as Array<[string, ReactNode]>)
      : []),
    [t('fields.credentialMode'), te(`credentialMode.${draft.credentialMode}.label`)],
    [t('fields.webhookMode'), te(`webhookMode.${draft.webhookMode}.label`)],
    [t('fields.signatureScheme'), te(`signatureScheme.${draft.signatureScheme}.label`)],
    [t('fields.billingMode'), te(`billingMode.${draft.billingMode}.label`)],
    [t('fields.mediaUpload'), draft.mediaUpload ? t('review.yes') : t('review.no')],
    [t('fields.onboarding'), te(`onboarding.${draft.onboarding}.label`)],
    ...(draft.partnerProgram
      ? ([
          [t('fields.partnerProgram'), te(`partnerProgram.${draft.partnerProgram}.label`)],
          [t('fields.partnerSolutionId'), <code key="ps">{draft.partnerSolutionId.trim()}</code>],
        ] as Array<[string, ReactNode]>)
      : []),
    [
      t('review.secrets'),
      (['providerToken', 'appSecret', 'webhookSecret', 'verifyToken'] as const)
        .filter((k) => draft.secrets[k].value.trim() !== '')
        .map((k) => t(`fields.${k}`))
        .join(', ') || t('review.noSecrets'),
    ],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {gaps.length > 0 && (
        <Alert tone="warning" className="space-y-1">
          <p className="font-medium">{t('review.gapsTitle')}</p>
          <ul className="list-disc ps-5">
            {gaps.map((g) => (
              <li key={g}>{tg(g)}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">{t('review.startsDisabled')}</p>
      {Object.keys(problems).length > 0 && (
        <Alert tone="danger">{t('fixProblems', { count: Object.keys(problems).length })}</Alert>
      )}
    </div>
  );
}
