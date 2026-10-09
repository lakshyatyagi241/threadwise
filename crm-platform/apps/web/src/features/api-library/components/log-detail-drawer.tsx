'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Badge, Drawer, Spinner } from '@crm/ui';
import { useApiLog } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { formatDuration, headerLines, prettyBody } from '../lib/format';
import { CARD } from './page-chrome';
import {
  CodeBlock,
  CopyButton,
  LoadError,
  MethodBadge,
  ResultChip,
  StatusCodeBadge,
  useFormatDate,
} from './parts';

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** One run in full: request and response as stored (secrets already masked), status, duration, source, and who or what ran it. */
export function LogDetailDrawer({ logId, onClose }: { logId: string | null; onClose: () => void }) {
  const t = useTranslations('api-library.logs.detail');
  const tc = useTranslations('api-library.common');
  const te = useTranslations('api-library.errors');
  const fmt = useFormatDate();
  const q = useApiLog(logId);
  const log = q.data;

  return (
    <Drawer
      open={logId !== null}
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      className="w-[min(44rem,100vw)]"
    >
      {q.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : q.isError ? (
        <LoadError message={te(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : log ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <MethodBadge method={log.method} />
            <StatusCodeBadge code={log.statusCode} />
            <ResultChip ok={log.ok} />
            <Badge>{tc(`source.${log.source}`)}</Badge>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDuration(log.durationMs)}
            </span>
          </div>
          <Alert>
            <span className="font-mono text-xs font-semibold">********</span> {t('masked')}
          </Alert>
          <Section title={t('basic')}>
            <dl className="space-y-2.5">
              <Row label={t('created')}>{fmt(log.createdAt)}</Row>
              <Row label={t('api')}>
                {log.apiId ? (
                  <Link href={`/api-library/${log.apiId}`} className="text-primary underline">
                    {log.apiName}
                  </Link>
                ) : (
                  log.apiName || t('unsaved')
                )}
              </Row>
              <Row label={t('url')}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs" dir="ltr">
                    {log.url}
                  </span>
                  <CopyButton iconOnly text={log.url} label={t('copyUrl')} />
                </span>
              </Row>
              <Row label={t('duration')}>{formatDuration(log.durationMs)}</Row>
              {log.errorKind && (
                <Row label={t('errorKind')}>{tc(`errorKind.${log.errorKind}`)}</Row>
              )}
              {log.error && (
                <Row label={t('error')}>
                  <span className="text-danger">{log.error}</span>
                </Row>
              )}
            </dl>
          </Section>

          <Section title={t('requestHeaders')}>
            <CodeBlock>
              {headerLines(log.requestHeaders)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n') || t('none')}
            </CodeBlock>
          </Section>
          <Section
            title={t('requestBody')}
            action={
              log.requestBody ? (
                <CopyButton text={log.requestBody} label={t('copyRequest')} />
              ) : null
            }
          >
            <CodeBlock>{prettyBody(log.requestBody) || t('none')}</CodeBlock>
          </Section>

          <Section title={t('responseHeaders')}>
            <CodeBlock>
              {headerLines(log.responseHeaders)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n') || t('none')}
            </CodeBlock>
          </Section>
          <Section
            title={t('responseBody')}
            action={
              log.responseBody ? (
                <CopyButton text={log.responseBody} label={t('copyResponse')} />
              ) : null
            }
          >
            {log.responseTruncated && <Alert tone="warning">{t('truncated')}</Alert>}
            <CodeBlock>{prettyBody(log.responseBody) || t('none')}</CodeBlock>
          </Section>

          <Section title={t('context')}>
            <dl className="space-y-2.5">
              {log.context.flowId && (
                <Row label={t('flow')}>
                  <Link
                    href={`/flows/builder/${log.context.flowId}`}
                    className="text-primary underline"
                  >
                    {t('openFlow')}
                  </Link>
                </Row>
              )}
              {log.context.flowRunId && (
                <Row label={t('flowRun')}>
                  <span className="font-mono text-xs" dir="ltr">
                    {log.context.flowRunId}
                  </span>
                </Row>
              )}
              {log.context.flowNodeId && (
                <Row label={t('flowNode')}>
                  <span className="font-mono text-xs" dir="ltr">
                    {log.context.flowNodeId}
                  </span>
                </Row>
              )}
              {log.context.contactId && (
                <Row label={t('contact')}>
                  <Link
                    href={`/contacts/${log.context.contactId}`}
                    className="text-primary underline"
                  >
                    {t('openContact')}
                  </Link>
                </Row>
              )}
              {log.context.userId && (
                <Row label={t('user')}>
                  <span className="font-mono text-xs" dir="ltr">
                    {log.context.userId}
                  </span>
                </Row>
              )}
              {!log.context.flowId &&
                !log.context.flowRunId &&
                !log.context.contactId &&
                !log.context.userId && (
                  <p className="text-sm text-muted-foreground">{t('noContext')}</p>
                )}
            </dl>
          </Section>
        </div>
      ) : null}
    </Drawer>
  );
}
