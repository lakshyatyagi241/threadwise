'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState, type FormEvent } from 'react';
import { ERROR_CODES, mfaEnableResponseSchema, mfaSetupResponseSchema } from '@crm/contracts';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { formatSecret, recoveryCodesFile } from '../lib/mfa';
import { useOperator } from '../operator-context';
import { isAccountLocked, lockedMinutes } from '../../shared/error-utils';
import { operatorFetch } from '../operator-fetch';
import { OPERATOR_HOME } from '../operator-nav';
import { CopyButton } from '../ui/copy-button';
import { PageHeader } from '../ui/page-header';

const NS = 'auth-registration-security.platform.mfa';

type Stage = { name: 'setup' } | { name: 'codes'; codes: string[] };

const SETUP_KEY = ['operator', 'mfa-setup'] as const;

/**
 * Operator two-factor enrolment: QR + manual secret, a confirming code, recovery codes shown once.
 * Like the account pane, the QR and the key are on screen as soon as the page opens (the API keeps the
 * pending secret for ten minutes, so a reload shows the same code); there is no button to press first.
 */
export function OperatorMfaEnrolment() {
  const t = useTranslations(NS);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { operator } = useOperator();
  const [stage, setStage] = useState<Stage>({ name: 'setup' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fail = (e: unknown) => {
    // Too many wrong codes: the refusal carries how long to wait.
    if (isAccountLocked(e)) {
      const minutes = lockedMinutes(e);
      setError({ message: minutes ? t('errors.lockedWait', { minutes }) : t('errors.locked') });
      return;
    }
    setError({
      message: t('errors.unexpected'),
      requestId: e instanceof ApiError ? e.requestId : undefined,
    });
  };

  const setupQuery = useQuery({
    queryKey: SETUP_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/auth/mfa/setup', { method: 'POST', schema: mfaSetupResponseSchema, signal }),
    enabled: !operator.mfaEnabled && stage.name === 'setup',
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const setup = setupQuery.data;
  const setupError = setupQuery.error;
  // Already on (another tab): the layout knows; reload it.
  const conflict = setupError instanceof ApiError && setupError.code === ERROR_CODES.CONFLICT;
  useEffect(() => {
    if (conflict) router.refresh();
  }, [conflict, router]);

  /** A fresh secret: after the pending one expired, or when the first request failed. */
  function restart() {
    setError(null);
    void queryClient.resetQueries({ queryKey: SETUP_KEY });
  }

  async function enable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t('errors.codeFormat'));
      document.getElementById('mfa-code')?.focus();
      return;
    }
    setCodeError(null);
    setError(null);
    setPending(true);
    try {
      const res = await operatorFetch('/auth/mfa/enable', {
        method: 'POST',
        body: { code },
        schema: mfaEnableResponseSchema,
      });
      setStage({ name: 'codes', codes: res.recoveryCodes });
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_INVALID_CODE) {
        setCodeError(t('errors.codeInvalid'));
        document.getElementById('mfa-code')?.focus();
      } else if (err instanceof ApiError && err.code === ERROR_CODES.AUTH_MFA_SETUP_EXPIRED) {
        setError({ message: t('errors.setupExpired') });
        restart();
      } else fail(err);
    } finally {
      setPending(false);
    }
  }

  function download(codes: string[]) {
    const blob = new Blob(
      [recoveryCodesFile(t('codes.fileHeader', { email: operator.email }), codes)],
      {
        type: 'text/plain;charset=utf-8',
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function done() {
    router.refresh();
    router.replace(OPERATOR_HOME);
  }

  const alreadyOn = operator.mfaEnabled && stage.name !== 'codes';

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description', { email: operator.email })}
      />

      {error && (
        <Alert tone="danger" className="space-y-1">
          <p>{error.message}</p>
          {error.requestId && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{error.requestId}</span>
            </p>
          )}
        </Alert>
      )}

      {alreadyOn && (
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t('status.title')}</h2>
            <Badge tone="success">{t('status.on')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('status.body')}</p>
        </Card>
      )}

      {!alreadyOn && stage.name === 'setup' && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t('intro.title')}</h2>
          <ol className="list-decimal space-y-1.5 ps-5 text-sm text-muted-foreground">
            <li>{t('intro.step1')}</li>
            <li>{t('intro.step2')}</li>
            <li>{t('intro.step3')}</li>
          </ol>
          {!setup && !conflict && setupError ? (
            <div className="space-y-2">
              <Alert tone="danger">{t('errors.unexpected')}</Alert>
              <Button variant="secondary" onClick={restart}>
                {t('intro.begin')}
              </Button>
            </div>
          ) : !setup ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner label={t('intro.starting')} /> {t('intro.starting')}
            </p>
          ) : null}
        </Card>
      )}

      {!alreadyOn && stage.name === 'setup' && setup && (
        <Card className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
            <div
              role="img"
              aria-label={t('setup.qrLabel')}
              className="mx-auto w-fit rounded-md border border-border bg-white p-3 sm:mx-0"
            >
              <QRCodeSVG
                value={setup.otpauthUrl}
                size={176}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
            <div className="min-w-0 space-y-3 text-sm">
              <h2 className="text-lg font-semibold">{t('setup.title')}</h2>
              <p className="text-muted-foreground">{t('setup.scan')}</p>
              <div className="space-y-1.5">
                <p className="font-medium">{t('setup.manualTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('setup.manualHint')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="break-all rounded bg-muted px-2 py-1 font-mono text-sm"
                  >
                    {formatSecret(setup.secret)}
                  </code>
                  <CopyButton text={setup.secret} />
                </div>
              </div>
            </div>
          </div>
          <form
            method="post"
            onSubmit={(e) => void enable(e)}
            noValidate
            className="space-y-3 border-t border-border pt-4"
          >
            <Field
              label={t('setup.codeLabel')}
              htmlFor="mfa-code"
              hint={t('setup.codeHint')}
              error={codeError ?? undefined}
            >
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                dir="ltr"
                invalid={Boolean(codeError)}
                className="max-w-48 font-mono text-lg tracking-[0.4em]"
                onChange={(e) => {
                  e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending && <Spinner label={t('setup.enabling')} />}
                {pending ? t('setup.enabling') : t('setup.enable')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {stage.name === 'codes' && (
        <Card className="space-y-4">
          <Alert tone="success">{t('codes.enabled')}</Alert>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('codes.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('codes.body')}</p>
          </div>
          <ul
            dir="ltr"
            className="grid grid-cols-1 gap-2 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-2"
          >
            {stage.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={stage.codes.join('\n')} label={t('codes.copyAll')} />
            <Button variant="secondary" size="sm" onClick={() => download(stage.codes)}>
              {t('codes.download')}
            </Button>
          </div>
          <Checkbox
            id="mfa-saved"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            label={t('codes.saved')}
          />
          <Button onClick={done} disabled={!saved}>
            {t('codes.continue')}
          </Button>
        </Card>
      )}
    </div>
  );
}
