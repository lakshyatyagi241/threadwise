'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PLAN_UPGRADE_PATH, type LeadEventResponse } from '@crm/contracts';
import { Alert, Badge, Button, Modal, Spinner } from '@crm/ui';
import { fetchEvent, leadKeys } from '../api';
import { guidanceFor, isRetryable, reasonView } from '../lib/event-view';
import { formatPayload } from '../lib/payload';
import { contactHref } from '../lib/source-view';
import { FirstReply } from './first-reply';
import { ErrorText, EventStatusChip, When } from './ui';
import type { RetryState } from './use-retry';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm" dir="auto">
        {children}
      </dd>
    </div>
  );
}

/**
 * One lead event, opened on a click: its facts from the list, and its stored payload fetched only now (opening a payload is audited,
 * so it is never loaded with the list). The payload is shown as formatted, read-only text in a `<pre>`; nothing renders it as HTML.
 * A lead that waits can be retried from here.
 */
export function EventDrawer({
  sourceId,
  event,
  retentionDays,
  canManage,
  retry,
  onClose,
}: {
  sourceId: string;
  /** The event as the list shows it; null = closed. */
  event: LeadEventResponse | null;
  retentionDays: number;
  canManage: boolean;
  retry: RetryState;
  onClose: () => void;
}) {
  const t = useTranslations('lead-sources.event');
  const tg = useTranslations('lead-sources.guidance');
  const tr = useTranslations('lead-sources.reasons');

  const open = event !== null && canManage;
  const detail = useQuery({
    queryKey: leadKeys.event(sourceId, event?.id ?? 'none'),
    queryFn: ({ signal }) => fetchEvent(sourceId, event!.id, signal),
    enabled: open,
    retry: false,
    // A payload is personal data: it is not kept around for the next time the drawer opens.
    gcTime: 0,
    staleTime: 0,
  });

  // The Modal keeps its children in the page even while closed, so nothing is rendered until an event is open.
  if (!event || !canManage) return null;
  const e = detail.data ?? event;
  const guidance = guidanceFor(e.status, e.reason);
  const reason = reasonView(e.reason);
  const result = retry.result?.id === e.id ? retry.result : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('title')}
      eyebrow={<EventStatusChip status={e.status} />}
      closeLabel={t('close')}
      footer={
        <>
          {isRetryable(e) && (
            <Button type="button" disabled={retry.pending} onClick={() => void retry.run(e.id)}>
              {retry.pending && <Spinner />}
              {t('retry')}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info" className="text-xs">
          {t('auditNote')}
        </Alert>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Item label={t('externalId')}>
            <code dir="ltr" className="text-xs">
              {e.externalId}
            </code>
            {e.isTest && (
              <Badge className="ms-2" tone="neutral">
                {t('test')}
              </Badge>
            )}
          </Item>
          <Item label={t('received')}>
            <When value={e.receivedAt} empty="-" />
          </Item>
          <Item label={t('processed')}>
            <When value={e.processedAt} empty={t('notProcessed')} />
          </Item>
          <Item label={t('attempts')}>{e.attempts}</Item>
          {e.duplicateCount > 0 && (
            <Item label={t('duplicates')}>{t('deliveredAgain', { count: e.duplicateCount })}</Item>
          )}
          {reason && <Item label={t('reason')}>{reason.known ? tr(reason.code) : reason.raw}</Item>}
          {e.firstReply && (
            <Item label={t('firstReply')}>
              <FirstReply reply={e.firstReply} />
            </Item>
          )}
          {e.contactId && (
            <Item label={t('contact')}>
              <Link
                href={contactHref(e.contactId)}
                className="text-primary underline underline-offset-2"
              >
                {t('openContact')}
              </Link>
            </Item>
          )}
          {e.dealId && (
            <Item label={t('deal')}>
              <Link
                href={`/deals/${e.dealId}`}
                className="text-primary underline underline-offset-2"
              >
                {t('openDeal')}
              </Link>
            </Item>
          )}
        </dl>

        {e.error && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{t('error')}</div>
            <p dir="auto" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {e.error}
            </p>
          </div>
        )}

        {guidance && (
          <Alert tone={e.status === 'failed' ? 'danger' : 'warning'} className="space-y-1">
            <p>{tg(guidance.key)}</p>
            {guidance.upgrade && (
              <Link href={PLAN_UPGRADE_PATH} className="font-medium underline underline-offset-2">
                {tg('upgrade')}
              </Link>
            )}
          </Alert>
        )}

        {retry.error ? <ErrorText error={retry.error} /> : null}
        {result && (
          <Alert tone="success" data-testid="retry-result">
            <span className="me-2">{t('retried')}</span>
            <EventStatusChip status={result.status} />
          </Alert>
        )}

        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">{t('payload')}</h3>
          {detail.isPending ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('loadingPayload')}
            </div>
          ) : detail.isError ? (
            <ErrorText error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.data.payload ? (
            <pre
              dir="ltr"
              data-testid="event-payload"
              className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-start text-xs"
            >
              {formatPayload(detail.data.payload)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="payload-purged">
              {t('purged', { days: retentionDays })}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
