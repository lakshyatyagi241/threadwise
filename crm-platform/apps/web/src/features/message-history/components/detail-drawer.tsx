'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, Drawer, Spinner, useToast } from '@crm/ui';
import { MESSAGE_LOG_HOT_DAYS, MESSAGE_LOG_RETENTION_DAYS } from '@crm/contracts';
import { FailureNote } from '@/features/channel-whatsapp-cloud';
import { MessageLogTimeline } from '@/features/team-inbox-conversations';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useHistoryDetail } from '../api/history';
import { formatMinor, fullStamp } from '../lib/format';
import { Avatar, DirectionMark, StatusMark, TypePill, rowName, useErrorText } from './parts';

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/60 p-2">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-mono text-[11.5px]">{children}</dd>
    </div>
  );
}

/**
 * One message or recipient row: who, what and how it went. Reference's side panel (direction, status, type, time, text, failure,
 * metadata) plus the delivery steps the log keeps, read from the archive for a message older than the live window. The text is shown
 * whole here because the caller can open this conversation; it is customer-written, so it is marked for the help assistant.
 */
export function DetailDrawer({ id, tz, onClose }: { id: string; tz: string; onClose: () => void }) {
  const t = useTranslations('message-history.drawer');
  const locale = useLocale();
  const errorText = useErrorText();
  const { toast } = useToast();
  const canContact = useCan('record.contacts.read');
  const q = useHistoryDetail(id);
  const d = q.data;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('copied'), 'success');
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  };

  const name = d ? rowName(d, t('unknown')) : '';
  const entityHref = d?.entity
    ? `${{ broadcast: '/broadcasts', campaign: '/campaigns', scheduled: '/scheduled' }[d.entity.kind]}/${d.entity.id}`
    : null;

  return (
    <Drawer
      open={id !== ''}
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        d ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copy(d.id)}>
              {t('copyId')}
            </Button>
            {d.conversationId && (
              <Link
                href={`/inbox?c=${d.conversationId}`}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('openChat')}
              </Link>
            )}
            {canContact && d.contact.id && (
              <Link
                href={`/contacts/${d.contact.id}`}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('openContact')}
              </Link>
            )}
            {entityHref && d.entity && (
              <Link
                href={entityHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t(`openEntity.${d.entity.kind}`)}
              </Link>
            )}
          </div>
        ) : undefined
      }
    >
      <div data-testid="history-drawer" className="space-y-4 text-sm">
        {q.isPending && id !== '' && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Spinner /> {t('loading')}
          </p>
        )}
        {q.isError && (
          <div className="space-y-2">
            <Alert tone="danger">{errorText(q.error)}</Alert>
            <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
              {t('tryAgain')}
            </Button>
          </div>
        )}
        {d && (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={name} seed={d.id} className="size-10 text-xs" />
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  <span data-agent-ignore>{name}</span>
                </div>
                <div
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={d.recipient.masked ? t('masked') : undefined}
                >
                  {d.recipient.value ?? '—'}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2">
              <Cell label={t('direction')}>
                <span className="inline-flex items-center gap-1.5">
                  <DirectionMark row={d} />
                  {t(`directionValue.${d.direction}`)}
                </span>
              </Cell>
              <Cell label={t('status')}>
                <StatusMark status={d.status} />
              </Cell>
              <Cell label={t('type')}>
                <TypePill type={d.type} />
              </Cell>
              <Cell label={t('when')}>{fullStamp(d.at, locale, tz)}</Cell>
            </dl>

            <section>
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('content')}
              </h3>
              <div
                data-agent-ignore
                data-testid="drawer-body"
                className="max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border p-2.5 text-[12.5px] leading-snug"
              >
                {d.body ?? (d.mediaName ? d.mediaName : t('noText'))}
              </div>
            </section>

            {(d.status === 'failed' || d.failure) && (
              <section>
                <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-danger">
                  {t('failure')}
                </h3>
                <p
                  data-testid="drawer-failure"
                  className="rounded-md border border-danger/30 bg-danger/10 p-2 text-[12px] text-danger"
                >
                  <FailureNote
                    failure={d.failure}
                    fallback={t('failedNoReason')}
                    channelKind={d.channel?.kind}
                  />
                  {d.failure?.code && (
                    <span className="mt-1 block font-mono text-[11px] opacity-80">
                      {d.failure.code}
                      {d.failure.reason ? ` · ${d.failure.reason}` : ''}
                    </span>
                  )}
                </p>
              </section>
            )}

            <section>
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('details')}
              </h3>
              <dl className="space-y-1 text-[11.5px]">
                <Row label={t('messageId')}>{d.id}</Row>
                <Row label={t('source')}>{t(`sourceValue.${d.source}`)}</Row>
                {d.channel && <Row label={t('channel')}>{d.channel.name}</Row>}
                {d.template && <Row label={t('template')}>{d.template.name}</Row>}
                {d.entity && <Row label={t(`entity.${d.entity.kind}`)}>{d.entity.name}</Row>}
                {d.sender && (
                  <Row label={t('sender')}>{d.sender.name ?? t(`senderKind.${d.sender.kind}`)}</Row>
                )}
                {d.providerMessageId && <Row label={t('providerId')}>{d.providerMessageId}</Row>}
                {d.language && <Row label={t('language')}>{d.language}</Row>}
                {d.cost && (
                  <Row label={t('cost')}>{formatMinor(d.cost.minor, d.cost.currency, locale)}</Row>
                )}
              </dl>
            </section>

            <section>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('timeline')}
              </h3>
              {d.logExpired && <Alert>{t('expired', { days: MESSAGE_LOG_RETENTION_DAYS })}</Alert>}
              {!d.logExpired && d.timeline.length === 0 && (
                <p className="text-muted-foreground">{t('timelineEmpty')}</p>
              )}
              {d.timeline.length > 0 && <MessageLogTimeline events={d.timeline} />}
              {d.fromArchive && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('archived', { days: MESSAGE_LOG_HOT_DAYS })}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="break-all text-end font-mono text-foreground">{children}</dd>
    </div>
  );
}
