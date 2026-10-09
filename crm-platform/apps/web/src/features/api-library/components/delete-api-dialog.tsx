'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Modal, Spinner, useToast } from '@crm/ui';
import { apiLibraryApi } from '../api/service';
import { refreshApis, useApiUsage } from '../api/hooks';
import { errorKey, flowsInUse } from '../lib/errors';

interface Target {
  id: string;
  name: string;
}

/**
 * Delete with the usage guard: the flows that call this API are listed first. With none, a plain confirm; with some, the button says
 * "Delete anyway" and sends `?force=true` (their node then leaves by its error port). A 409 from the plain attempt (a flow started using
 * it after the list loaded) turns the same dialog into the "in use" state instead of failing.
 */
export function DeleteApiDialog({ api, onClose }: { api: Target | null; onClose: () => void }) {
  const t = useTranslations('api-library.delete');
  const tc = useTranslations('api-library.common');
  const te = useTranslations('api-library.errors');
  const qc = useQueryClient();
  const { toast } = useToast();
  const usage = useApiUsage(api?.id ?? null);
  const [busy, setBusy] = useState(false);
  // Flows that turned up on the plain attempt, for the API they were found for.
  const [found, setFound] = useState<{
    apiId: string;
    flows: Array<{ id: string; name: string }>;
  } | null>(null);
  const racing = found !== null && found.apiId === api?.id ? found.flows : [];

  const flows = usage.data?.data ?? [];
  const inUse = flows.length > 0 || racing.length > 0;

  async function confirm() {
    if (!api) return;
    setBusy(true);
    try {
      await apiLibraryApi.remove(api.id, inUse);
      toast(t('done', { name: api.name }), 'success');
      await refreshApis(qc);
      onClose();
    } catch (e) {
      const used = flowsInUse(e);
      if (used.length > 0) setFound({ apiId: api.id, flows: used });
      else toast(te(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={api !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={busy || (usage.isPending && api !== null)}
          >
            {busy && <Spinner />}
            {inUse ? t('deleteAnyway') : t('delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('message', { name: api?.name ?? '' })}</p>
        {usage.isPending && api !== null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> {t('checking')}
          </p>
        ) : usage.isError && racing.length === 0 ? (
          <Alert tone="warning">{t('usageFailed')}</Alert>
        ) : inUse ? (
          <Alert tone="warning">
            <p className="font-medium">{t('inUse', { count: flows.length || racing.length })}</p>
            <ul className="mt-2 list-disc ps-5">
              {(flows.length > 0
                ? flows.map((f) => ({
                    id: f.id,
                    name: f.name,
                    extra: f.published,
                    nodes: f.nodeCount,
                  }))
                : racing.map((f) => ({
                    id: f.id,
                    name: f.name,
                    extra: undefined,
                    nodes: undefined,
                  }))
              ).map((f) => (
                <li key={f.id}>
                  <Link href={`/flows/builder/${f.id}`} className="underline">
                    {f.name}
                  </Link>
                  {f.extra !== undefined && (
                    <span className="text-xs">
                      {' · '}
                      {f.extra ? t('published') : t('draft')}
                      {' · '}
                      {t('nodes', { count: f.nodes ?? 0 })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2">{t('forceNote')}</p>
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}
