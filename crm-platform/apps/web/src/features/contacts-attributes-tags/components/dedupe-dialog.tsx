'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Modal, Spinner, useToast } from '@crm/ui';
import { mergeDuplicates, previewDuplicates } from '../api/bulk';
import { invalidateContacts, KEYS } from '../api/contacts';
import { formatPhone } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import { ErrorLine } from './error-line';

/** Most calls one run makes: each merges up to 1,000 sets, so this covers a very large book without looping forever. */
const MAX_ROUNDS = 25;

/**
 * Remove duplicates (WD-CON-025). WaDesk deleted on one click with no preview and lost the losers' groups, tags and
 * attributes; here the duplicate sets are shown first and the API merges each set into its oldest contact.
 */
export function DedupeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every opening starts with a fresh preview and no stale error.
  return open ? <DedupeBody onClose={onClose} /> : null;
}

function DedupeBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations('contacts-attributes-tags.dedupe');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);

  const preview = useQuery({
    queryKey: ['cat', 'duplicates'],
    queryFn: ({ signal }) => previewDuplicates(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  async function run() {
    setRunning(true);
    setRunError(null);
    try {
      let removed = 0;
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const r = await mergeDuplicates(1000);
        removed += r.removed;
        if (r.remainingSets === 0) break;
      }
      await Promise.all([invalidateContacts(qc), qc.invalidateQueries({ queryKey: KEYS.groups })]);
      toast(removed > 0 ? t('done', { count: removed }) : t('none'), 'success');
      onClose();
    } catch (e) {
      setRunError(e);
    } finally {
      setRunning(false);
    }
  }

  const data = preview.data;
  const nothing = data && data.totalSets === 0;
  return (
    <Modal
      open
      onClose={() => {
        if (!running) onClose();
      }}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void run()}
            disabled={running || !data || nothing === true}
          >
            {running && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('intro')}</p>
        {preview.isPending && (
          <div role="status" className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> {t('checking')}
          </div>
        )}
        {preview.isError &&
          (errorKind(preview.error) === 'conflict' || errorKind(preview.error) === 'forbidden' ? (
            <Alert tone="warning">{t('scopeRequired')}</Alert>
          ) : (
            <ErrorLine error={preview.error} onRetry={() => void preview.refetch()} />
          ))}
        {nothing && <Alert tone="success">{t('none')}</Alert>}
        {data && data.totalSets > 0 && (
          <>
            <Alert tone="warning">
              {t('found', { sets: data.totalSets, count: data.totalDuplicates })}
            </Alert>
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.sets.slice(0, 5).map((s) => (
                <li
                  key={s.survivorId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span dir="ltr" className="font-mono text-xs">
                    {formatPhone(s.phone)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('setSize', { count: s.duplicateIds.length + 1 })}
                  </span>
                </li>
              ))}
            </ul>
            {data.totalSets > 5 && (
              <p className="text-xs text-muted-foreground">
                {t('more', { count: data.totalSets - 5 })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('keeps')}</p>
          </>
        )}
        {Boolean(runError) && <ErrorLine error={runError} />}
      </div>
    </Modal>
  );
}
