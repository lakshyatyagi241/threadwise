'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { TestApiLibraryApiResponse } from '@crm/contracts';
import { Alert, Button, Spinner, Tabs, cn } from '@crm/ui';
import { formatBytes, formatDuration, headerLines, prettyBody } from '../lib/format';
import type { PathUse } from '../lib/paths';
import { PlayIcon } from './icons';
import { CodeBlock, CopyButton, StatusCodeBadge } from './parts';
import { ResponseTree } from './response-tree';

/**
 * The right half of the form: "Run test" and what came back, so the response can be read and its fields picked for the flow
 * variables and the contact mapping. The API is only saved after a test passed (the old console's rule).
 */
export function TestPanel({
  result,
  pending,
  canTest,
  blocked,
  onRun,
  flowPaths,
  mappingPaths,
  onAdd,
  onRemove,
  disabled,
}: {
  result: TestApiLibraryApiResponse | null;
  pending: boolean;
  canTest: boolean;
  /** Why the test cannot start right now (the function was not run yet), or null. */
  blocked: string | null;
  onRun: () => void;
  flowPaths: readonly string[];
  mappingPaths: readonly string[];
  onAdd: (path: string, use: PathUse) => void;
  onRemove: (path: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.test');
  const tc = useTranslations('api-library.common');
  const [raw, setRaw] = useState(false);

  return (
    <section aria-labelledby="alib-test-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="alib-test-h" className="text-base font-semibold">
          {t('title')}
        </h2>
        <Button onClick={onRun} disabled={!canTest || pending || disabled}>
          {pending ? <Spinner /> : <PlayIcon />}
          {t('run')}
        </Button>
      </div>
      {!canTest && <Alert>{t('noPermission')}</Alert>}
      {blocked && <Alert tone="warning">{blocked}</Alert>}

      <div aria-live="polite" className="space-y-3">
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('running')}
          </p>
        ) : result === null ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <>
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <dt className="sr-only">{t('result')}</dt>
                <dd
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold',
                    result.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', result.ok ? 'bg-success' : 'bg-danger')}
                  />
                  {result.ok ? t('passed') : t('failedRun')}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">{t('status')}</dt>
                <dd>
                  <StatusCodeBadge code={result.status} />
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">{t('time')}</dt>
                <dd className="font-medium tabular-nums">{formatDuration(result.durationMs)}</dd>
              </div>
              {result.response && (
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">{t('size')}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatBytes(result.response.sizeBytes)}
                  </dd>
                </div>
              )}
              {result.response?.truncated && <div className="text-warning">{t('truncated')}</div>}
            </dl>
            {!result.ok && (
              <Alert tone="danger">
                <p className="font-medium">
                  {result.errorKind ? tc(`errorKind.${result.errorKind}`) : t('failedRun')}
                </p>
                {result.error && <p className="mt-1 break-words text-xs">{result.error}</p>}
                {result.errorKind && (
                  <p className="mt-1 text-xs">{t(`hint.${result.errorKind}`)}</p>
                )}
              </Alert>
            )}
            <Tabs
              items={[
                {
                  id: 'body',
                  label: t('tab.body'),
                  content: (
                    <ResponseBody
                      result={result}
                      raw={raw}
                      onRaw={setRaw}
                      flowPaths={flowPaths}
                      mappingPaths={mappingPaths}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      disabled={disabled}
                    />
                  ),
                },
                {
                  id: 'headers',
                  label: t('tab.headers'),
                  content: (
                    <CodeBlock className="max-h-[28rem]">
                      {result.response
                        ? headerLines(result.response.headers)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join('\n') || t('none')
                        : t('none')}
                    </CodeBlock>
                  ),
                },
                {
                  id: 'request',
                  label: t('tab.request'),
                  content: result.request ? (
                    <div className="space-y-2">
                      <p className="break-all font-mono text-xs" dir="ltr">
                        {result.request.method} {result.request.url}
                      </p>
                      <CodeBlock>
                        {headerLines(result.request.headers)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join('\n') || t('none')}
                      </CodeBlock>
                      {result.request.body && (
                        <CodeBlock>{prettyBody(result.request.body)}</CodeBlock>
                      )}
                      <p className="text-xs text-muted-foreground">{t('masked')}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('noRequest')}</p>
                  ),
                },
                ...(result.processedPayload != null
                  ? [
                      {
                        id: 'processed',
                        label: t('tab.processed'),
                        content: (
                          <CodeBlock>{JSON.stringify(result.processedPayload, null, 2)}</CodeBlock>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}
      </div>
    </section>
  );
}

function ResponseBody({
  result,
  raw,
  onRaw,
  flowPaths,
  mappingPaths,
  onAdd,
  onRemove,
  disabled,
}: {
  result: TestApiLibraryApiResponse;
  raw: boolean;
  onRaw: (v: boolean) => void;
} & Pick<
  Parameters<typeof TestPanel>[0],
  'flowPaths' | 'mappingPaths' | 'onAdd' | 'onRemove' | 'disabled'
>) {
  const t = useTranslations('api-library.test');
  const res = result.response;
  if (!res) return <p className="text-sm text-muted-foreground">{t('noResponse')}</p>;
  const json = res.bodyJson;
  const tree = json !== null && json !== undefined && !raw;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={t('view')}>
          <Button
            size="sm"
            variant={tree ? 'primary' : 'secondary'}
            disabled={json == null}
            aria-pressed={tree}
            onClick={() => onRaw(false)}
          >
            {t('treeView')}
          </Button>
          <Button
            size="sm"
            variant={tree ? 'secondary' : 'primary'}
            aria-pressed={!tree}
            onClick={() => onRaw(true)}
          >
            {t('rawView')}
          </Button>
        </div>
        <CopyButton text={res.bodyText} label={t('copyBody')} />
      </div>
      {tree ? (
        <div className="thin-scrollbar max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted/30 p-3">
          <ResponseTree
            json={json}
            flowPaths={flowPaths}
            mappingPaths={mappingPaths}
            onAdd={onAdd}
            onRemove={onRemove}
            disabled={disabled}
          />
        </div>
      ) : (
        <CodeBlock className="max-h-[28rem]">
          {prettyBody(res.bodyText) || t('emptyBody')}
        </CodeBlock>
      )}
      {json == null && res.bodyText !== '' && (
        <p className="text-xs text-muted-foreground">{t('notJson')}</p>
      )}
    </div>
  );
}
