'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ConsentExport, ConsentExportStatus } from '@crm/contracts';
import { CONSENT_EXPORT_SYNC_MAX, CONSENT_EXPORT_TTL_DAYS } from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useConsentExports } from '../api/hooks';
import { consentApi, consentExportFileUrl, consentExportUrl } from '../api/service';
import { errorKey } from '../lib/errors';

const TONE: Record<ConsentExportStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  queued: 'neutral',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/**
 * "Export proof". Up to CONSENT_EXPORT_SYNC_MAX events the CSV downloads directly; above that the direct file would be cut short, so
 * the button prepares the whole ledger in the background instead (the list below says when it is ready, and an email does too).
 */
export function ProofExportButton() {
  const t = useTranslations('contact-consent');
  const canExport = useCan('contacts.consent.manage');
  const q = useConsentExports(canExport);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const request = useMutation({
    mutationFn: () => consentApi.requestExport(),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: KEYS.exports });
    },
    onError: (e) => setError(e),
  });

  if (!canExport) return null;
  const busy = q.data?.data.some((e) => e.status === 'queued' || e.status === 'running') ?? false;

  if (q.data?.needsAsync) {
    return (
      <>
        <Button
          variant="secondary"
          onClick={() => request.mutate()}
          disabled={request.isPending || busy}
          title={t('proof.largeHint', { max: CONSENT_EXPORT_SYNC_MAX.toLocaleString() })}
        >
          {(request.isPending || busy) && <Spinner />}
          {busy ? t('proof.preparing') : t('proof.prepare')}
        </Button>
        {error !== null && (
          <span role="alert" className="sr-only">
            {t(`errors.${errorKey(error)}`)}
          </span>
        )}
      </>
    );
  }
  return (
    <a
      href={consentExportUrl()}
      download
      className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
    >
      {t('settings.exportProof')}
    </a>
  );
}

/** The prepared proof files: status, size, when they expire, and the download. Shown only when the ledger needs one or one exists. */
export function ProofExports() {
  const t = useTranslations('contact-consent');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const canExport = useCan('contacts.consent.manage');
  const q = useConsentExports(canExport);

  if (!canExport || !q.data) return null;
  const { data: exports, needsAsync } = q.data;
  if (!needsAsync && exports.length === 0) return null;
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone })
      : '';

  return (
    <section
      className="rounded-xl border border-border bg-background p-4"
      aria-labelledby="proof-exports-title"
    >
      <h2 id="proof-exports-title" className="text-base font-semibold">
        {t('proof.title')}
      </h2>
      {needsAsync && (
        <Alert tone="info" className="mt-2">
          {t('proof.large', { max: CONSENT_EXPORT_SYNC_MAX.toLocaleString() })}
        </Alert>
      )}
      {exports.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('proof.none')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border" data-testid="proof-exports">
          {exports.map((e) => (
            <ExportRow key={e.id} e={e} when={when} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {t('proof.keptFor', { days: CONSENT_EXPORT_TTL_DAYS })}
      </p>
    </section>
  );
}

function ExportRow({ e, when }: { e: ConsentExport; when: (iso: string | null) => string }) {
  const t = useTranslations('contact-consent');
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={TONE[e.status]}>{t(`proof.status.${e.status}`)}</Badge>
          <span className="text-muted-foreground">{when(e.requestedAt)}</span>
        </div>
        {e.status === 'ready' && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('proof.rows', { count: e.rowCount ?? 0 })}
            {e.expiresAt ? ` - ${t('proof.expires', { date: when(e.expiresAt) })}` : ''}
          </p>
        )}
        {e.status === 'failed' && <p className="mt-0.5 text-xs text-danger">{t('proof.failed')}</p>}
      </div>
      {e.status === 'ready' && (
        <a
          href={consentExportFileUrl(e.id)}
          download
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
        >
          {t('proof.download')}
        </a>
      )}
    </li>
  );
}
