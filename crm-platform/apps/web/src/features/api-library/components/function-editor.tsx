'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  API_LIBRARY_FUNCTION_MAX,
  type ApiLibraryVariable,
  type TestApiLibraryFunctionResponse,
} from '@crm/contracts';
import { Alert, Button, Spinner, Textarea } from '@crm/ui';
import { apiLibraryApi } from '../api/service';
import { errorKey } from '../lib/errors';
import { formatDuration } from '../lib/format';
import { bodyOf, emptyForm } from '../lib/form-model';
import { CodeBlock } from './parts';
/**
 * "Add function to process payload": JavaScript that defines `processPayload(payload)`. "Run code" runs it alone on the payload typed
 * above (variables replaced by their defaults) in the server's sandbox; the API cannot be tested until the current code has run
 * once without an error (the old console's rule).
 */
export function FunctionEditor({
  code,
  onChange,
  bodyText,
  variables,
  canRun,
  ranOk,
  onRan,
  disabled,
  error,
}: {
  code: string;
  onChange: (code: string) => void;
  bodyText: string;
  variables: ApiLibraryVariable[];
  canRun: boolean;
  /** The current code has run without an error. */
  ranOk: boolean;
  onRan: (ok: boolean, code: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations('api-library.form.function');
  const te = useTranslations('api-library.errors');
  const [result, setResult] = useState<TestApiLibraryFunctionResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: apiLibraryApi.testFunction,
    onSuccess: (r, v) => {
      setResult(r);
      setProblem(null);
      onRan(r.ok, v.functionCode);
    },
    onError: (e, v) => {
      setResult(null);
      setProblem(te(errorKey(e)));
      onRan(false, v.functionCode);
    },
  });

  function runCode() {
    const b = bodyOf({ ...emptyForm(), method: 'POST', payloadType: 'application/json', bodyText });
    if ('problem' in b) {
      setResult(null);
      setProblem(t('badPayload'));
      onRan(false, code);
      return;
    }
    run.mutate({
      functionCode: code,
      payload: b.body ?? {},
      variables: variables.filter((v) => v.defaultValue !== ''),
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={code}
        rows={10}
        dir="ltr"
        spellCheck={false}
        aria-label={t('label')}
        maxLength={API_LIBRARY_FUNCTION_MAX}
        disabled={disabled}
        invalid={error !== undefined}
        className="font-mono text-xs leading-relaxed"
        onChange={(e) => {
          onChange(e.target.value);
          setResult(null);
          setProblem(null);
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !canRun || run.isPending || code.trim() === ''}
          onClick={runCode}
        >
          {run.isPending && <Spinner />}
          {t('run')}
        </Button>
        {!canRun && <span className="text-xs text-muted-foreground">{t('noPermission')}</span>}
        {ranOk && result?.ok && (
          <span className="text-xs text-success">
            {t('ranOk', { time: formatDuration(result.durationMs) })}
          </span>
        )}
      </div>
      {problem && <Alert tone="danger">{problem}</Alert>}
      {result && !result.ok && (
        <Alert tone="danger">
          <p className="font-medium">{t('failed')}</p>
          <p className="mt-1 break-words font-mono text-xs">{result.error ?? t('unknownError')}</p>
        </Alert>
      )}
      {result?.ok && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{t('output')}</p>
          <CodeBlock>{JSON.stringify(result.output, null, 2) ?? 'null'}</CodeBlock>
        </div>
      )}
    </div>
  );
}
