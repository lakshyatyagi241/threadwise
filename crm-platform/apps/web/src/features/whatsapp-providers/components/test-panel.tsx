'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Alert, Badge, Button, Field, Input, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import type { TestInput, TestResult } from '../api/schemas';
import { errorView, testFailureKind } from '../lib/errors';

/** WABA and phone number ids are Meta numeric ids. */
export const META_ID_RE = /^\d{5,24}$/;

export const testIdsValid = (v: TestInput): boolean =>
  META_ID_RE.test(v.wabaId.trim()) && META_ID_RE.test(v.phoneNumberId.trim());

/**
 * The connection test: a WABA id and a phone number id of a real number, one call through the provider, and what came back
 * (display name, quality, throughput, whether it can send) or the classified failure. The result is handed up so the wizard can
 * require a pass before it saves the provider as active.
 */
export function TestPanel({
  values,
  onValues,
  run,
  onResult,
  result,
  disabled,
  blockedReason,
}: {
  values: TestInput;
  onValues: (v: TestInput) => void;
  run: (v: TestInput) => Promise<TestResult>;
  result: TestResult | null;
  onResult: (r: TestResult | null) => void;
  disabled?: boolean;
  /** Shown instead of the button when something earlier in the form must be fixed first. */
  blockedReason?: string;
}) {
  const t = useTranslations('whatsapp-providers.test');
  const te = useTranslations('whatsapp-providers.errors');
  const wabaId = useId();
  const phoneId = useId();
  const valid = testIdsValid(values);

  const mutation = useMutation({
    mutationFn: () =>
      run({ wabaId: values.wabaId.trim(), phoneNumberId: values.phoneNumberId.trim() }),
    onSuccess: (r) => onResult(r),
    onMutate: () => onResult(null),
  });

  const failure = mutation.error;
  const view = failure ? errorView(failure) : null;
  const requestId = failure instanceof ApiError ? failure.requestId : undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('wabaId')} htmlFor={wabaId} hint={t('wabaIdHint')}>
          <Input
            id={wabaId}
            dir="ltr"
            className="font-mono"
            inputMode="numeric"
            value={values.wabaId}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => {
              onValues({ ...values, wabaId: e.target.value });
              onResult(null);
            }}
          />
        </Field>
        <Field label={t('phoneNumberId')} htmlFor={phoneId} hint={t('phoneNumberIdHint')}>
          <Input
            id={phoneId}
            dir="ltr"
            className="font-mono"
            inputMode="numeric"
            value={values.phoneNumberId}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => {
              onValues({ ...values, phoneNumberId: e.target.value });
              onResult(null);
            }}
          />
        </Field>
      </div>
      {blockedReason && <Alert tone="warning">{blockedReason}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={disabled || !valid || mutation.isPending || !!blockedReason}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Spinner label={t('running')} />}
          {mutation.isPending ? t('running') : t('run')}
        </Button>
        {!valid && (values.wabaId || values.phoneNumberId) && (
          <span className="text-xs text-muted-foreground">{t('idsFormat')}</span>
        )}
      </div>

      <div aria-live="polite" className="space-y-3">
        {result?.ok && <TestSuccess result={result} />}
        {result && !result.ok && <TestFailure result={result} />}
        {view && (
          <Alert tone="danger" className="space-y-1">
            <p>{te(view.kind)}</p>
            {requestId && (
              <p className="text-xs opacity-80">
                {te('requestId')}: <span className="font-mono">{requestId}</span>
              </p>
            )}
          </Alert>
        )}
      </div>
    </div>
  );
}

function TestSuccess({ result }: { result: TestResult }) {
  const t = useTranslations('whatsapp-providers.test.success');
  const rows: Array<[string, string | null | undefined]> = [
    [t('displayName'), result.displayName ?? result.verifiedName],
    [t('quality'), result.qualityRating],
    [t('throughput'), result.throughputLevel],
    [t('canSend'), result.canSendMessage],
    [t('latency'), result.latencyMs != null ? `${result.latencyMs} ms` : null],
  ];
  const canSend = result.canSendMessage ? result.canSendMessage.toUpperCase() : null;
  return (
    <Alert tone={canSend && canSend !== 'AVAILABLE' ? 'warning' : 'success'} className="space-y-2">
      <p className="font-medium">{t('title')}</p>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="opacity-80">{k}</dt>
              <dd className="font-medium">
                {k === t('canSend') && canSend ? (
                  <Badge tone={canSend === 'AVAILABLE' ? 'success' : 'warning'}>{v}</Badge>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
      </dl>
    </Alert>
  );
}

function TestFailure({ result }: { result: TestResult }) {
  const t = useTranslations('whatsapp-providers.test.failure');
  const kind = testFailureKind(result.code);
  return (
    <Alert tone="danger" className="space-y-1">
      <p className="font-medium">{t(`${kind}.title`)}</p>
      <p>{t(`${kind}.hint`)}</p>
      {result.code && <p className="font-mono text-xs opacity-80">{result.code}</p>}
    </Alert>
  );
}
