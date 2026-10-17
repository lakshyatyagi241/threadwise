'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Modal } from '@crm/ui';
import type { DpdpAttestationView, DpdpCheckKey } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { checkMessageKey, safeHttpsUrl } from './logic';
import { historyKey, historySchema } from './queries';

const NS = 'dpdp-register-admin';

/** Every statement recorded for one attested check, newest first: who, when, what they wrote, and how long it counted. */
export function HistoryDialog({
  checkKey,
  onClose,
}: {
  checkKey: DpdpCheckKey | null;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  return (
    <Modal
      open={checkKey !== null}
      onClose={onClose}
      size="md"
      title={t('history.title')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('history.close')}
        </Button>
      }
    >
      {checkKey && <HistoryList key={checkKey} checkKey={checkKey} />}
    </Modal>
  );
}

function HistoryList({ checkKey }: { checkKey: DpdpCheckKey }) {
  const t = useTranslations(NS);
  // Mounted only while the dialog is open for this check, so nothing is fetched until someone asks.
  const q = useQuery({
    queryKey: historyKey(checkKey),
    queryFn: ({ signal }) =>
      operatorFetch(`/dpdp-register/checks/${encodeURIComponent(checkKey)}/history`, {
        schema: historySchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t(`checks.${checkMessageKey(checkKey)}.title`)}</p>
      {q.isPending ? (
        <LoadingBlock className="flex min-h-24 items-center justify-center text-muted-foreground" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      ) : (
        <ol className="space-y-3">
          {q.data.data.map((entry) => (
            <HistoryEntry key={`${entry.at}-${entry.byName}`} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryEntry({ entry }: { entry: DpdpAttestationView }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const link = safeHttpsUrl(entry.evidenceUrl);
  return (
    <li className="space-y-1.5 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={entry.result === 'pass' ? 'success' : 'danger'}>
          {t(`attest.result.${entry.result}`)}
        </Badge>
        <span className="text-sm font-medium">{entry.byName}</span>
        <time dateTime={entry.at} className="text-sm text-muted-foreground">
          {format.dateTime(new Date(entry.at), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('history.validUntil', {
          date: format.dateTime(new Date(entry.expiresAt), { dateStyle: 'medium' }),
        })}
      </p>
      <p className="whitespace-pre-line break-words text-sm">{entry.note}</p>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className="inline-block break-all text-sm font-medium text-primary underline underline-offset-2"
        >
          {t('check.evidence')}
        </a>
      )}
    </li>
  );
}
