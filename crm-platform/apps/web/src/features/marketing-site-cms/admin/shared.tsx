'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';

export { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
export { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
export { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';

export const NS = 'marketing-site-cms';

/** The sentence for a failed save: a stale row version is its own message, everything else follows the status. */
export function ActionError({ error }: { error: unknown }) {
  const t = useTranslations(`${NS}.common.errors`);
  if (!error) return null;
  const api = error instanceof ApiError ? error : null;
  const message =
    api?.status === 409
      ? t('conflict')
      : api?.status === 403
        ? t('forbidden')
        : api && api.status < 500
          ? t('request')
          : t('unexpected');
  return (
    <Alert tone="danger" role="alert">
      {message}
      {api?.requestId && <span className="ms-2 font-mono text-xs">{api.requestId}</span>}
    </Alert>
  );
}

/** `datetime-local` wants local time without a zone; the API wants an ISO instant. */
export const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
