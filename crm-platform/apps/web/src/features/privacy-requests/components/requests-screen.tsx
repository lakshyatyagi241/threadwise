'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, EmptyState, Field, Select, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { usePrivacyRequests } from '../api/hooks';
import { errorKey } from '../lib/errors';
import { statusTone } from '../lib/model';
import { NewRequestWizard } from './new-request-wizard';
import { SettingsPanel } from './settings-panel';
import { SlaLabel } from './sla-label';

/** `/privacy-requests`: every data request of the workspace with its status and deadline. */
export function RequestsScreen() {
  const t = useTranslations('privacy-requests');
  const f = useFormatter();
  const canRead = useCan('privacy.requests.read');
  const canManage = useCan('privacy.requests.manage');
  const [status, setStatus] = useState<PrivacyRequestStatus | ''>('');
  const [type, setType] = useState<PrivacyRequestType | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const filters = {
    status: status || undefined,
    requestType: type || undefined,
    overdue: overdue || undefined,
  };
  const q = usePrivacyRequests(filters, canRead);

  if (!canRead) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }

  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = status !== '' || type !== '' || overdue;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('list.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="secondary" onClick={() => setShowSettings((v) => !v)}>
              {t('list.settings')}
            </Button>
          )}
          {canManage && <Button onClick={() => setWizard(true)}>{t('list.newRequest')}</Button>}
        </div>
      </div>

      {canManage && showSettings && <SettingsPanel />}

      <div
        role="group"
        aria-label={t('list.filters.label')}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label={t('list.filters.status')} htmlFor="pr-status">
          <Select
            id="pr-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PrivacyRequestStatus | '')}
          >
            <option value="">{t('list.filters.any')}</option>
            {PRIVACY_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('list.filters.type')} htmlFor="pr-type">
          <Select
            id="pr-type"
            value={type}
            onChange={(e) => setType(e.target.value as PrivacyRequestType | '')}
          >
            <option value="">{t('list.filters.any')}</option>
            {PRIVACY_REQUEST_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`type.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          id="pr-overdue"
          label={t('list.filters.overdue')}
          checked={overdue}
          onChange={(e) => setOverdue(e.target.checked)}
          className="pb-2"
        />
      </div>

      {q.isError ? (
        <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
          <span>{t(`errors.${errorKey(q.error)}`)}</span>
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : q.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? t('list.emptyFiltered') : t('list.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {(['reference', 'type', 'subject', 'status', 'due'] as const).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`list.columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/privacy-requests/${r.id}`}
                      className="text-primary hover:underline"
                      aria-label={t('list.open', { reference: r.reference })}
                    >
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t(`type.${r.requestType}`)}</td>
                  <td className="px-3 py-2">{r.subjectLabel}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Badge>
                    {r.legalHold && (
                      <Badge tone="warning" className="ms-1">
                        {t('detail.legalHoldBadge')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <SlaLabel request={r} />
                    <span className="block text-xs text-muted-foreground">
                      {t('sla.dueOn', {
                        date: f.dateTime(new Date(r.dueAt), { dateStyle: 'medium' }),
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? t('list.loadingMore') : t('list.loadMore')}
          </Button>
        </div>
      )}

      {canManage && <NewRequestWizard open={wizard} onClose={() => setWizard(false)} />}
    </div>
  );
}
