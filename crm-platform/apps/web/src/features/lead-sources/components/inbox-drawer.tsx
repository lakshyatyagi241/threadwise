'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { PLAN_UPGRADE_PATH, type LeadInboxItem } from '@crm/contracts';
import { Alert, Button, Drawer, Spinner } from '@crm/ui';
import { fetchEvent, leadKeys } from '../api';
import { fetchInboxItem, opsKeys, retryInboxItem } from '../api-ops';
import { leadError } from '../lib/errors';
import { guidanceFor, isKnownReason } from '../lib/event-view';
import type { RetrySummary } from '../lib/inbox-view';
import { formatPayload } from '../lib/payload';
import { contactHref, sourceHref } from '../lib/source-view';
import { FirstReply } from './first-reply';
import { ErrorText, EventStatusChip, When } from './ui';

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
 * One delivery of the lead inbox, in a side panel. Its payload is fetched only when it opens (opening a payload is audited) and arrives
 * MASKED: phone numbers, e-mail addresses, names, addresses and free text are hidden and secrets redacted, by the server, so the
 * personal data never reaches this page unless the person asks for it. "Show the original" is the source's own event route, which
 * writes its own audit row (action `export`); it is offered only to someone who may manage lead sources, like everything here.
 */
export function InboxDrawer({
  item,
  canManage,
  onClose,
  onRetried,
}: {
  item: LeadInboxItem | null;
  canManage: boolean;
  onClose: () => void;
  onRetried: (summary: RetrySummary) => void;
}) {
  const t = useTranslations('lead-sources.inbox.drawer');
  const tg = useTranslations('lead-sources.guidance');
  const tr = useTranslations('lead-sources.reasons');
  const qc = useQueryClient();
  const [original, setOriginal] = useState(false);

  const open = item !== null && canManage;
  const detail = useQuery({
    queryKey: opsKeys.item(item?.id ?? 'none'),
    queryFn: ({ signal }) => fetchInboxItem(item!.id, signal),
    enabled: open,
    retry: false,
    // A payload is personal data: it is not kept around for the next time the panel opens.
    gcTime: 0,
    staleTime: 0,
  });
  const raw = useQuery({
    queryKey: leadKeys.event(item?.sourceId ?? 'none', item?.id ?? 'none'),
    queryFn: ({ signal }) => fetchEvent(item!.sourceId, item!.id, signal),
    enabled: open && original,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  const retry = useMutation({
    mutationFn: () => retryInboxItem(item!.id),
    onSuccess: (after) => {
      void qc.invalidateQueries({ queryKey: opsKeys.all });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      onRetried({
        retried: 1,
        skipped: {},
        fixed: after.status === 'created' || after.status === 'updated' ? 1 : 0,
        stillWaiting: after.status === 'needs_review' || after.status === 'failed' ? 1 : 0,
      });
    },
  });

  const e = detail.data ?? item;
  const close = () => {
    setOriginal(false);
    onClose();
  };
  // The panel keeps its children in the page even while closed, so nothing is rendered until a lead is open.
  if (!item || !e)
    return (
      <Drawer open={false} onClose={close} title="" closeLabel={t('close')}>
        {null}
      </Drawer>
    );

  const guidance = guidanceFor(e.status, e.reason);
  const payload = original && raw.data?.payload ? raw.data.payload : detail.data?.payload;

  return (
    <Drawer
      open
      onClose={close}
      title={
        <span className="inline-flex items-center gap-2">
          {t('title')} <EventStatusChip status={e.status} />
        </span>
      }
      closeLabel={t('close')}
      footer={
        <>
          {e.retryable && (
            <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {retry.isPending && <Spinner />}
              {t('retry')}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={close}>
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
          <Item label={t('source')}>
            <Link
              href={sourceHref(e.sourceId)}
              className="text-primary underline underline-offset-2"
            >
              {e.sourceName}
            </Link>
          </Item>
          <Item label={t('lead')}>
            <code dir="ltr" className="text-xs">
              {e.externalId}
            </code>
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
          {e.reason && (
            <Item label={t('reason')}>{isKnownReason(e.reason) ? tr(e.reason) : e.reason}</Item>
          )}
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
        {retry.isError && <ErrorText mapped={leadError(retry.error)} />}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('payload')}</h3>
            {detail.data?.payload && !original && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setOriginal(true)}>
                {t('showOriginal')}
              </Button>
            )}
          </div>
          {detail.isPending ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('loadingPayload')}
            </div>
          ) : detail.isError ? (
            <ErrorText error={detail.error} onRetry={() => void detail.refetch()} />
          ) : payload ? (
            <>
              <p className="text-xs text-muted-foreground" data-testid="payload-note">
                {original
                  ? t('originalNote')
                  : detail.data.payloadMasked
                    ? t('maskedNote')
                    : t('nothingToMask')}
              </p>
              <pre
                dir="ltr"
                data-testid="inbox-payload"
                className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-start text-xs"
              >
                {formatPayload(payload)}
              </pre>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="payload-purged">
              {t('purged')}
            </p>
          )}
          {original && raw.isError && <ErrorText error={raw.error} />}
        </div>
      </div>
    </Drawer>
  );
}
