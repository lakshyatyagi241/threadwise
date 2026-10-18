'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { PRIVACY_EXPORT_TYPES } from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { usePrivacyRequest } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { isOpen, statusTone } from '../lib/model';
import {
  CloseSection,
  ExportSection,
  HoldSection,
  Timeline,
  VerifySection,
} from './detail-sections';
import { EraseSection } from './erase-section';
import { RestrictedSection } from './restricted-section';
import { SlaLabel } from './sla-label';

/** `/privacy-requests/[id]`: one request with its clock, timeline and the steps that can be taken next. */
export function RequestDetailScreen({ id }: { id: string }) {
  const t = useTranslations('privacy-requests');
  const f = useFormatter();
  const canRead = useCan('privacy.requests.read');
  const canManage = useCan('privacy.requests.manage');
  const canErase = useCan('privacy.erase.execute');
  const q = usePrivacyRequest(id, canRead);

  const back = (
    <Link href="/privacy-requests" className="text-sm text-muted-foreground hover:text-foreground">
      {t('detail.back')}
    </Link>
  );

  if (!canRead) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-3">
        {back}
        <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
          <span>{t(`errors.${errorKey(q.error)}`)}</span>
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  const { request, events, exports } = q.data;
  const open = isOpen(request);
  const exportable = (PRIVACY_EXPORT_TYPES as readonly string[]).includes(request.requestType);

  return (
    <div className="space-y-4">
      {back}
      <header className="space-y-2 rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold">{request.reference}</h1>
          <Badge>{t(`type.${request.requestType}`)}</Badge>
          {request.restricted ? (
            <Badge tone="warning">{t('legalHold.caseStatus')}</Badge>
          ) : (
            <Badge tone={statusTone(request.status)}>{t(`status.${request.status}`)}</Badge>
          )}
          {request.legalHold && <Badge tone="warning">{t('detail.legalHoldBadge')}</Badge>}
        </div>
        <p className="text-sm">{request.subjectLabel}</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <SlaLabel request={request} />
          <span>
            {t('sla.dueOn', { date: f.dateTime(new Date(request.dueAt), { dateStyle: 'medium' }) })}
          </span>
          <span>
            {t('detail.received', {
              date: f.dateTime(new Date(request.receivedAt), { dateStyle: 'medium' }),
            })}
          </span>
          <span>{t('detail.channel', { channel: t(`channel.${request.requesterChannel}`) })}</span>
        </p>
        {request.requestType === 'erasure' && (
          <p className="text-xs text-muted-foreground">
            {t(`detail.history.${request.historyMode}`)}
          </p>
        )}
        {request.internalNote && (
          <p className="text-sm">
            <span className="font-medium">{t('detail.note')}:</span> {request.internalNote}
          </p>
        )}
        {request.status === 'rejected' && request.rejectionReason && (
          <p className="text-sm text-danger">
            {t('detail.close.rejectedWith', { reason: request.rejectionReason })}
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {request.restricted && <RestrictedSection request={request} />}
          {canManage && <VerifySection request={request} />}
          {canManage && open && <HoldSection request={request} />}
          {exportable && (
            <ExportSection request={request} exports={exports} canManage={canManage} />
          )}
          {request.requestType === 'erasure' && canErase && <EraseSection request={request} />}
          {canManage && open && <CloseSection request={request} />}
        </div>
        <Timeline events={events} />
      </div>
    </div>
  );
}
