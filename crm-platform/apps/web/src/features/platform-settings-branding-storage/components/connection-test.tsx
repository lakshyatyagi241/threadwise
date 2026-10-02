'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  setTestResultSchema,
  type SetGroupResponse,
  type SetTestableGroup,
  type SetTestResult,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { Section } from '@/features/auth-registration-security/platform/settings/section-parts';
import { groupKey, hubKey } from '../lib/query-keys';

const NS = 'platform-settings-branding-storage';

/**
 * "Check it against the real service" for mail, storage and real-time. The check always uses the SAVED
 * settings (as in Reference), so while the form has unsaved edits the button is off and says why.
 */
export function ConnectionTest({
  test,
  saved,
  unsaved,
}: {
  test: SetTestableGroup;
  saved: SetGroupResponse;
  unsaved: boolean;
}) {
  const t = useTranslations(`${NS}.test`);
  const format = useFormatter();
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [result, setResult] = useState<SetTestResult | null>(null);

  const run = useMutation({
    mutationFn: () =>
      operatorFetch(`/settings/${test}/test`, {
        method: 'POST',
        body: test === 'mail' ? { to } : undefined,
        schema: setTestResultSchema,
      }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: hubKey });
      void qc.invalidateQueries({ queryKey: groupKey(test) });
    },
    onError: (err) =>
      setResult({
        ok: false,
        message:
          err instanceof ApiError && err.status === 422 ? (err.fieldErrors[0]?.message ?? '') : '',
      }),
  });

  const needsTo = test === 'mail';
  const disabled = unsaved || run.isPending || (needsTo && to.trim() === '');
  return (
    <Section kicker={t('title')} title={t('title')}>
      <div className="space-y-3">
        {needsTo && (
          <Field label={t('mailTo')} htmlFor="set-test-to">
            <Input
              id="set-test-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="email"
            />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => run.mutate()}
          >
            {run.isPending && <Spinner label={t('running')} />}
            {run.isPending ? t('running') : needsTo ? t('mailRun') : t('run')}
          </Button>
          {unsaved && <span className="text-xs text-muted-foreground">{t('saveFirst')}</span>}
        </div>
        {result && (
          <Alert tone={result.ok ? 'success' : 'danger'}>
            <span className="font-semibold">{result.ok ? t('ok') : t('failed')}</span>
            {result.message ? `: ${result.message}` : ''}
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">
          {saved.test?.ok
            ? t('lastOk', {
                when: format.dateTime(new Date(saved.test.at), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('neverTested')}
        </p>
      </div>
    </Section>
  );
}
