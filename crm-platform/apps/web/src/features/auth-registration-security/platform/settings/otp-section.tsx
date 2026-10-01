'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  otpSendersResponseSchema,
  otpTemplateActionResponseSchema,
  type OtpTemplateCreateRequest,
  type OtpTemplateOutcome,
  type RegistrationSettingsResponse,
} from '@crm/contracts';
import { Alert, Badge, Button, Field, Input, Select, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  OTP_KNOBS,
  buildOtpTemplateRequest,
  type RegistrationDraft,
} from '../lib/registration-draft';
import {
  REASON_TONE,
  canRefreshTemplate,
  senderRef,
  templateFor,
  templateIsStale,
  templateState,
} from '../lib/otp-senders';
import { operatorFetch } from '../operator-fetch';
import { useToast } from '../ui/toast';
import { OtpTestModal } from './otp-test-modal';
import { SendersModal } from './otp-senders-modal';
import { OTP_SENDERS_KEY, REGISTRATION_KEY } from './query-keys';
import { Section, ToggleRow } from './section-parts';
import { useProblemText } from './use-problem-text';

const NS = 'auth-registration-security.platform.registration';
type OtpControl = 'otpEnabled' | 'otpSender' | keyof typeof OTP_KNOBS;
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  none: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  local: 'success',
};

/** Back to the button that opened a dialog, once the dialog has left the page (it makes the rest inert while open). */
const refocus = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);

interface Flash {
  tone: 'success' | 'danger' | 'info';
  text: string;
  detail?: string;
  requestId?: string;
}

/**
 * The sign-up code card: the on/off switch with the live verdict (is the code step really running,
 * and if not, why), the sender picker with "Manage senders", the code knobs, the message template
 * ("Create & submit template", "Refresh status") and "Send a test code" (WD-AUTH-006/007).
 */
export function OtpSection({
  settings,
  draft,
  errors,
  canEdit,
  set,
  onProblems,
  onApplied,
  onSenderGone,
}: {
  /** What is saved: the verdict and the template always describe this, not unsaved edits. */
  settings: RegistrationSettingsResponse;
  draft: RegistrationDraft;
  errors: Partial<Record<string, string>>;
  canEdit: boolean;
  set: <K extends keyof RegistrationDraft>(
    key: K,
    value: RegistrationDraft[K],
    control?: OtpControl,
  ) => void;
  onProblems: (problems: Partial<Record<OtpControl, string>>) => void;
  /** A template action returned fresh settings: the page takes them as the new baseline. */
  onApplied: (data: RegistrationSettingsResponse) => void;
  /** A sender was removed: forget it if the form had picked it. */
  onSenderGone: (ref: string) => void;
}) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const problemText = useProblemText();
  const [managing, setManaging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const dis = !canEdit;

  const sendersQ = useQuery({
    queryKey: OTP_SENDERS_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/senders', { schema: otpSendersResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  const senders = sendersQ.data?.senders ?? [];

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : t('otp.template.never'));

  // --- the live verdict and the template for the chosen sender -------------------------------------
  const { otpStatus } = settings;
  const savedSender = settings.otp.sender ?? '';
  const verdictIsStale =
    draft.otpEnabled !== settings.otp.enabled || draft.otpSender.trim() !== savedSender;
  const template = templateFor(settings, draft.otpSender.trim());
  const state = templateState(template);
  const ttl = /^\d+$/.test(draft.ttlMinutes.trim()) ? Number(draft.ttlMinutes.trim()) : null;
  const stale = templateIsStale(template, ttl);
  const known = senders.some((s) => senderRef(s) === draft.otpSender);
  const noSender = draft.otpSender.trim() === '';

  // --- template actions ---------------------------------------------------------------------------------
  function describe(err: unknown, what: 'submit' | 'check'): Flash {
    if (err instanceof ApiError && err.code === 'AUTH_OTP_TEMPLATE_FAILED') {
      return { tone: 'danger', text: t(`otp.template.errors.${what}`), detail: err.message };
    }
    if (err instanceof ApiError && (err.status === 422 || err.status === 409)) {
      return { tone: 'danger', text: t('otp.template.errors.rejected'), detail: err.message };
    }
    return {
      tone: 'danger',
      text: t('otp.template.errors.unexpected'),
      requestId: err instanceof ApiError ? err.requestId : undefined,
    };
  }

  const outcomeText = (o: OtpTemplateOutcome) => t(`otp.template.outcome.${o}`);

  const create = useMutation({
    mutationFn: (body: OtpTemplateCreateRequest) =>
      operatorFetch('/settings/registration/otp-template', {
        method: 'POST',
        body,
        schema: otpTemplateActionResponseSchema,
      }),
    onSuccess: (res) => {
      onApplied(res.registration);
      setFlash({ tone: 'success', text: outcomeText(res.outcome) });
      toast.success(outcomeText(res.outcome));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return;
      // The form's OTP settings may have been saved before Meta answered: take the server's word.
      void qc.invalidateQueries({ queryKey: REGISTRATION_KEY });
      setFlash(describe(err, 'submit'));
    },
  });

  const refresh = useMutation({
    mutationFn: () =>
      operatorFetch('/settings/registration/otp-template/refresh', {
        method: 'POST',
        schema: otpTemplateActionResponseSchema,
      }),
    onSuccess: (res) => {
      // Only the template and the verdict changed: unsaved form edits stay exactly as typed.
      qc.setQueryData(REGISTRATION_KEY, res.registration);
      const status = res.registration.otp.template?.status;
      setFlash({ tone: 'info', text: t(`otp.template.refreshed.${status ?? 'pending'}`) });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return;
      setFlash(describe(err, 'check'));
    },
  });

  function onCreate() {
    if (!canEdit || create.isPending) return;
    setFlash(null);
    const { body, problems } = buildOtpTemplateRequest(settings, draft);
    if (!body) {
      const next: Partial<Record<OtpControl, string>> = {};
      for (const [k, p] of Object.entries(problems)) {
        next[k as OtpControl] = problemText(p);
      }
      onProblems(next);
      if (problems.otpSender?.code === 'senderRequired') {
        setFlash({ tone: 'danger', text: problemText(problems.otpSender) });
      }
      const first = Object.keys(next)[0];
      if (first) document.getElementById(`reg-${first}`)?.focus();
      return;
    }
    create.mutate(body);
  }

  const knob = (id: keyof typeof OTP_KNOBS) => {
    const spec = OTP_KNOBS[id];
    return (
      <Field
        label={t(`fields.${id}.label`)}
        htmlFor={`reg-${id}`}
        hint={t('otp.knobHint', { min: spec.min, max: spec.max, default: spec.default })}
        error={errors[id]}
      >
        <Input
          id={`reg-${id}`}
          type="number"
          inputMode="numeric"
          min={spec.min}
          max={spec.max}
          value={draft[id]}
          placeholder={String(spec.default)}
          onChange={(e) => set(id, e.target.value, id)}
          invalid={Boolean(errors[id])}
          readOnly={dis}
          className="font-mono"
        />
      </Field>
    );
  };

  return (
    <Section kicker={t('otp.kicker')} title={t('otp.title')} description={t('otp.description')}>
      <ToggleRow
        id="reg-otpEnabled"
        label={t('fields.otpEnabled.label')}
        hint={t('fields.otpEnabled.hint')}
        checked={draft.otpEnabled}
        onChange={(v) => set('otpEnabled', v, 'otpEnabled')}
        disabled={dis}
        error={errors.otpEnabled}
      />

      <div className="space-y-1.5" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={REASON_TONE[otpStatus.reason]}>
            {otpStatus.active ? t('otp.status.on') : t('otp.status.off')}
          </Badge>
          <span className="text-sm">{t(`otp.status.reason.${otpStatus.reason}`)}</span>
        </div>
        {verdictIsStale && (
          <p className="text-xs text-muted-foreground">{t('otp.status.unsavedNote')}</p>
        )}
      </div>

      <Field
        label={t('fields.otpSender.label')}
        htmlFor="reg-otpSender"
        hint={
          sendersQ.isSuccess && senders.length === 0
            ? t('otp.sender.empty')
            : t('fields.otpSender.hint')
        }
        error={errors.otpSender}
      >
        <div className="flex gap-2">
          <Select
            id="reg-otpSender"
            value={draft.otpSender}
            onChange={(e) => set('otpSender', e.target.value, 'otpSender')}
            disabled={dis}
            invalid={Boolean(errors.otpSender)}
            className="min-w-0 flex-1"
          >
            <option value="">{t('otp.sender.none')}</option>
            {senders.map((s) => (
              <option key={s.id} value={senderRef(s)}>
                {t('otp.sender.option', { label: s.label, kind: t(`otp.sender.kinds.${s.kind}`) })}
              </option>
            ))}
            {!noSender && !known && sendersQ.isSuccess && (
              <option value={draft.otpSender}>
                {t('otp.sender.unknown', { ref: draft.otpSender })}
              </option>
            )}
          </Select>
          <Button id="otp-manage-senders" variant="secondary" onClick={() => setManaging(true)}>
            {t('otp.sender.manage')}
          </Button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {knob('ttlMinutes')}
        {knob('length')}
        {knob('resendCooldownSec')}
        {knob('maxAttempts')}
      </div>

      <div className="space-y-3 rounded-md border border-border p-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('otp.template.title')}</h3>
          <Badge tone={TONE[state]}>{t(`otp.template.states.${state}`)}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`otp.template.explain.${template ? template.kind : 'none'}`)}
        </p>
        {template && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('otp.template.name')}</dt>
            <dd dir="ltr" className="font-mono">
              {template.name}
            </dd>
            {template.metaTemplateId && (
              <>
                <dt className="text-muted-foreground">{t('otp.template.metaId')}</dt>
                <dd dir="ltr" className="font-mono">
                  {template.metaTemplateId}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('otp.template.validFor')}</dt>
            <dd>{t('otp.template.minutes', { count: template.codeExpirationMinutes })}</dd>
            <dt className="text-muted-foreground">{t('otp.template.submitted')}</dt>
            <dd>{when(template.submittedAt)}</dd>
            {template.kind === 'waba' && (
              <>
                <dt className="text-muted-foreground">{t('otp.template.checked')}</dt>
                <dd>{when(template.checkedAt)}</dd>
              </>
            )}
            {template.status === 'rejected' && template.rejectedReason && (
              <>
                <dt className="text-muted-foreground">{t('otp.template.reason')}</dt>
                <dd>{template.rejectedReason}</dd>
              </>
            )}
          </dl>
        )}
        {stale && (
          <Alert tone="warning">
            {t('otp.template.stale', { count: template!.codeExpirationMinutes })}
          </Alert>
        )}
        {flash && (
          <Alert tone={flash.tone} className="space-y-1">
            <p>{flash.text}</p>
            {flash.detail && (
              <p className="break-words text-xs" dir="auto">
                {flash.detail}
              </p>
            )}
            {flash.requestId && (
              <p className="text-xs opacity-80">
                {t('requestId')}: <span className="font-mono">{flash.requestId}</span>
              </p>
            )}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={onCreate}
            disabled={dis || create.isPending || refresh.isPending}
          >
            {create.isPending && <Spinner label={t('otp.template.creating')} />}
            {create.isPending ? t('otp.template.creating') : t('otp.template.create')}
          </Button>
          {canRefreshTemplate(template) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFlash(null);
                refresh.mutate();
              }}
              disabled={dis || create.isPending || refresh.isPending}
            >
              {refresh.isPending && <Spinner label={t('otp.template.refreshing')} />}
              {refresh.isPending ? t('otp.template.refreshing') : t('otp.template.refresh')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border p-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('otp.test.about')}</p>
        <Button
          id="otp-test-open"
          variant="secondary"
          onClick={() => setTesting(true)}
          disabled={dis}
        >
          {t('otp.test.button')}
        </Button>
      </div>

      {/*
        Dialogs are portalled to <body>: they sit inside the page's own <form> in the tree, and a
        text field in a nested dialog would otherwise submit that form on Enter. They are mounted
        only while open, so each opening starts clean.
      */}
      {managing &&
        createPortal(
          <SendersModal
            open
            onClose={() => {
              setManaging(false);
              refocus('otp-manage-senders');
            }}
            data={sendersQ.data}
            loading={sendersQ.isPending}
            canEdit={canEdit}
            savedSender={settings.otp.sender}
            onRemoved={onSenderGone}
          />,
          document.body,
        )}
      {testing &&
        createPortal(
          <OtpTestModal
            open
            onClose={() => {
              setTesting(false);
              refocus('otp-test-open');
            }}
            senders={senders}
            initialSender={draft.otpSender.trim()}
          />,
          document.body,
        )}
    </Section>
  );
}
