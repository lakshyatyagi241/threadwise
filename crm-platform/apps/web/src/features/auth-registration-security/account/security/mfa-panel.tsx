'use client';

import { ERROR_CODES, mfaEnableRequestSchema, type MfaSetupResponse } from '@crm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Field, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { CodeInput } from '../../shared/code-input';
import { copyText } from '../../shared/clipboard';
import { ErrorNote } from '../../shared/error-note';
import { focusFirstInvalid } from '../../shared/focus';
import { redirectOnGateError } from '../../shared/gate-errors';
import { CheckIcon, CopyIcon, ShieldIcon } from '../../shared/icons';
import { showFlash } from '../../shared/flash';
import { useSession } from '../../shared/session-context';
import { useGateRedirect } from '../../shared/use-gate-redirect';
import { authApi, keys } from '../api';
import { groupSecret } from './mfa-format';
import { PasswordConfirmModal } from './password-confirm-modal';
import { RecoveryCodes } from './recovery-codes';

type Phase =
  | { kind: 'idle' }
  | { kind: 'codes'; codes: string[]; origin: 'enable' | 'regenerate'; wasForced: boolean }
  | { kind: 'disable' }
  | { kind: 'regenerate' };

/** Recovery codes are running out at this many or fewer. */
const LOW_CODES = 2;

/**
 * Two-factor authentication (WD-AUTH-030). While it is off the pane opens
 * with the setup already on screen, as WaDesk's does: a QR code (drawn in the
 * browser, the secret never leaves it) and the manual key, then a six-digit
 * code to confirm; the ten recovery codes appear once. The API keeps the pending
 * secret for ten minutes, so a reload shows the same QR. Turn off and replace
 * recovery codes both ask for the password. WaDesk sent the secret to a
 * third-party QR service, never asked for the code at sign-in and had no
 * recovery codes; the API here enforces it at every sign-in.
 */
export function MfaPanel({ forcedByUrl }: { forcedByUrl: boolean }) {
  const t = useTranslations('auth-registration-security.account.mfa');
  const c = useTranslations('auth-registration-security.account.common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const format = useFormatter();
  const { flags } = useSession();
  const status = useQuery({ queryKey: keys.mfa, queryFn: authApi.mfaStatus, staleTime: 0 });
  useGateRedirect(status.error);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<'disabled' | null>(null);

  const forced = flags.mfaEnrolmentRequired || forcedByUrl;

  // The pending secret is fetched as soon as the pane knows two-factor is off: no button first.
  const wantsSetup = status.data?.enabled === false && phase.kind === 'idle';
  const setup = useQuery({
    queryKey: keys.mfaSetup,
    queryFn: authApi.mfaSetup,
    enabled: wantsSetup,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useGateRedirect(setup.error);
  // Already on in another tab: show the real state instead of an error.
  const conflict = setup.error instanceof ApiError && setup.error.code === ERROR_CODES.CONFLICT;
  const refetchStatus = status.refetch;
  useEffect(() => {
    if (conflict) void refetchStatus();
  }, [conflict, refetchStatus]);

  /** A fresh secret: after the pending one expired, or when the first request failed. */
  function restartSetup() {
    void queryClient.resetQueries({ queryKey: keys.mfaSetup });
  }

  function finishEnable(codes: string[]) {
    setPhase({
      kind: 'codes',
      codes,
      origin: 'enable',
      wasForced: flags.mfaEnrolmentRequired || forcedByUrl,
    });
    void queryClient.invalidateQueries({ queryKey: keys.mfa });
    // The session's mfaEnabled and the gate flags change.
    router.refresh();
  }

  function codesAcknowledged() {
    const wasForced = phase.kind === 'codes' && phase.wasForced;
    setPhase({ kind: 'idle' });
    if (wasForced && !flags.passwordChangeRequired) {
      showFlash(t('forcedDone'));
      router.replace('/');
    }
  }

  let body: ReactNode;
  if (status.isPending) {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={c('loading')} /> {c('loading')}
      </p>
    );
  } else if (status.isError) {
    body = (
      <div className="space-y-3">
        <ErrorNote error={status.error} />
        <Button variant="secondary" onClick={() => void status.refetch()}>
          {c('retry')}
        </Button>
      </div>
    );
  } else if (phase.kind === 'codes') {
    body = (
      <RecoveryCodes
        codes={phase.codes}
        title={phase.origin === 'enable' ? t('codesTitleEnabled') : t('codesTitleRegenerated')}
        onDone={codesAcknowledged}
      />
    );
  } else if (status.data.enabled) {
    const data = status.data;
    const low = data.recoveryCodesRemaining <= LOW_CODES;
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">
            <CheckIcon className="me-1 size-3" />
            {t('on')}
          </Badge>
          {data.confirmedAt && (
            <span className="text-sm text-muted-foreground">
              {t('since', {
                date: format.dateTime(new Date(data.confirmedAt), { dateStyle: 'medium' }),
              })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('onDescription')}</p>
        <p className="text-sm">
          {t('remaining', { count: data.recoveryCodesRemaining })}
          {low && <span className="ms-2 font-medium text-warning">{t('remainingLow')}</span>}
        </p>
        {notice === 'disabled' && <Alert tone="success">{t('disabledDone')}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPhase({ kind: 'regenerate' })}>
            {t('regenerate')}
          </Button>
          <Button variant="secondary" onClick={() => setPhase({ kind: 'disable' })}>
            {t('disable')}
          </Button>
        </div>
      </div>
    );
  } else if (setup.isSuccess && wantsSetup) {
    body = (
      <SetupView
        setup={setup.data}
        offDescription={t('offDescription')}
        notice={notice === 'disabled' ? t('disabledDone') : null}
        onRestart={restartSetup}
        onEnabled={finishEnable}
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        {notice === 'disabled' && <Alert tone="success">{t('disabledDone')}</Alert>}
        <p className="text-sm text-muted-foreground">{t('offDescription')}</p>
        {setup.isError && !conflict ? (
          <div className="space-y-3">
            <ErrorNote error={setup.error} />
            <Button variant="secondary" onClick={restartSetup}>
              {c('retry')}
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner label={t('starting')} /> {t('starting')}
          </p>
        )}
      </div>
    );
  }

  return (
    <Card id="two-factor" className="scroll-mt-20 space-y-4 p-5">
      <div className="flex items-start gap-3">
        <ShieldIcon className="mt-1 size-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>
      {forced && !status.data?.enabled && <Alert tone="warning">{t('forcedBanner')}</Alert>}
      {body}

      {phase.kind === 'disable' && (
        <PasswordConfirmModal
          title={t('disableTitle')}
          description={t('disableDescription')}
          confirmLabel={t('disableConfirm')}
          danger
          onClose={() => setPhase({ kind: 'idle' })}
          onConfirm={async (password) => {
            await authApi.mfaDisable(password);
            setPhase({ kind: 'idle' });
            setNotice('disabled');
            await queryClient.invalidateQueries({ queryKey: keys.mfa });
            router.refresh();
          }}
        />
      )}
      {phase.kind === 'regenerate' && (
        <PasswordConfirmModal
          title={t('regenerateTitle')}
          description={t('regenerateDescription')}
          confirmLabel={t('regenerateConfirm')}
          onClose={() => setPhase({ kind: 'idle' })}
          onConfirm={async (password) => {
            const result = await authApi.regenerateRecoveryCodes(password);
            setPhase({
              kind: 'codes',
              codes: result.recoveryCodes,
              origin: 'regenerate',
              wasForced: false,
            });
            void queryClient.invalidateQueries({ queryKey: keys.mfa });
          }}
        />
      )}
    </Card>
  );
}

function SetupView({
  setup,
  offDescription,
  notice,
  onRestart,
  onEnabled,
}: {
  setup: MfaSetupResponse;
  offDescription: string;
  notice: string | null;
  onRestart: () => void;
  onEnabled: (codes: string[]) => void;
}) {
  const t = useTranslations('auth-registration-security.account.mfa');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!mfaEnableRequestSchema.safeParse({ code }).success) {
      setFieldError(t('codeInvalid'));
      focusFirstInvalid(formRef.current);
      return;
    }
    setPending(true);
    setFieldError(null);
    try {
      const result = await authApi.mfaEnable(code);
      onEnabled(result.recoveryCodes);
    } catch (err) {
      if (redirectOnGateError(err, router.replace, '/account/security')) return;
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_INVALID_CODE) {
        setFieldError(t('codeWrong'));
        focusFirstInvalid(formRef.current);
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_SETUP_EXPIRED) {
        setExpired(true);
      } else {
        setError(err);
      }
      setPending(false);
    }
  }

  async function copySecret() {
    setCopied(await copyText(setup.secret));
  }

  return (
    <div className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      <p className="text-sm text-muted-foreground">{offDescription}</p>

      <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-4">
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t('step1')}</li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
          </ol>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('manualKey')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                dir="ltr"
                data-testid="mfa-secret"
                className="select-all break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm tracking-wider"
              >
                {groupSecret(setup.secret)}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={() => void copySecret()}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('manualKeyHint')}</p>
          </div>

          {expired ? (
            <div className="space-y-3">
              <Alert tone="warning">{t('expired')}</Alert>
              <Button onClick={onRestart}>{t('restart')}</Button>
            </div>
          ) : (
            <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
              <Field
                label={t('codeLabel')}
                htmlFor="mfa-enable-code"
                hint={t('codeHint')}
                error={fieldError}
              >
                <CodeInput
                  id="mfa-enable-code"
                  value={code}
                  onValueChange={(v) => {
                    setCode(v);
                    setFieldError(null);
                  }}
                  invalid={Boolean(fieldError)}
                  required
                  className="max-w-48"
                />
              </Field>
              <ErrorNote error={error} />
              <Button type="submit" disabled={pending}>
                {pending && <Spinner label={t('enabling')} />}
                {pending ? t('enabling') : t('enable')}
              </Button>
            </form>
          )}
        </div>

        {/* On a phone the code to scan comes first; beside the form on wider screens. */}
        <div className="order-first space-y-2 sm:order-last">
          <p className="text-sm font-medium">{t('scanTitle')}</p>
          {/* The QR needs a light background to scan, in the dark theme too. */}
          <div className="inline-block rounded-md border border-border bg-white p-2">
            <QRCodeSVG
              value={setup.otpauthUrl}
              size={176}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
              title={t('qrLabel')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
