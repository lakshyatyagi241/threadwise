'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProviderTestResult, WhatsappProvider } from '@crm/contracts';
import { Alert, Badge, Button, Field, Input, PasswordInput, Spinner } from '@crm/ui';
import { previewUrl } from '../lib/base-url';
import { testProvider, wapKeys } from '../api';
import {
  buildTestRequest,
  emptyTestForm,
  takesChannelToken,
  testHint,
  type TestForm,
} from '../lib/test-result';
import { ErrorLine, Section } from './ui';

const NS = 'whatsapp-providers.test';

/**
 * Test connection: one authenticated read to the provider (`GET <base>/<version><path>`, default `/me`) with the stored credential.
 * The ids and the test token only fill header placeholders for that call. They are forgotten by the server and cleared here
 * as soon as the call is made, and nothing the operator typed is ever shown again; the answer's message has every secret removed.
 */
export function TestPanel({ provider, canTest }: { provider: WhatsappProvider; canTest: boolean }) {
  const t = useTranslations(NS);
  const th = useTranslations(`${NS}.hints`);
  const format = useFormatter();
  const qc = useQueryClient();
  const ids = { path: useId(), waba: useId(), phone: useId(), token: useId() };
  const [form, setForm] = useState<TestForm>(emptyTestForm);
  const [invalid, setInvalid] = useState<keyof TestForm | null>(null);

  const run = useMutation({
    mutationFn: (body: Parameters<typeof testProvider>[1]) => testProvider(provider.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: wapKeys.all }),
  });

  const submit = () => {
    const req = buildTestRequest(form);
    if (!req.ok) {
      setInvalid(req.field);
      return;
    }
    setInvalid(null);
    run.mutate(req.body);
    // The test token is used for this one call; do not keep it in the form.
    setForm((f) => ({ ...f, channelToken: '' }));
  };

  const result: ProviderTestResult | null = run.data?.result ?? provider.lastTest;
  const fromThisSession = !!run.data;
  const url = previewUrl(provider.baseUrl, provider.apiVersion, form.path.trim() || '/me');
  const showToken = takesChannelToken(provider);

  return (
    <Section id="test" title={t('title')} description={t('description')}>
      {canTest ? (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('path')}
              htmlFor={ids.path}
              hint={url ? t('willCall', { url }) : t('pathHint')}
              error={invalid === 'path' ? t('pathInvalid') : undefined}
            >
              <Input
                id={ids.path}
                dir="ltr"
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                invalid={invalid === 'path'}
              />
            </Field>
            <Field
              label={t('wabaId')}
              htmlFor={ids.waba}
              hint={t('idsHint')}
              error={invalid === 'wabaId' ? t('idInvalid') : undefined}
            >
              <Input
                id={ids.waba}
                dir="ltr"
                value={form.wabaId}
                onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                invalid={invalid === 'wabaId'}
              />
            </Field>
            <Field
              label={t('phoneNumberId')}
              htmlFor={ids.phone}
              error={invalid === 'phoneNumberId' ? t('idInvalid') : undefined}
            >
              <Input
                id={ids.phone}
                dir="ltr"
                value={form.phoneNumberId}
                onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
                invalid={invalid === 'phoneNumberId'}
              />
            </Field>
            {showToken && (
              <Field
                label={t('channelToken')}
                htmlFor={ids.token}
                hint={t('channelTokenHint')}
                error={invalid === 'channelToken' ? t('tokenInvalid') : undefined}
              >
                <PasswordInput
                  id={ids.token}
                  value={form.channelToken}
                  onChange={(e) => setForm({ ...form, channelToken: e.target.value })}
                  autoComplete="new-password"
                  spellCheck={false}
                  invalid={invalid === 'channelToken'}
                  showLabel={t('show')}
                  hideLabel={t('hide')}
                />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={run.isPending}>
              {run.isPending && <Spinner />}
              {run.isPending ? t('running') : t('run')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('forgotten')}</span>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('needManage')}</p>
      )}

      {run.isError && <ErrorLine error={run.error} />}

      {result ? (
        <div className="space-y-3" aria-live="polite" data-testid="test-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.ok ? 'success' : 'danger'}>
              {result.ok ? t('ok') : t('failed')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {fromThisSession ? t('justNow') : t('lastTest')} ·{' '}
              <time dateTime={result.testedAt}>
                {format.dateTime(new Date(result.testedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{t('httpStatus')}</dt>
            <dd className="tabular-nums">{result.httpStatus ?? t('noResponse')}</dd>
            <dt className="text-muted-foreground">{t('latency')}</dt>
            <dd className="tabular-nums">{t('ms', { ms: result.latencyMs })}</dd>
            {result.errorCode && (
              <>
                <dt className="text-muted-foreground">{t('errorCode')}</dt>
                <dd className="font-mono text-xs">{result.errorCode}</dd>
              </>
            )}
          </dl>
          {result.message && (
            <div className="space-y-1">
              <p className="text-xs font-medium">{t('message')}</p>
              <pre
                dir="ltr"
                className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-start font-mono text-xs"
              >
                {result.message}
              </pre>
              <p className="text-xs text-muted-foreground">{t('redactedNote')}</p>
            </div>
          )}
          {!result.ok && <Alert tone="warning">{th(testHint(result))}</Alert>}
          {result.ok && <Alert tone="success">{th('ok')}</Alert>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('never')}</p>
      )}
    </Section>
  );
}
